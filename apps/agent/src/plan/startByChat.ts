// Plan creation by chat (docs/design/ux-flow.md §8.3). A known user with no active plan describes the night in their own
// words ("maya, santa monica saturday, 4 of us") and the agent creates the plan with them as its first, JOINED member.
// Owner A. Never logs message text. Every reply is a fixed template (P3/P4), except the existing guarded delegate reply.
// P2: parsePlanDraft sees only this person's own text and own draft. A budget in the text is ignored here and asked
// again privately by T_BUDGET_ASK; this file never touches the private budget store.
import { HHMM, IsoDate, type InboundEvent, type TemplateId } from "@tab/shared";
import { clock12 } from "../delegates/converse";
import { converseReply } from "../delegates/free";
import { addDays, todayLA, weekdayOf, type LastQuestion, type PlanDraftKnown, type PlanDraftParse } from "../delegates/planDraft";
import { createPlanRecord } from "../join/createPlanRecord";
import { log } from "../log";
import { notify, replyKey } from "../notify/notify";
import { fmtDate } from "../notify/render";
import { ports } from "../ports";
import type { UserRow } from "../repo/types";
import { setFirstName } from "../repo/users";
import { looksLikeName } from "../router/commands";
import { DEFAULT_END, DEFAULT_START } from "./defaults";
import { containsCardNumber } from "../router/luhn";

/** The research pipeline is fixed to dinner + a show, so the title never promises anything else. */
export const START_TITLE = "Dinner + show";
const DEFAULT_PARTY = 4;
const PLAN_HOURS = 4;
const MAX_DAYS_AHEAD = 30;
/** A draft nobody touched for this long is stale ("tonight" meant another night): start over. */
const DRAFT_TTL_MS = 6 * 60 * 60 * 1000;

type Draft = PlanDraftKnown & { asks: number; last: LastQuestion; touchedAt: number };

// In-memory per user, like delegates/awaiting.ts. Lost on restart: the next text restarts the draft, and fields stated
// again in that message are picked up. Bounded by the number of seated users (the shared-line seat pool).
const drafts = new Map<string, Draft>();

const freshDraft = (): Draft => ({ asks: 0, last: null, touchedAt: Date.now() });

function draftFor(userId: string, now: number): Draft {
  const d = drafts.get(userId);
  return d && now - d.touchedAt < DRAFT_TTL_MS ? d : freshDraft();
}

/**
 * True while this user is mid start chat (a draft younger than DRAFT_TTL_MS). The router then keeps routing their texts
 * here instead of to a recently booked plan, so someone who booked last night can plan again tonight.
 */
export function hasStartDraft(userId: string, now = Date.now()): boolean {
  const d = drafts.get(userId);
  return d !== undefined && now - d.touchedAt < DRAFT_TTL_MS;
}

/** Test hook: drops every in-memory draft. */
export function resetStartDrafts(): void {
  drafts.clear();
}

