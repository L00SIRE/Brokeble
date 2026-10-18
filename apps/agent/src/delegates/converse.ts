// Conversational private delegate (PLAN §3: free replies come from the person's OWN delegate). Owner A.
// Context = that person's own data + public plan facts only (P2); the model never sees any budget value. The model reads
// that context as plain sentences (converseWire), never as field names it could echo. Its text goes out only through
// notify (T_DELEGATE_REPLY) after a code guard; money/privacy messages stay fixed templates (P4).
// Never logs message text or reply text.
import type { InboundEvent, LaneStage, Preferences, PublicBundle } from "@tab/shared";
import { log } from "../log";
import { notify, replyKey } from "../notify/notify";
import { fmtDate, fmtDeadline } from "../notify/render";
import { STAGE_ORDER, stageAtLeast } from "../plan/machine";
import { ports } from "../ports";
import { getBundle } from "../repo/bundles";
import { countByStage } from "../repo/participants";
import { getPreferences } from "../repo/preferences";
import * as privateConstraints from "../repo/privateConstraints";
import type { MemberContext, PlanRow, UserRow } from "../repo/types";
import { containsCardNumber } from "../router/luhn";
import { asConverser, type ConverseInput, type ConverseResult, type ConverseWire } from "./converseSchema";
import { emitDelegateXray } from "./input";

/** T_DELEGATE_REPLY's {text} cap (packages/shared templates). */
export const MAX_REPLY = 600;

const BASE_COMMANDS = ["status", "I'm out", "change budget", "receipts", "forget me", "help"];
const ORGANIZER_COMMANDS = ["go (start with whoever's ready)", "wait", "cancel plan"];
// No plan yet: the plan commands (status, I'm out, change budget, ...) have nothing to act on.
const NO_PLAN_COMMANDS = ["help", "forget me"];
// Booked (COMMITTING/CONFIRMED): leaving, budget and organizer commands can no longer change anything.
const BOOKED_COMMANDS = ["status", "receipts", "forget me", "help"];

const countFrom = (by: Partial<Record<LaneStage, number>>, from: LaneStage): number =>
  STAGE_ORDER.slice(STAGE_ORDER.indexOf(from)).reduce((n, s) => n + (by[s] ?? 0), 0);
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const safeDeadline = (iso: string | undefined): string | null => {
  if (!iso) return null;
  try {
    return fmtDeadline(iso);
  } catch {
    return null;
  }
};
/** "18:30" → "6:30 PM". */
export function clock12(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number) as [number, number];
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
}

/**
 * Public, name-free sentences about where the plan is and what comes next, written by code from the plan state, the
 * sender's own stage and stage counts (the same counts T_STATUS / T_VOTE_TALLY / T_IN_COUNT already send everyone).
 * Also used verbatim as the fallback prefs acknowledgement, so it reads as a human sentence.
 */
export function whereThingsStand(plan: PlanRow, stage: LaneStage, by: Partial<Record<LaneStage, number>>): string {
  switch (plan.state) {
    case "COLLECTING": {
      const left = Math.max(0, plan.party_target - countFrom(by, "PREFS_DONE"));
      return left > 0
        ? `Waiting on ${plural(left, "more friend", "more friends")} to finish up, then I'll start looking for dinner and a show.`
        : "Everyone's in, so I'm about to start looking for dinner and a show.";
    }
    case "RESEARCHING":
      return "I'm digging through dinner and show options right now. It usually takes a few minutes, then I'll text you the top picks to vote on.";
    case "VOTING": {
      const closes = safeDeadline(plan.deadlines.vote_at);
      const tail = closes ? ` Voting closes at ${closes}.` : "";
      return stage === "VOTED"
        ? `You've voted. ${countFrom(by, "VOTED")} of ${countFrom(by, "PREFS_DONE")} have voted so far.${tail}`
        : `Voting is open: reply with the numbers of the picks you'd be happy with, like "1 3".${tail}`;
    }
    case "ORDERING":
      return "The group picked a winner and I'm setting up the holds. Your secure pay link is on its way.";
    case "APPROVING": {
      const by_ = safeDeadline(plan.deadlines.approve_at);
      const when = by_ ? ` by ${by_}` : "";
      return stageAtLeast(stage, "HELD")
        ? `Your hold is in (not charged). Waiting on the others: ${countFrom(by, "HELD")} of ${countFrom(by, "VOTED")} are in so far.`
        : `Tap your secure pay link to place a hold. Nobody's charged unless everyone's in${when}.`;
    }
    case "COMMITTING":
      return "Everyone's in, so I'm booking it now. The booking is final, so nobody can drop out at this point.";
    case "CONFIRMED":
      return "You're booked and every share was charged. The booking is final, so nobody can drop out at this point. Your itinerary link comes by text.";
    case "CANCELLING":
    case "CANCELLED":
      return "This plan was called off. Nobody was charged.";
    case "SHOWCASE":
      return "This is a demo plan.";
  }
}

