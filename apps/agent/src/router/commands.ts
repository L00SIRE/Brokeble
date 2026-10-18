// Command regex table and reply parsers (A plan T3 steps 5–7). Pure. Owner A.

export type Command =
  | { kind: "join"; code: string } // \bjoin\s*#?\s*(\d{4})\b anywhere ("Join #4821 please")
  | { kind: "help" } // ^(help|\?)$
  | { kind: "status" } // ^status$
  | { kind: "out" } // ^(i'?m out|i am out|out|stop|leave)$
  | { kind: "receipts" } // ^receipts?$
  | { kind: "remove_card" } // ^remove card$
  | { kind: "forget_me" } // ^forget me$
  | { kind: "cancel_plan" } // ^cancel plan$
  | { kind: "go" } // ^go$
  | { kind: "wait" } // ^wait$
  | { kind: "change_budget" } // ^change budget$
  | { kind: "new_plan" }; // ^(new plan|start over|start fresh)$

/** trim, lowercase, curly apostrophe ’ → ', collapse inner whitespace. */
export function normalizeCommandText(text: string): string {
  return text.trim().toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, " ");
}

/** Normalized text without trailing sentence punctuation ("I'm out." / "yes!"); "?" is kept because it is the help command. */
const bare = (text: string): string => normalizeCommandText(text).replace(/[.!]+$/, "");