// CREAO's ResearchBrief may carry the area but no free text, names, phones or budgets (invariant 5 / P6). The area comes
// from the model reading the organizer's free text, so this is the barrier: letters first, then letters, spaces and
// . , ' & / - only. No digits, "$" or "@" can pass, so "santa monica, $60 each" or a phone number never reaches CREAO.
const AREA_RE = /^[\p{L}][\p{L} .,'&/-]{1,59}$/u;
const AREA_MONEY = /\b(?:bucks?|dollars?|usd|budget|each|pp|per person|max|tops|cheap|afford\w*)\b/i;

/**
 * The area as it may be stored and sent to CREAO, or null: trimmed, 2 to 60 characters, AREA_RE, no card number, no
 * money words, and not one of `names` (the person's own first name read as a place). All-lowercase input is title-cased
 * for display ("westwood / sawtelle" → "Westwood / Sawtelle").
 */
export function sanitizeArea(raw: string | null | undefined, names: readonly (string | undefined)[] = []): string | null {
  if (!raw) return null;
  const a = raw.normalize("NFC").replace(/\s+/g, " ").trim().replace(/[\s.,&/-]+$/u, "");
  if (a.length < 2 || a.length > 60 || !AREA_RE.test(a)) return null;
  if (containsCardNumber(a) || AREA_MONEY.test(a)) return null;
  if (names.some((n) => n && n.trim().toLowerCase() === a.toLowerCase())) return null;
  return a === a.toLowerCase() ? a.replace(/(^|[\s/-])(\p{L})/gu, (_, sep: string, c: string) => sep + c.toUpperCase()) : a;
}

/** "7:30" → "07:30"; a valid HHMM between 10:00 and 23:00 (a dinner + show start), else null. */
function startTime(raw: string | null): HHMM | null {
  const t = raw?.trim() ?? "";
  const padded = /^\d:\d\d$/.test(t) ? `0${t}` : t;
  return HHMM.safeParse(padded).success && padded >= "10:00" && padded <= "23:00" ? padded : null;
}

/** start + 4 h, capped at 23:59 (plans end the same day). */
export function endTime(start: HHMM): HHMM {
  const [h, m] = start.split(":").map(Number) as [number, number];
  const end = Math.min(h * 60 + m + PLAN_HOURS * 60, 23 * 60 + 59);
  return `${String(Math.floor(end / 60)).padStart(2, "0")}:${String(end % 60).padStart(2, "0")}`;
}

/** Only the fields that pass validation in code; anything invalid is dropped (the agent asks again or defaults). */
export function validDraftFields(p: PlanDraftParse, today: string, ownNames: readonly (string | undefined)[]): PlanDraftKnown {
  const out: PlanDraftKnown = {};
  const first_name = p.first_name ? looksLikeName(p.first_name) : null;
  if (first_name) out.first_name = first_name;
  const area = sanitizeArea(p.area, [...ownNames, first_name ?? undefined]);
  if (area) out.area = area;
  const date = p.date?.trim();
  if (date && IsoDate.safeParse(date).success && date >= today && date <= addDays(today, MAX_DAYS_AHEAD)) out.date = date;
  const time = startTime(p.time_start);
  if (time) out.time_start = time;
  if (p.party_size !== null && Number.isInteger(p.party_size) && p.party_size >= 2 && p.party_size <= 8) out.party = p.party_size;
  return out;
}

const known = ({ first_name, area, date, time_start, party }: Draft): PlanDraftKnown =>
  Object.fromEntries(Object.entries({ first_name, area, date, time_start, party }).filter(([, v]) => v !== undefined));

/**
 * Router entry for a known user with no active plan (ux-flow §8.3), one inbound at a time:
 * 1. merge the validated fields of parsePlanDraft(text) into the user's draft (a new name is stored while blank);
 * 2. nothing extracted and nothing asked yet → T_START_HELLO (no link: it is the first reply);
 * 3. no area → T_START_ASK_AREA (or _BOTH when the count is also missing); an off-topic text gets the private
 *    delegate's natural reply first, when one is available;
 * 4. no count and not asked yet → T_START_ASK_COUNT (once; after that the count defaults to 4);
 * 5. else create the plan (organizer JOINED), then T_PLAN_READY + T_BUDGET_ASK (2 bubbles, the per-turn maximum).
 */
export async function handleStartText(user: UserRow, e: InboundEvent): Promise<void> {
  const now = Date.now();
  const today = todayLA(new Date(now));
  const draft = draftFor(user.id, now);
  const parse = await ports.llm.parsePlanDraft({
    text: (e.text ?? "").slice(0, 2000), today, weekday: weekdayOf(today), known: known(draft), last_question: draft.last,
  });
  const got = validDraftFields(parse, today, [user.first_name, draft.first_name]);
  // A field the model saw in `known` is not news: only values that differ count as extracted from this message.
  const fresh = (Object.keys(got) as (keyof PlanDraftKnown)[]).filter((k) => got[k] !== draft[k]);
  Object.assign(draft, got, { touchedAt: now });
  drafts.set(user.id, draft);

  if (got.first_name && user.first_name === "" && (await setFirstName(user.id, got.first_name))) {
    user = { ...user, first_name: got.first_name };
  }

  const ask = async (id: TemplateId & `T_START_${string}`, last: LastQuestion) => {
    draft.last = last;
    if (last !== "hello") draft.asks++;
    await notify(user.id, id, {}, { key: replyKey(e.message_id, 1) });
  };

  if (draft.last === null && Object.keys(known(draft)).length === 0) return ask("T_START_HELLO", "hello");
  if (!draft.area) {
    // Off-topic text after a question: a natural reply when the delegate is available, else the plain re-ask.
    if (fresh.length === 0 && (await converseReply(user, null, e))) return;
    return draft.party ? ask("T_START_ASK_AREA", "area") : ask("T_START_ASK_BOTH", "both");
  }
  if (!draft.party && draft.asks < 1) return ask("T_START_ASK_COUNT", "count");
  await createFromDraft(user, draft, today, e);
}

async function createFromDraft(user: UserRow, draft: Draft, today: string, e: InboundEvent): Promise<void> {
  const time_start = draft.time_start ?? DEFAULT_START;
  const time_end = draft.time_start ? endTime(draft.time_start) : DEFAULT_END;
  const { plan, join_url } = await createPlanRecord(
    user,
    {
      title: START_TITLE,
      area: draft.area!,
      date: draft.date && draft.date >= today ? draft.date : today,
      time_start,
      time_end,
      party_target: draft.party ?? DEFAULT_PARTY,
    },
    { organizerStage: "JOINED" },
  );
  drafts.delete(user.id);
  log.info({ plan_id: plan.id }, "plan created by chat");
  const name = user.first_name || draft.first_name;
  await notify(
    user.id,
    "T_PLAN_READY",
    {
      greeting: name ? `You're set, ${name}` : "You're set",
      title: plan.title,
      date: fmtDate(plan.event_date),
      time: clock12(plan.time_start),
      area: plan.area,
      n: plan.party_target,
      url: join_url,
    },
    { key: replyKey(e.message_id, 1), planId: plan.id },
  );
  // The organizer is JOINED, so their next text goes to the budget step (router stage handler).
  await notify(user.id, "T_BUDGET_ASK", {}, { key: replyKey(e.message_id, 2), planId: plan.id });
}
