// Private budget delegate (A plan T6; P1 allowlist). Owner A.
// Budget values never leave this module except into the private constraints store and the owner's own confirmation template.
import { BudgetParse, type InboundEvent } from "@tab/shared";
import { effectiveHardMax } from "../decide/filter";
import { enqueue } from "../dueJobs";
import { A_JOB_KINDS, aJobKeys } from "../jobs/kinds";
import * as holdGate from "../money/holdGate";
import { notify, replyKey } from "../notify/notify";
import { usd0 } from "../notify/render";
import { stageAtLeast } from "../plan/machine";
import { setStage } from "../plan/membership";
import { ports } from "../ports";
import * as privateConstraints from "../repo/privateConstraints";
import type { MemberContext } from "../repo/types";
import { clearAwaiting, setAwaiting } from "./awaiting";
import { buildDelegateInput, emitDelegateXray } from "./input";

export type Tier = 1 | 2 | 3 | 4;
type Budget = { target_pp_cents: number; hard_max_pp_cents: number | null };

/** Tier replies (code only): 4 = no cap → T_BUDGET_CONFIRM_NOCAP. Written with source 'tier', confidence 'high'. */
export const TIER_MAP: Readonly<Record<Tier, Budget>> = {
  1: { target_pp_cents: 4000, hard_max_pp_cents: 5000 },
  2: { target_pp_cents: 6500, hard_max_pp_cents: 8000 },
  3: { target_pp_cents: 10000, hard_max_pp_cents: 12000 },
  4: { target_pp_cents: 50000, hard_max_pp_cents: null },
};

/** Code acceptance after the LLM: confidence high, 500 ≤ target ≤ 100000, hard_max null or target ≤ hard_max ≤ 100000. */
export function acceptBudget(p: BudgetParse | null): p is BudgetParse {
  if (!p || !BudgetParse.safeParse(p).success || p.confidence !== "high") return false;
  const { target_pp_cents: t, hard_max_pp_cents: m } = p;
  return t >= 500 && t <= 100_000 && (m === null || (m >= t && m <= 100_000));
}

const CAP_WORD = /\b(?:max|maximum|tops|limit|most|only|cap)\b/i;
const NEGATION_OR_QUESTION = /\?|\b(?:not|no|never)\b|n't\b/i;

/**
 * acceptBudget, plus a deterministic safety net for one exact phrasing the LLM sometimes rates low: a single number
 * stated as a ceiling ("my max is 15 now"). A low-confidence parse is taken only when the text holds exactly one
 * number, it equals the parsed target in dollars, the parsed max is null or equal to it, the text carries a cap word
 * and no question or negation. The cap word makes that number the hard max too. Anything else still gets the tiers.
 */
export function acceptedBudget(p: BudgetParse | null, text: string): Budget | null {
  if (!p) return null;
  const { target_pp_cents: pt, hard_max_pp_cents: pm } = p; // read before acceptBudget's guard narrows `p` away
  if (acceptBudget(p)) return { target_pp_cents: pt, hard_max_pp_cents: pm };
  const numbers = text.match(/\d+(?:\.\d+)?/g) ?? [];
  if (numbers.length !== 1 || !CAP_WORD.test(text) || NEGATION_OR_QUESTION.test(text)) return null;
  const t = Math.round(Number(numbers[0]) * 100);
  if (pt !== t || (pm !== null && pm !== t)) return null;
  const capped = { target_pp_cents: t, hard_max_pp_cents: t, confidence: "high" as const };
  return acceptBudget(capped) ? { target_pp_cents: t, hard_max_pp_cents: t } : null;
}

/** "No cap" is the tier-4 sentinel; an ordinary DM budget without a ceiling still gets the slack-derived max. */
const isNoCap = (c: Budget): boolean => c.hard_max_pp_cents === null && c.target_pp_cents >= TIER_MAP[4].target_pp_cents;

/** Sends the owner's own confirmation (template, P4): the only place a budget value is rendered. */
function sendConfirm(ctx: MemberContext, c: Budget, key: string) {
  const o = { key, planId: ctx.plan.id };
  return isNoCap(c)
    ? notify(ctx.user.id, "T_BUDGET_CONFIRM_NOCAP", {}, o)
    : notify(ctx.user.id, "T_BUDGET_CONFIRM", { target: usd0(c.target_pp_cents), max: usd0(effectiveHardMax(c)) }, o);
}

