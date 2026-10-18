// The inbound dispatcher (A plan T3). src/inbound.ts handleInbound() delegates here once A wires it. Owner A.
// Never logs, emits or stores e.text; the card intercept runs before anything that could.
import type { InboundEvent } from "@tab/shared";
import { getAwaiting, clearAwaiting, type AwaitingFlag } from "../delegates/awaiting";
import { applyTier, handleBudgetText } from "../delegates/budget";
import { handleBallotText } from "../delegates/ballot";
import { converseReply, handleFreeText, mentionsOthersBudget, otherFirstNames, sendOnlyYours } from "../delegates/free";
import { handlePrefsText } from "../delegates/prefs";
import { emit } from "../events";
import { joinWouldOverfill } from "../join/capacity";
import * as holdGate from "../money/holdGate";
import { notifyRaw, replyKey } from "../notify/notify";
import { markReadSafe, typingOn } from "../notify/presence";
import { usd2 } from "../notify/render";
import { handleDigitsBallot } from "../plan/ballots";
import { stageAtLeast, TERMINAL_STAGES } from "../plan/machine";
import { onJoinText, onNameText } from "../plan/membership";
import { handleStartText, hasStartDraft } from "../plan/startByChat";
import type { DmAddress } from "../ports";
import { upsertDmRoute } from "../repo/dmRoutes";
import * as holdGates from "../repo/holdGates";
import { getParticipant, newestInvitedPlanForUser } from "../repo/participants";
import { currentPlanForUser, recentConfirmedPlan } from "../repo/plans";
import type { MemberContext, PlanRow, UserRow } from "../repo/types";
import { findUserByPhone, findUserByPhotonId, setPhotonUserId } from "../repo/users";
import { getPayLink } from "../repo/payLinks";
import { isPrefillText, isStartPrefill, looksLikeName, parseCommand, parseDigitsBallot, parseTier, parseYesNo } from "./commands";
import { handleCommand, reply, sendAlreadyInPlan } from "./handlers";
import { containsCardNumber } from "./luhn";

/**
 * Fixed order, first match wins:
 * 0 resolve user (photon_user_id, else phone → setPhotonUserId) and upsert dm_route;
 * 1 text null → markReadSafe, return; 2 containsCardNumber → T_CARD_INTERCEPT (replyTo), system event, return
 * (before ANY log/LLM/text write); 3 markReadSafe; 4 no user → notifyRaw(T_NOT_IN_PLAN);
 * 5 INVITED (a /join lane, found by loadContext only when no live lane exists) and not a leave/other-plan command →
 * onJoinText (any first text joins: ux-flow §8.1), or T_PLAN_FULL when 8 texted lanes are already in (the same cap as a
 * JOIN command); else parseCommand → handleCommand; a web pre-fill
 * (isPrefillText) → status, except the /start pre-fill in a pre-commit plan → T_ALREADY_IN_PLAN (all deterministic, so no typing bubble); then typingOn; no active plan → start-by-chat
 * (plan/startByChat.ts); a CONFIRMED plan → free text;
 * 6 another member's budget asked about during the budget/prefs steps → T_ONLY_YOURS (code check, no stage change);
 * 7 awaiting flags (holdgate/tiers/budget/name; under 'tiers' a yes/no drops the menu and a question that isn't a
 * budget goes to the free-text delegate); 8 stage handlers (JOINED → budget, where a question that isn't a budget gets
 * the delegate's answer plus the budget question again; BUDGET_LOCKED → prefs, VOTING ∧ ≥PREFS_DONE → digits or
 * delegate ballot, else free).
 */