/** Public picks for the voting context: number, title and times only (no prices: the delegate never talks money). */
export const picksForContext = (shortlist: readonly PublicBundle[]): string[] =>
  shortlist.map((b) => `${b.index}. ${b.title} (dinner ${clock12(b.dinner_time)}, show ${clock12(b.show_start)} to ${clock12(b.show_end_est)})`);

const DECIDED: readonly PlanRow["state"][] = ["ORDERING", "APPROVING", "COMMITTING", "CONFIRMED"];

/**
 * The winning pick once the vote is decided: public venue facts only (the same names, addresses and times the
 * itinerary carries), never a price. Null before the vote closes or if the bundle row can't be found.
 */
async function chosenPlanFor(plan: PlanRow): Promise<ConverseInput["chosen_plan"]> {
  if (!DECIDED.includes(plan.state) || !plan.chosen_bundle_id) return null;
  const b = await getBundle(plan.id, plan.version, plan.chosen_bundle_id);
  if (!b) return null;
  return {
    booked: plan.state === "CONFIRMED",
    title: `Dinner at ${b.dinner.data.name} → Show at ${b.show.data.name}`,
    dinner_name: b.dinner.data.name,
    dinner_address: b.dinner.data.address,
    dinner_time: clock12(b.dinner_time),
    show_name: b.show.data.name,
    show_address: b.show.data.address,
    show_start: clock12(b.show_start),
    show_end: clock12(b.show_end_est),
  };
}

/**
 * The delegate's whole context: the sender's first name and own text, public plan facts, the sender's OWN saved
 * preferences and whether their OWN budget is set (a boolean, never a value). Nothing about any other member.
 */
export async function buildConverseInput(
  user: UserRow,
  ctx: MemberContext | null,
  text: string,
  mode: ConverseInput["mode"],
  o: { shortlist?: readonly PublicBundle[] } = {},
): Promise<ConverseInput> {
  const base = { user_first_name: user.first_name, mode, message_text: text.slice(0, 2000), picks: picksForContext(o.shortlist ?? []) };
  if (!ctx) {
    return {
      ...base, plan: null, is_organizer: false, my_preferences: null, my_budget_set: false, commands: NO_PLAN_COMMANDS,
      // No plan yet: the only no-plan path is the start chat (plan/startByChat.ts), which needs these two answers.
      where_things_stand:
        "They aren't in a plan yet and want to start one. To set it up you still need where they want to go (a neighborhood or city) and how many people are coming, counting them.",
      chosen_plan: null,
    };
  }
  const { plan, participant } = ctx;
  const [by, prefs, own, chosen_plan] = await Promise.all([
    countByStage(plan.id),
    getPreferences(plan.id, user.id),
    privateConstraints.get(plan.id, user.id),
    chosenPlanFor(plan),
  ]);
  const isOrganizer = plan.organizer_id === user.id;
  return {
    ...base,
    chosen_plan,
    plan: { title: plan.title, date: fmtDate(plan.event_date), start_time: clock12(plan.time_start), area: plan.area },
    is_organizer: isOrganizer,
    where_things_stand: whereThingsStand(plan, participant.stage, by),
    my_preferences: prefs,
    my_budget_set: own !== null,
    commands: plan.state === "COMMITTING" || plan.state === "CONFIRMED" ? BOOKED_COMMANDS : isOrganizer ? [...BASE_COMMANDS, ...ORGANIZER_COMMANDS] : BASE_COMMANDS,
  };
}

const human = (s: string): string => s.replace(/_/g, " ");
const joinHuman = (xs: readonly string[]): string => xs.map(human).join(", ");
/** `go (start with whoever's ready)` → `"go" (start with whoever's ready)`; `status` → `"status"`. */
const quoteCommand = (c: string): string => {
  const m = /^(.+?) \((.+)\)$/.exec(c);
  return m ? `"${m[1]}" (${m[2]})` : `"${c}"`;
};