/**
 * Budget-stage text: parseBudget(buildDelegateInput(…,"budget",text)) → acceptedBudget ? confirmBudget(…,"dm") :
 * `unclear` if given and it replied (the router passes the delegate's answer for questions; the awaiting flag is left
 * as is), else T_BUDGET_TIERS + awaiting 'tiers'.
 */
export async function handleBudgetText(ctx: MemberContext, e: InboundEvent, unclear?: () => Promise<boolean>): Promise<void> {
  void emitDelegateXray(ctx.participant.lane);
  const text = e.text ?? "";
  const budget = acceptedBudget(await ports.llm.parseBudget(buildDelegateInput(ctx.user.first_name, "budget", text)), text);
  if (budget) {
    await confirmBudget(ctx, budget, "dm", e);
    return;
  }
  if (unclear && (await unclear())) return;
  setAwaiting(ctx.user.id, "tiers");
  await notify(ctx.user.id, "T_BUDGET_TIERS", {}, { key: replyKey(e.message_id, 1), planId: ctx.plan.id });
}

/** Awaiting 'tiers' reply 1–4 → confirmBudget(TIER_MAP[tier], "tier"). */
export async function applyTier(ctx: MemberContext, tier: Tier, e: InboundEvent): Promise<void> {
  await confirmBudget(ctx, TIER_MAP[tier], "tier", e);
}

/**
 * Locks a budget: privateConstraints.upsert(confidence 'high', confirmed_at now) → T_BUDGET_CONFIRM
 * {target: usd0(target), max: usd0(effectiveHardMax)} (or _NOCAP) → clear awaiting → JOINED ⇒ BUDGET_LOCKED + T_PREFS_ASK;
 * plan VOTING ⇒ enqueue recompute (key recompute:<planId>:<e.event_id>); order exists and not HELD ⇒ holdGate.recheck.
 * Replies use replyKey(e.message_id, 1|2), so a re-delivered inbound never double-sends and a later "change budget"
 * (a new inbound) always gets its own confirmation.
 */
export async function confirmBudget(ctx: MemberContext, c: Budget, source: "dm" | "tier", e: InboundEvent): Promise<void> {
  const { user, plan, participant } = ctx;
  await privateConstraints.upsert({
    plan_id: plan.id,
    user_id: user.id,
    target_pp_cents: c.target_pp_cents,
    hard_max_pp_cents: c.hard_max_pp_cents,
    source,
    confidence: "high",
    confirmed_at: new Date().toISOString(),
  });
  clearAwaiting(user.id);
  await sendConfirm(ctx, c, replyKey(e.message_id, 1));

  if (participant.stage === "JOINED") {
    await setStage(plan.id, user.id, "BUDGET_LOCKED");
    await notify(user.id, "T_PREFS_ASK", {}, { key: replyKey(e.message_id, 2), planId: plan.id });
  }
  if (plan.state === "VOTING") {
    await enqueue(A_JOB_KINDS.recompute, aJobKeys.recompute(plan.id, e.event_id), new Date(), {}, { planId: plan.id });
  }
  // holdGate.recheck guards state (APPROVING) and stage (GATED/LINK_SENT) itself, so HELD/CAPTURED members are untouched.
  if (plan.venue_order_id) await holdGate.recheck(ctx);
}

/**
 * JOIN text with a budget already given on the join form: if one exists, send T_BUDGET_CONFIRM (or _NOCAP) +
 * T_PREFS_ASK, set BUDGET_LOCKED and return true; otherwise return false (caller sends T_BUDGET_ASK).
 * Lives here because only P1-allowlisted code may read the stored values.
 * Keys replyKey(e.message_id, 2|3): n=1 on the JOIN inbound belongs to membership.onJoinText's T_JOIN_WELCOME.
 */
export async function confirmFormBudget(ctx: MemberContext, e: InboundEvent): Promise<boolean> {
  const c = await privateConstraints.get(ctx.plan.id, ctx.user.id);
  if (!c) return false;
  clearAwaiting(ctx.user.id);
  await sendConfirm(ctx, c, replyKey(e.message_id, 2));
  // A repeated JOIN from a member already past the budget step must not move them backwards.
  if (!stageAtLeast(ctx.participant.stage, "BUDGET_LOCKED")) {
    await setStage(ctx.plan.id, ctx.user.id, "BUDGET_LOCKED");
    await notify(ctx.user.id, "T_PREFS_ASK", {}, { key: replyKey(e.message_id, 3), planId: ctx.plan.id });
  }
  return true;
}