export async function route(e: InboundEvent): Promise<void> {
  const addr: DmAddress = { userId: e.from_user_id, spaceId: e.space_id, agentUserId: e.agent_user_id };
  const user = await resolveUser(e);
  if (user) await upsertDmRoute({ user_id: user.id, space_id: e.space_id, agent_user_id: e.agent_user_id, agent_number: null });

  const text = e.text;
  if (text === null) return markReadSafe(e);

  const ctx = user ? await loadContext(user, isStartPrefill(text)) : null;

  if (containsCardNumber(text)) {
    if (user) await reply(user, "T_CARD_INTERCEPT", {}, e, ctx?.plan.id);
    else await notifyRaw(addr, "T_NOT_IN_PLAN", {}, replyKey(e.message_id, 1));
    await emit({ type: "system", level: "info", msg: `card number intercepted${ctx ? ` (lane ${ctx.participant.lane})` : ""}` });
    return;
  }

  markReadSafe(e);

  if (!user) {
    await notifyRaw(addr, "T_NOT_IN_PLAN", {}, replyKey(e.message_id, 1));
    return;
  }

  const cmd = parseCommand(text);
  // Forgiving first message: an INVITED member's first text joins whatever it says ("I'm in for Dinner + show!",
  // "hey"). Leaving, forget-me and a JOIN for another plan still run as commands.
  const joinsCurrent = !cmd || cmd.kind === "help" || cmd.kind === "status" || (cmd.kind === "join" && cmd.code === ctx?.plan.code);
  if (ctx?.participant.stage === "INVITED" && joinsCurrent) {
    // The same 8-lane cap as a JOIN command (handlers.ts): the lane stays INVITED, so a later text works once a spot frees.
    if (await joinWouldOverfill(user, ctx.plan.code)) return void (await reply(user, "T_PLAN_FULL", {}, e));
    return onJoinText(user, ctx.plan.code, e);
  }
  if (cmd) return handleCommand(user, ctx, cmd, e);
  // The /start pre-fill from someone still in an open plan (no hold of theirs yet) is a wish to plan something new, not
  // a message for that plan: say which plan they're in and offer 'new plan' or 'status'. With a hold, or once the plan
  // is committing or booked, it falls through to the status below.
  if (ctx && isStartPrefill(text) && isPreCommit(ctx)) return sendAlreadyInPlan(ctx, e);
  // A member already past INVITED who taps Start or Open Messages again sends a pre-filled sentence. It is never a
  // budget, preference or vote, so it gets the status. Awaiting flags stay set for the member's next real answer.
  if (ctx && isPrefillText(text, ctx.plan.title)) return handleCommand(user, ctx, { kind: "status" }, e);
  // Fired only before handlers that may call the LLM: a fast deterministic reply could otherwise land before the
  // typing request and leave a bubble showing after the answer.
  typingOn(addr);
  if (!ctx) return handleStartText(user, e);
  if (ctx.plan.state === "CONFIRMED") {
    clearAwaiting(user.id); // nothing can change after capture; a leftover budget/tiers flag must not reopen it
    return handleFreeText(user, ctx, e);
  }

  let flag = await awaitingFlag(ctx);
  const { stage } = ctx.participant;
  if (flag === "tiers" && parseYesNo(text)) {
    // The 1–4 menu never asks a yes/no question, so this answers something else (often a pending hold gate): drop
    // the menu and re-read the flag, which finds the gate row again (awaitingFlag).
    clearAwaiting(user.id);
    flag = await awaitingFlag(ctx);
  }
  const answering = flag === "tiers" || flag === "budget" || stage === "JOINED" || stage === "BUDGET_LOCKED";
  if (answering && mentionsOthersBudget(text, await otherFirstNames(ctx))) {
    // "what's Sam's budget?" is a question, not this person's budget or preferences: answer it, keep the step open.
    await sendOnlyYours(user.id, ctx.plan.id, e);
    return;
  }
  if (flag === "holdgate") {
    const yn = parseYesNo(text);
    if (yn) return holdGate.answer(ctx, yn === "yes", e);
    if (await resendHoldGate(ctx, e)) return;
    clearAwaiting(user.id); // stale flag: the gate is gone, so treat the text like any other
  } else if (flag === "tiers") {
    const tier = parseTier(text);
    if (tier) return applyTier(ctx, tier, e);
    // A question that doesn't parse as a budget ("wait what does that mean") gets the delegate's answer instead of
    // the same menu again (the menu stays open for the next reply); with no usable answer the menu is resent.
    return handleBudgetText(ctx, e, isQuestion(text) ? () => converseReply(user, ctx, e) : undefined);
  } else if (flag === "budget") {
    return handleBudgetText(ctx, e);
  } else if (flag === "name") {
    // Only right after T_JOIN_WELCOME_NAME, and only once: a non-name ("40 max") is the budget answer, and a blank name
    // is never asked again. Never inferred from first_name === "" alone (a budget reply would become a name).
    clearAwaiting(user.id);
    if (ctx.participant.stage === "JOINED") {
      const name = looksLikeName(text);
      return name ? onNameText(ctx, name, e) : firstBudgetAnswer(ctx, e);
    }
  }

  if (stage === "JOINED") return firstBudgetAnswer(ctx, e);
  if (stage === "BUDGET_LOCKED") return handlePrefsText(ctx, e);
  if (ctx.plan.state === "VOTING" && stageAtLeast(stage, "PREFS_DONE")) {
    const digits = parseDigitsBallot(text);
    return digits ? handleDigitsBallot(ctx, digits, e) : handleBallotText(ctx, e);
  }
  return handleFreeText(user, ctx, e);
}

/**
 * The answer to the first budget ask (T_BUDGET_ASK / _NAMED; no menu shown yet). A budget-shaped reply still parses
 * first. A question that doesn't ("wait, why do you need my budget?") gets the delegate's answer and then the budget
 * question again instead of the 1–4 menu; with no usable delegate answer (mock LLM, blocked reply) the menu goes out.
 */
