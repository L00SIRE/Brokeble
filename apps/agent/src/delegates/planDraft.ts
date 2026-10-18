// Plan-draft parsing for chat-first plan creation (docs/design/ux-flow.md §8.3/§8.4). Pure: no repo or port imports, so
// the Anthropic adapter, the mock LLM and plan/startByChat.ts can all use it. Owner A.
// P2: the input is ONE person's own inbound text plus their own in-progress draft; nothing about anyone else.
// Every value returned here is untrusted: startByChat validates each field in code before it is stored or reaches CREAO.
import * as z from "zod";
import { looksLikeName } from "../router/commands";

/** What the agent asked last in the start chat; lets a bare reply ("Koreatown", "4") be read as the answer. */
export const LastQuestion = z.enum(["hello", "area", "count", "both"]).nullable();
export type LastQuestion = z.infer<typeof LastQuestion>;

/** Fields already collected for this person's draft (all validated earlier). */
export type PlanDraftKnown = { first_name?: string; area?: string; date?: string; time_start?: string; party?: number };

export type PlanDraftInput = {
  text: string;
  /** IsoDate in America/Los_Angeles. */
  today: string;
  /** "Saturday": the weekday of `today`, so "saturday" / "tomorrow" resolve without date math in the model. */
  weekday: string;
  known: PlanDraftKnown;
  last_question: LastQuestion;
};

/**
 * LLM-facing schema. Formats and ranges (YYYY-MM-DD, HH:MM, 2 to 8) are not enforceable in the JSON schema the API
 * receives, so they are loose here and checked in code (startByChat); a stray value then drops one field, not the parse.
 */
export const PlanDraftParse = z.strictObject({
  first_name: z.string().nullable(),
  area: z.string().nullable(),
  date: z.string().nullable(),
  time_start: z.string().nullable(),
  party_size: z.number().nullable(),
  confidence: z.enum(["high", "low"]),
});
export type PlanDraftParse = z.infer<typeof PlanDraftParse>;

export const EMPTY_PLAN_DRAFT: PlanDraftParse = { first_name: null, area: null, date: null, time_start: null, party_size: null, confidence: "low" };

// ── LA calendar helpers (a calendar date has no zone: noon UTC is the same day in LA, as in notify/render fmtDate) ──

const LA_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" });
const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

/** Today's date in Los Angeles as YYYY-MM-DD. */
export function todayLA(now: Date = new Date()): string {
  return LA_DAY.format(now);
}

/** "2026-10-24" + 3 → "2026-10-27". */
export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** "2026-10-24" → "Saturday". */
export function weekdayOf(isoDate: string): string {
  return WEEKDAY_NAMES[new Date(`${isoDate}T12:00:00Z`).getUTCDay()]!;
}

// ── Deterministic parser: LLM_MODE=mock, and the fallback when the model returns nothing ──

const NUMBER_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8 };
const N = "(\\d|one|two|three|four|five|six|seven|eight)";
const toNum = (s: string): number => NUMBER_WORDS[s] ?? Number(s);

const WEEKDAY_RE = /\b(?:(this|next)\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tues?|wed|thu|thurs?|fri|sat)\b/;
const WEEKDAY_INDEX: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
const RELATIVE_DAY_RE = /\b(tonight|today|tomorrow|tmrw|tmr)\b/;
const DATE_WORDS_RE = new RegExp(`${WEEKDAY_RE.source}|${RELATIVE_DAY_RE.source}|\\b(?:night|evening)\\b`, "gi");

// First match wins: "me and 3 friends" is 4 people, so it is checked before "3 friends".
const PARTY_RES: readonly [RegExp, (m: RegExpExecArray) => number][] = [
  [new RegExp(`\\bme (?:and|plus|\\+|&) ${N}(?:\\s+(?:friends?|others?|more|people))?\\b`), (m) => toNum(m[1]!) + 1],
  [new RegExp(`\\b${N}\\s*(?:of us|people|ppl|persons|friends|total|guys|girls|peeps)\\b`), (m) => toNum(m[1]!)],
  [new RegExp(`\\b(?:party|group|table) of\\s*${N}\\b`), (m) => toNum(m[1]!)],
  [new RegExp(`\\bfor\\s+${N}\\b(?!\\s*(?::|am\\b|pm\\b|o'?clock))`), (m) => toNum(m[1]!)],
];
// The count and time phrases, removed from a segment before it is considered as a place ("Koreatown at 8" → "Koreatown").
const PHRASES_RE = new RegExp(
  [...PARTY_RES.map(([re]) => re.source), "\\b\\d{1,2}(?::[0-5]\\d)?\\s*(?:am|pm)\\b", "\\b(?:at|around|by)\\s+\\d{1,2}(?::[0-5]\\d)?\\b"].join("|"),
  "gi",
);
const LONE_COUNT_RE = new RegExp(`^\\D*?\\b${N}\\b\\D*$`);