function prefsFact(p: Preferences | null): string {
  if (!p) return "They haven't told you what they're in the mood for yet.";
  const parts = [
    p.cuisines_like.length ? `they'd like ${joinHuman(p.cuisines_like)}` : null,
    p.cuisines_avoid.length ? `they'd rather skip ${joinHuman(p.cuisines_avoid)}` : null,
    p.dietary.length ? `they eat ${joinHuman(p.dietary)}` : null,
    p.vibe.length ? `they want a ${joinHuman(p.vibe)} vibe` : null,
    p.earliest_start ? `nothing before ${clock12(p.earliest_start)}` : null,
    p.latest_end ? `done by ${clock12(p.latest_end)}` : null,
    p.dealbreakers.length ? `dealbreakers: ${joinHuman(p.dealbreakers)}` : null,
  ].filter((x): x is string => x !== null);
  return parts.length ? `What they're in the mood for: ${parts.join("; ")}.` : "They said they're open to anything.";
}

/**
 * The delegate's context as plain sentences: the same facts as ConverseInput, with no keys, enum values or internal
 * labels for the model to echo ("Mode is chat, so..."). Pure; every number in it comes from the input.
 */
export function converseFacts(i: ConverseInput): string[] {
  const facts = [i.user_first_name ? `You're texting ${i.user_first_name}.` : "You're texting someone whose name you don't know yet."];
  if (!i.plan) {
    facts.push(i.where_things_stand);
  } else {
    const { title, date, start_time, area } = i.plan;
    facts.push(`Their plan: ${title} on ${date}, starting around ${start_time}, in ${area}.`);
    facts.push(i.is_organizer ? "They organized it and invited their friends." : "A friend invited them; they're one of the group.");
    facts.push(`What's happening now: ${i.where_things_stand}`);
    if (i.picks.length) facts.push(`The picks up for a vote: ${i.picks.join("; ")}.`);
    const c = i.chosen_plan;
    if (c) {
      const where = `dinner at ${c.dinner_name} (${c.dinner_address}) at ${c.dinner_time}, then ${c.show_name} (${c.show_address}) from ${c.show_start} to about ${c.show_end}`;
      facts.push(c.booked ? `It's booked: ${where}.` : `The group picked ${where}. It isn't booked yet.`);
    }
    // Once booked, their earlier wishes can't change anything: without this the model offers to "keep them in mind".
    facts.push(c?.booked && i.my_preferences ? `${prefsFact(i.my_preferences)} The night is already booked, so only bring that up if they ask.` : prefsFact(i.my_preferences));
    facts.push(i.my_budget_set ? "They've set their own private budget (you never see the amount)." : "They haven't set their private budget yet.");
  }
  if (i.mode === "prefs_ack") facts.push("They just answered your question about what they're in the mood for tonight, and you saved it.");
  // The re-ask follows as its own text, so the answer must not ask too, wave the question off, or point at a command.
  if (i.mode === "budget_question") {
    facts.push(
      "You just asked for their private budget and they answered with a question. Your next text asks for the budget again, so only answer the question: don't ask for the budget yourself, don't say there's no rush, and don't tell them to text anything to set it.",
    );
  }
  const commands = i.mode === "budget_question" ? i.commands.filter((c) => c !== "change budget") : i.commands;
  if (commands.length) facts.push(`Words they can text: ${commands.map(quoteCommand).join(", ")}.`);
  return facts;
}

export const converseWire = (i: ConverseInput): ConverseWire => ({ facts: converseFacts(i), message: i.message_text });

/**
 * What the converser is handed: a copy of the structured ConverseInput (same type and fields) whose JSON form is the
 * plain-sentence wire. The adapter (anthropicLLM.converse) sends JSON.stringify of its argument, so this toJSON decides
 * what the model reads. Non-enumerable, so spreads and equality checks still see the plain input.
 */
export function withWireForm(i: ConverseInput): ConverseInput {
  return Object.defineProperty({ ...i }, "toJSON", { value: () => converseWire(i), enumerable: false });
}

// Any money amount at all: the delegate is told never to write one, so a hit means it went off-script.
const MONEY = /[$€£¢]|\b\d+(?:[.,]\d+)?\s*(?:dollars?|bucks|usd|k)\b/i;
// A long digit run that could be (part of) a card or account number, even if it fails Luhn.
const LONG_DIGITS = /\d(?:[ -]?\d){11,}/;
const CLOCK = /\b\d{1,2}:\d{2}\b/g;