function firstBudgetAnswer(ctx: MemberContext, e: InboundEvent): Promise<void> {
  return handleBudgetText(ctx, e, isQuestion(e.text ?? "") ? () => answerThenReaskBudget(ctx, e) : undefined);
}

async function answerThenReaskBudget(ctx: MemberContext, e: InboundEvent): Promise<boolean> {
  if (!(await converseReply(ctx.user, ctx, e, { mode: "budget_question" }))) return false;
  // A set flag means the delegate's dispatch already asked for the budget itself ('change budget' → T_BUDGET_REASK, or
  // the menu): asking again would double up. n=2: the delegate's own reply to this inbound is n=1.
  if (!getAwaiting(ctx.user.id)) await reply(ctx.user, "T_BUDGET_REASK", {}, e, ctx.plan.id, 2);
  return true;
}

/** Reads as a question: ends in "?" or opens with a question word ("wait what does that mean", "huh"). */
export function isQuestion(text: string): boolean {
  return /\?\s*$/.test(text) || /^\s*(?:wait|what|whats|what's|why|how|huh|which|when|where|who|is|does|do|can|could)\b/i.test(text);
}

/** By Photon user id first, else by phone (and remember the id). The handle format is unverified, so both paths exist. */
async function resolveUser(e: InboundEvent): Promise<UserRow | null> {
  const byId = await findUserByPhotonId(e.from_user_id);
  if (byId) return byId;
  const byPhone = await findUserByPhone(e.from_handle);
  if (!byPhone) return null;
  await setPhotonUserId(byPhone.id, e.from_user_id);
  return { ...byPhone, photon_user_id: e.from_user_id };
}

/**
 * The first live (not declined or released) lane of, in order:
 * 1. the user's most recent active plan where they are past INVITED (currentPlanForUser);
 * 2. the newest still-joinable plan where /join gave this phone an INVITED lane. currentPlanForUser skips those rows
 *    so a form with someone else's number can never take over a live member's texts, but with no live lane this text
 *    from the phone itself proves possession, and route() turns it into the forgiving join;
 * 3. the newest CONFIRMED plan they held or were charged a share in (repo recentConfirmedPlan: HELD counts too, so a
 *    lost share.captured hook can't drop them), while its date is today or yesterday (LA time): right after a booking
 *    is exactly when people text "what time is dinner?" or "status". A pending invite wins over it, or the first text
 *    of someone who booked last night and joined a new plan today would never reach the new plan.
 * The /start pre-fill ("help me plan a night out") skips 2 and 3, and a start chat already under way skips 3: that
 * person is starting a plan of their own, not answering an old invite or asking about last night's booking.
 */
async function loadContext(user: UserRow, startsOwnPlan: boolean): Promise<MemberContext | null> {
  const live = await liveLane(user, await currentPlanForUser(user.id));
  if (live || startsOwnPlan) return live;
  const invited = await liveLane(user, await newestInvitedPlanForUser(user.id));
  if (invited || hasStartDraft(user.id)) return invited;
  return liveLane(user, await recentConfirmedPlan(user.id));
}

async function liveLane(user: UserRow, plan: PlanRow | null): Promise<MemberContext | null> {
  const participant = plan ? await getParticipant(plan.id, user.id) : null;
  return plan && participant && !TERMINAL_STAGES.includes(participant.stage) ? { user, plan, participant } : null;
}

/** Pre-commit: COLLECTING|RESEARCHING|VOTING, or APPROVING before this person holds: leaving costs nobody anything. */
function isPreCommit({ plan, participant }: MemberContext): boolean {
  if (plan.state === "COLLECTING" || plan.state === "RESEARCHING" || plan.state === "VOTING") return true;
  return plan.state === "APPROVING" && !stageAtLeast(participant.stage, "HELD");
}

/** The in-memory flag, or (after a restart) the pending hold_gates row, which is the source of truth for 'holdgate'. */
async function awaitingFlag({ user, plan, participant }: MemberContext): Promise<AwaitingFlag | null> {
  const flag = getAwaiting(user.id);
  if (flag || plan.state !== "APPROVING" || participant.stage !== "GATED") return flag;
  const gate = await holdGates.findPendingHoldGate(user.id);
  return gate?.plan_id === plan.id ? "holdgate" : null;
}

/** A non-yes/no reply while a gate is pending repeats the question (same amount, threaded under this reply). */
async function resendHoldGate({ user, plan }: MemberContext, e: InboundEvent): Promise<boolean> {
  const [gate, link] = await Promise.all([holdGates.getHoldGate(plan.id, user.id, plan.version), getPayLink(plan.id, user.id, plan.version)]);
  if (gate?.status !== "pending" || !link) return false;
  await reply(user, "T_HOLD_GATE", { amount: usd2(link.amount_cents) }, e, plan.id);
  return true;
}