const TIME_AMPM_RE = /\b(\d{1,2})(?::([0-5]\d))?\s*(am|pm)\b/;
const TIME_AT_RE = /\b(?:at|around|by)\s+(\d{1,2})(?::([0-5]\d))?\b(?!\s*(?:of us|people|ppl|friends))/;

const NAME_INTRO_RE = /(?:^|[,.!?]\s*|\b(?:hey|hi|hello)\s+)(?:i'?m|i am|it'?s|this is|call me|my name is|name's)\s+([\p{L}][\p{L}'-]*)/iu;

// "in/at/around <place>" up to punctuation, a date or time word, a number, or the end.
const AREA_PREFIX_RE =
  /\b(?:in|at|around|near)\s+([\p{L}][\p{L} .'&/-]{1,40}?)(?=\s*[,.!?;]|\s+(?:tonight|today|tomorrow|on|this|next|at|for|by|around|with|sunday|monday|tuesday|wednesday|thursday|friday|saturday|\d)\b|\s*$)/iu;
// Words that rule a phrase out as a place (fillers, chat, plan and money words).
const AREA_STOP = new Set([
  "a", "an", "the", "my", "our", "your", "me", "we", "us", "i", "you", "it", "this", "that", "for", "with", "and", "or",
  "like", "um", "uh", "so", "just", "maybe", "prob", "probably", "idk", "whatever", "anywhere", "somewhere", "anything",
  "hey", "hi", "hello", "yo", "squadtab", "help", "plan", "planning", "night", "out", "go", "going", "let's", "lets",
  "want", "wanna", "thinking", "thanks", "thank", "ok", "okay", "sure", "yes", "yeah", "no", "nope", "lol", "sounds",
  "good", "great", "fun", "cool", "nice", "dinner", "show", "food", "eat", "drinks", "budget", "max", "tops", "bucks",
  "dollars", "each", "cheap", "in", "of", "at", "to", "on", "be", "is", "are", "am", "not", "sorry", "what", "how",
  "when", "where", "who", "why", "can", "could", "would", "should", "will", "do", "does", "did", "time", "people",
  "friends", "pm", "am", "o'clock", "please", "pls", "i'm", "im", "it's", "its", "call", "name", "hmm", "hmmm", "hm",
  "huh", "umm", "eh", "meh", "k", "kk", "ya", "yah", "nah", "dunno", "unsure", "pick", "choose", "decide", "surprise",
  "wait", "really", "actually", "also", "too", "very", "honestly", "next", "around", "near", "them", "they", "he", "she", "here", "there", "everywhere", "nowhere", "wherever",
]);
const PLACE_WORD = /^[\p{L}][\p{L}'.&-]*$/u;

const titleCase = (s: string): string => (s === s.toLowerCase() ? s.replace(/(^|[\s/-])(\p{L})/gu, (_, sep: string, c: string) => sep + c.toUpperCase()) : s);

/** "8" / "8:30" read as evening (dinner + show): hours 1–11 become PM. */
function hhmm(h: number, m: string | undefined, ampm: string | undefined): string | null {
  let hour = h;
  if (ampm === "am") hour = h === 12 ? 0 : h;
  else if (ampm === "pm") hour = h === 12 ? 12 : h + 12;
  else if (h >= 1 && h <= 11) hour = h + 12;
  if (hour < 0 || hour > 23) return null;
  return `${String(hour).padStart(2, "0")}:${m ?? "00"}`;
}

function parseDate(t: string, today: string): string | null {
  const rel = RELATIVE_DAY_RE.exec(t)?.[1];
  if (rel) return rel === "tonight" || rel === "today" ? today : addDays(today, 1);
  const wd = WEEKDAY_RE.exec(t);
  if (!wd) return null;
  const target = WEEKDAY_INDEX[wd[2]!.slice(0, 3)]!;
  const from = new Date(`${today}T12:00:00Z`).getUTCDay();
  let delta = (target - from + 7) % 7;
  if (delta === 0 && wd[1] === "next") delta = 7;
  return addDays(today, delta);
}

function parseTime(t: string): string | null {
  const ap = TIME_AMPM_RE.exec(t);
  if (ap) return hhmm(Number(ap[1]), ap[2], ap[3]);
  const at = TIME_AT_RE.exec(t);
  return at ? hhmm(Number(at[1]), at[2], undefined) : null;
}

function parseParty(t: string, last: LastQuestion): number | null {
  for (const [re, pick] of PARTY_RES) {
    const m = re.exec(t);
    if (m) return pick(m);
  }
  if (last === "count" || last === "both") {
    const m = LONE_COUNT_RE.exec(t);
    if (m) return toNum(m[1]!);
  }
  return null;
}

const isStop = (w: string): boolean => AREA_STOP.has(w.toLowerCase());

/**
 * A phrase that could be a place (date words removed, original case kept): leading and trailing filler is trimmed
 * ("thinking venice beach" → "venice beach"), then 1 to 4 plain words with no filler/chat/plan word left inside.
 */
function placeCandidate(segment: string): string | null {
  const words = segment.replace(DATE_WORDS_RE, " ").trim().split(/\s+/).filter(Boolean);
  while (words.length > 0 && isStop(words[0]!)) words.shift();
  while (words.length > 0 && isStop(words.at(-1)!)) words.pop();
  if (words.length === 0 || words.length > 4) return null;
  if (!words.every((w) => w === "/" || w === "&" || (PLACE_WORD.test(w) && !isStop(w)))) return null;
  const s = words.join(" ");
  return s.length >= 2 && s.length <= 40 ? s : null;
}

/**
 * The code parser (no model). Extracts only what the text states:
 * - party: "4 of us" / "party of 4" / "me and 3 friends" / "for 4", or a bare number right after the count question;
 * - date: tonight/today/tomorrow or a weekday (next occurrence, LA); time: "8pm" / "8:30 pm" / "at 8" (evening);
 * - name: "I'm Maya" / "it's Maya", or a leading "Maya," when the message also names a place;
 * - area: "in/at/around <place>", else a bare place phrase when the message also has a date, time or count, or when it
 *   answers the area question ("santa monica saturday, 4 of us" → Santa Monica).
 */
export function parsePlanDraftText(i: PlanDraftInput): PlanDraftParse {
  const raw = i.text.replace(/[’‘]/g, "'").replace(/\s+/g, " ").trim();
  const t = raw.toLowerCase();
  const date = parseDate(t, i.today);
  const time_start = parseTime(t);
  const party_size = parseParty(t, i.last_question);

  const intro = NAME_INTRO_RE.exec(raw)?.[1];
  let first_name = intro ? looksLikeName(intro) : null;

  const prefixed = AREA_PREFIX_RE.exec(raw)?.[1];
  let area = prefixed ? placeCandidate(prefixed) : null;

  const answering = i.last_question === "area" || i.last_question === "both" || i.last_question === "hello";
  if (!area && (date || time_start || party_size !== null || answering)) {
    // The "I'm Maya" phrase is the name, never a place.
    const candidates = (intro ? raw.replace(NAME_INTRO_RE, ", ") : raw)
      .split(/[,.!?;\n]+/)
      // Count and time phrases are cut out first; whatever is left must be digit-free ("prob 4 of us" leaves only the
      // filler "prob", which placeCandidate rejects).
      .map((seg) => seg.replace(PHRASES_RE, " "))
      .filter((seg) => !/\d/.test(seg))
      .map(placeCandidate)
      .filter((c): c is string => c !== null);
    const [first, second] = candidates;
    const nameLike = first && !first.includes(" ") && !first_name && !i.known.first_name ? looksLikeName(first) : null;
    if (nameLike && second) {
      first_name = nameLike;
      area = second;
    } else if (nameLike && i.last_question === "hello" && !date && !time_start && party_size === null) {
      first_name = nameLike; // "maya" right after the hello answers "what should I call you"
    } else if (first) {
      area = first;
    }
  }

  const found = [first_name, area, date, time_start, party_size].filter((v) => v !== null).length;
  return { first_name, area: area ? titleCase(area) : null, date, time_start, party_size, confidence: found > 0 ? "high" : "low" };
}
