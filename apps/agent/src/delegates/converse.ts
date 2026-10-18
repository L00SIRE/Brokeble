// Conversational private delegate (PLAN §3: free replies come from the person's OWN delegate). Owner A.
// Context = that person's own data + public plan facts only (P2); the model never sees any budget value. Its text goes
// out only through notify (T_DELEGATE_REPLY) after a code guard; money/privacy messages stay fixed templates (P4).
// Never logs message text or reply text.
import type { InboundEvent, LaneStage, PublicBundle } from "@tab/shared";
import { effectiveHardMax } from "../decide/filter";
import { log } from "../log";
import { notify, replyKey } from "../notify/notify";
import { fmtDate, fmtDeadline } from "../notify/render";
import { STAGE_ORDER, stageAtLeast } from "../plan/machine";
import { ports } from "../ports";
import { countByStage } from "../repo/participants";
import { getPreferences } from "../repo/preferences";
import * as privateConstraints from "../repo/privateConstraints";
import type { MemberContext, PlanRow, UserRow } from "../repo/types";
import { containsCardNumber } from "../router/luhn";
import { asConverser, type ConverseInput, type ConverseResult } from "./converseSchema";
import { emitDelegateXray } from "./input";

/** T_DELEGATE_REPLY's {text} cap (packages/shared templates). */
export const MAX_REPLY = 600;

const BASE_COMMANDS = ["status", "I'm out", "change budget", "receipts", "forget me", "help"];
const ORGANIZER_COMMANDS = ["go (start with whoever's ready)", "wait", "cancel plan"];

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
      return "Everyone's in, so I'm booking it now.";
    case "CONFIRMED":
      return "You're booked! Your itinerary is on its way.";
    case "CANCELLING":
    case "CANCELLED":
      return "This plan was called off. Nobody was charged.";
    case "SHOWCASE":
      return "This is a demo plan.";
  }
}

/** Public picks for the voting context: number, title and times only (no prices: the delegate never talks money). */
export const picksForContext = (shortlist: readonly PublicBundle[]): string[] =>
  shortlist.map((b) => `${b.index}. ${b.title} (dinner ${b.dinner_time}, show ${b.show_start}-${b.show_end_est})`);

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
      ...base, plan: null, is_organizer: false, my_preferences: null, my_budget_set: false, commands: BASE_COMMANDS,
      where_things_stand: "They're not in an active plan right now. To start, they tap the join link a friend shares.",
    };
  }
  const { plan, participant } = ctx;
  const [by, prefs, own] = await Promise.all([
    countByStage(plan.id),
    getPreferences(plan.id, user.id),
    privateConstraints.get(plan.id, user.id),
  ]);
  const isOrganizer = plan.organizer_id === user.id;
  return {
    ...base,
    plan: { title: plan.title, date: fmtDate(plan.event_date), start_time: clock12(plan.time_start), area: plan.area },
    is_organizer: isOrganizer,
    where_things_stand: whereThingsStand(plan, participant.stage, by),
    my_preferences: prefs,
    my_budget_set: own !== null,
    commands: isOrganizer ? [...BASE_COMMANDS, ...ORGANIZER_COMMANDS] : BASE_COMMANDS,
  };
}

// Any money amount at all: the delegate is told never to write one, so a hit means it went off-script.
const MONEY = /[$€£¢]|\b\d+(?:[.,]\d+)?\s*(?:dollars?|bucks|usd|k)\b/i;
// A long digit run that could be (part of) a card or account number, even if it fails Luhn.
const LONG_DIGITS = /\d(?:[ -]?\d){11,}/;
const CLOCK = /\b\d{1,2}:\d{2}\b/g;

export type GuardVerdict = "ok" | "length" | "money" | "card" | "budget_value";

/** True if a number token equals any of the budget values (cents), read as dollars ("31", "31.17") or raw cents ("3117"). */
export function matchesBudgetValue(text: string, centsValues: readonly number[]): boolean {
  if (centsValues.length === 0) return false;
  const values = new Set(centsValues);
  const dollars = new Set(centsValues.flatMap((c) => [Math.floor(c / 100), Math.round(c / 100)]));
  for (const [tok] of text.replace(CLOCK, " ").matchAll(/\d+(?:\.\d+)?/g)) {
    const n = Number(tok);
    if (tok.includes(".") ? values.has(Math.round(n * 100)) : dollars.has(n) || values.has(n)) return true;
  }
  return false;
}

/**
 * Code guard on generated text before it can be sent: length, any money amount, card-like digits, and (value-specific)
 * any number matching ANY member's private budget values for this plan. Fails closed if the values can't be read.
 * Budget values are compared here only; they are never logged or returned.
 */
export async function guardReply(reply: string, planId: string | null): Promise<GuardVerdict> {
  if (reply.length === 0 || reply.length > MAX_REPLY) return "length";
  if (MONEY.test(reply)) return "money";
  if (containsCardNumber(reply) || LONG_DIGITS.test(reply)) return "card";
  if (!planId || !/\d/.test(reply)) return "ok";
  try {
    const all = await privateConstraints.listForPlan(planId);
    const cents = all.flatMap((c) => [c.target_pp_cents, effectiveHardMax(c), ...(c.hard_max_pp_cents === null ? [] : [c.hard_max_pp_cents])]);
    return matchesBudgetValue(reply, cents) ? "budget_value" : "ok";
  } catch {
    return "budget_value";
  }
}

/** One delegate call; null when there is no converser (LLM_MODE=mock), the call failed, or the model wasn't confident. */
export async function askDelegate(input: ConverseInput, lane: number | null): Promise<ConverseResult | null> {
  const converser = asConverser(ports.llm);
  if (!converser) return null;
  if (lane !== null) void emitDelegateXray(lane);
  const r = await converser.converse(input);
  return r && r.confidence === "high" ? { ...r, reply: r.reply.trim() } : null;
}

/** Sends generated text as T_DELEGATE_REPLY iff it passes guardReply. Returns whether it was sent. */
export async function sendGuardedReply(userId: string, planId: string | undefined, reply: string, e: InboundEvent, n = 1): Promise<boolean> {
  const verdict = await guardReply(reply, planId ?? null);
  if (verdict !== "ok") {
    log.info({ plan_id: planId ?? null, verdict }, "delegate reply blocked");
    return false;
  }
  await notify(userId, "T_DELEGATE_REPLY", { text: reply }, { key: replyKey(e.message_id, n), ...(planId ? { planId } : {}) });
  return true;
}