const SIMPLE: readonly [RegExp, Exclude<Command, { kind: "join" }>][] = [
  [/^(?:help|\?)$/, { kind: "help" }],
  [/^status$/, { kind: "status" }],
  [/^(?:i'?m out|i am out|out|stop|leave)$/, { kind: "out" }],
  [/^receipts?$/, { kind: "receipts" }],
  [/^remove card$/, { kind: "remove_card" }],
  [/^forget me$/, { kind: "forget_me" }],
  [/^cancel plan$/, { kind: "cancel_plan" }],
  [/^go$/, { kind: "go" }],
  [/^wait$/, { kind: "wait" }],
  [/^change budget$/, { kind: "change_budget" }],
  [/^(?:new plan|start over|start fresh)$/, { kind: "new_plan" }],
];

/** The command `text` matches after normalizeCommandText, or null. */
export function parseCommand(text: string): Command | null {
  const t = bare(text);
  const join = /\bjoin\s*#?\s*(\d{4})\b/.exec(t);
  if (join) return { kind: "join", code: join[1]! };
  return SIMPLE.find(([re]) => re.test(t))?.[1] ?? null;
}

// The fixed first-text bodies the web pre-fills (ux-flow §3.3, plus the CreatePlanForm fallback), reduced to letters,
// digits and single spaces so punctuation, case and curly quotes do not matter.
const START_PREFILL = "hey squadtab help me plan a night out";
const PREFILL_SENTENCES = new Set([START_PREFILL, "hey squadtab lets get planning", "hey squadtab where are we at"]);
const lettersOnly = (text: string): string => normalizeCommandText(text).replace(/[^a-z0-9 ]+/g, "").replace(/\s+/g, " ").trim();
const noEndPunct = (text: string): string => normalizeCommandText(text).replace(/[.!?]+$/, "");

/**
 * True when `text` is one of the web's pre-filled first texts (ux-flow §3.3): the three fixed sentences, "I'm in!", or
 * "I'm in for {planTitle}!" for the sender's own plan. The title must match, so a real preference ("I'm in for sushi")
 * is never mistaken for a pre-fill. Pure.
 */
export function isPrefillText(text: string, planTitle: string): boolean {
  if (PREFILL_SENTENCES.has(lettersOnly(text))) return true;
  const imIn = /^i'?m in(?: for (.+))?$/.exec(noEndPunct(text));
  return imIn !== null && (imIn[1] === undefined || imIn[1] === noEndPunct(planTitle));
}

/** True for the /start pre-fill ("Hey SquadTab! Help me plan a night out."): its sender is starting a plan of their own. Pure. */
export function isStartPrefill(text: string): boolean {
  return lettersOnly(text) === START_PREFILL;
}

/** Digits ballot /^\s*[1-3](\s*[, ]\s*[1-3])*\s*$/ → deduped indices in first-seen order ("1 3" → [1,3]); else null. */
export function parseDigitsBallot(text: string): number[] | null {
  if (!/^\s*[1-3](\s*[, ]\s*[1-3])*\s*$/.test(text)) return null;
  return [...new Set(text.match(/[1-3]/g)!.map(Number))];
}

/** holdGate reply: /^(y|yes|yeah|yep|ok)$/ → "yes", /^(n|no|nope)$/ → "no", else null (normalized text). */
export function parseYesNo(text: string): "yes" | "no" | null {
  const t = bare(text);
  if (/^(?:y|yes|yeah|yep|ok)$/.test(t)) return "yes";
  if (/^(?:n|no|nope)$/.test(t)) return "no";
  return null;
}

/** Budget tier reply /^[1-4]$/ → 1..4, else null. */
export function parseTier(text: string): 1 | 2 | 3 | 4 | null {
  const t = bare(text);
  return /^[1-4]$/.test(t) ? (Number(t) as 1 | 2 | 3 | 4) : null;
}

// Words that answer "what should I call you?" with something other than a name (budget answers, fillers, replies).
const NOT_A_NAME = new Set([
  "budget", "max", "spend", "no", "yes", "help", "status", "maybe", "like", "around", "about", "idk", "not", "cheap",
  "whatever", "anything", "nothing",
  "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen",
  "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty",
  "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety", "hundred", "k",
  // Greetings, acknowledgements and money words that also are not names.
  "hey", "hi", "hello", "yo", "sup", "ok", "okay", "sure", "yeah", "yep", "nope", "thanks", "thx", "lol", "cool", "nah",
  "under", "over", "tops", "bucks", "dollars", "free", "none", "cap", "unlimited", "out", "stop", "join",
  // "I'm in" / "I'm down" / "it's me": common words after the intro phrases that are not names either.
  "in", "down", "up", "here", "back", "good", "fine", "great", "ready", "so", "just", "the", "a", "an", "me", "you",
  "we", "us", "that", "this", "what", "who", "sorry", "please", "pls", "going", "looking", "trying", "planning",
  "thinking", "excited", "hungry", "tonight", "today", "tomorrow", "dinner", "show", "plan", "go", "wait", "gonna",
]);
const NAME_LEAD = /^(?:(?:hey|hi|hello)[,!]?\s+)?(?:i'?m|i am|it'?s|its|call me|this is|my name is|my name's|name's|name is)\s+/i;
const NAME_WORD = /^[\p{L}][\p{L}'-]*$/u;

/** "leo" → "Leo"; a word the person typed with capitals ("DeShawn") keeps them. */
const titleWord = (w: string): string => (w === w.toLowerCase() ? w.replace(/(^|[-'])(\p{L})/gu, (_, sep: string, c: string) => sep + c.toUpperCase()) : w);

/**
 * The first name in a reply to "what should I call you?", or null. Strips a leading "I'm" / "it's" / "call me" /
 * "this is", then accepts 1 to 2 words of letters, apostrophes or hyphens (at most 20 characters) with no digits, no "$"
 * and none of the NOT_A_NAME words, so a budget answer ("40 max", "maybe sixty", "around forty") is never taken as a
 * name. Returns the first word, title-cased. Pure.
 */
export function looksLikeName(text: string): string | null {
  const t = text.trim().replace(/[’‘]/g, "'").replace(/\s+/g, " ").replace(/[\s.!~,]+$/u, "").replace(NAME_LEAD, "");
  if (t.length === 0 || t.length > 20 || /[\d$]/.test(t)) return null;
  const words = t.split(" ");
  if (words.length > 2 || !words.every((w) => NAME_WORD.test(w) && !NOT_A_NAME.has(w.toLowerCase()))) return null;
  return titleWord(words[0]!);
}