export type GuardVerdict = "ok" | "length" | "money" | "card" | "number" | "internal";

// Machine-shaped text the model could only have copied from how it was prompted: snake_case identifiers (field names,
// enum values, template ids), plan/lane state names in caps, and talk about modes, stages, JSON or its instructions.
const SNAKE = /\b[A-Za-z0-9]+(?:_[A-Za-z0-9]+)+\b/g;
const INTERNAL: readonly RegExp[] = [
  /\b(?:INVITED|JOINED|VOTED|GATED|HELD|CAPTURED|RELEASED|DECLINED|COLLECTING|RESEARCHING|VOTING|ORDERING|APPROVING|COMMITTING|CONFIRMED|CANCELLING|CANCELLED|SHOWCASE)\b/,
  /\bmode\W{0,3}(?:(?:is|=)\W{0,3})?(?:chat|prefs)/i,
  /\b(?:your|my|the|current)\s+(?:mode|stage|state)\s+(?:is|=|says)\b/i,
  /\b(?:json|system prompt|my (?:prompt|instructions|notes|data|context|input)|(?:the|my) facts|according to my (?:info|data|notes))\b/i,
];

/** True iff the reply echoes an internal identifier or label. Snake_case the person typed themselves is theirs. */
export function echoesInternals(reply: string, ownText: string): boolean {
  for (const [tok] of reply.matchAll(SNAKE)) if (!ownText.includes(tok)) return true;
  return INTERNAL.some((re) => re.test(reply));
}

const NUMBER = /\d+(?:\.\d+)?/g;
/** "05" and "5", "31.10" and "31.1" are the same number. */
const normNum = (tok: string): string => String(Number(tok));

/**
 * Every number the delegate was given (counts, picks, times, addresses, the sender's own text), plus the 12-hour hour
 * of each HH:MM so "18:30" covers "6". ConverseInput never holds a budget, so this set is secret-free.
 */
function allowedNumbers(input: ConverseInput): Set<string> {
  const json = JSON.stringify({ ...input }) + JSON.stringify(converseWire(input));
  const allowed = new Set((json.match(NUMBER) ?? []).map(normNum));
  for (const [, h] of json.matchAll(/(\d{1,2}):\d{2}/g)) allowed.add(String(Number(h) % 12 || 12));
  return allowed;
}

/**
 * Code guard on generated text before it can be sent: length, any money amount, card-like digits, any number that
 * is not already in the delegate's own input, and any echoed internal identifier or label (callers fall back to a
 * template). Synchronous and secret-independent on purpose: a guard that
 * compared against other members' budgets would make "blocked vs sent" an oracle for those values (P1/P2).
 */
export function guardReply(reply: string, input: ConverseInput): GuardVerdict {
  if (reply.length === 0 || reply.length > MAX_REPLY) return "length";
  if (MONEY.test(reply)) return "money";
  if (containsCardNumber(reply) || LONG_DIGITS.test(reply)) return "card";
  const allowed = allowedNumbers(input);
  for (const [tok] of reply.replace(CLOCK, " ").matchAll(NUMBER)) if (!allowed.has(normNum(tok))) return "number";
  if (echoesInternals(reply, input.message_text)) return "internal";
  return "ok";
}

/** One delegate call; null when there is no converser (LLM_MODE=mock), the call failed, or the model wasn't confident. */
export async function askDelegate(input: ConverseInput, lane: number | null): Promise<ConverseResult | null> {
  const converser = asConverser(ports.llm);
  if (!converser) return null;
  if (lane !== null) void emitDelegateXray(lane);
  const r = await converser.converse(withWireForm(input));
  return r && r.confidence === "high" ? { ...r, reply: r.reply.trim() } : null;
}

/** Sends generated text as T_DELEGATE_REPLY iff it passes guardReply. Returns whether it was sent. */
export async function sendGuardedReply(userId: string, planId: string | undefined, reply: string, e: InboundEvent, input: ConverseInput, n = 1): Promise<boolean> {
  const verdict = guardReply(reply, input);
  if (verdict !== "ok") {
    log.info({ plan_id: planId ?? null, verdict }, "delegate reply blocked");
    return false;
  }
  await notify(userId, "T_DELEGATE_REPLY", { text: reply }, { key: replyKey(e.message_id, n), ...(planId ? { planId } : {}) });
  return true;
}
