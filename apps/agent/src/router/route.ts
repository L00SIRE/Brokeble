// The inbound dispatcher (A plan T3). src/inbound.ts handleInbound() delegates here once A wires it. Owner A.
// Never logs, emits or stores e.text; the card intercept runs before anything that could.
import type { InboundEvent } from "@tab/shared";
import { getAwaiting, clearAwaiting, type AwaitingFlag } from "../delegates/awaiting";
import { applyTier, handleBudgetText } from "../delegates/budget";
import { handleBallotText } from "../delegates/ballot";
import { handleFreeText } from "../delegates/free";
import { handlePrefsText } from "../delegates/prefs";
import { emit } from "../events";
import * as holdGate from "../money/holdGate";
import { notifyRaw, replyKey } from "../notify/notify";
import { markReadSafe, typingOn } from "../notify/presence";
import { usd2 } from "../notify/render";
import { handleDigitsBallot } from "../plan/ballots";
import { stageAtLeast, TERMINAL_STAGES } from "../plan/machine";
import { onJoinText, onNameText } from "../plan/membership";
import { handleStartText } from "../plan/startByChat";
import type { DmAddress } from "../ports";
import { upsertDmRoute } from "../repo/dmRoutes";
import * as holdGates from "../repo/holdGates";
import { getParticipant } from "../repo/participants";
import { currentPlanForUser } from "../repo/plans";
import type { MemberContext, UserRow } from "../repo/types";
import { findUserByPhone, findUserByPhotonId, setPhotonUserId } from "../repo/users";
import { getPayLink } from "../repo/payLinks";
import { isPrefillText, looksLikeName, parseCommand, parseDigitsBallot, parseTier, parseYesNo } from "./commands";
import { handleCommand, reply } from "./handlers";
import { containsCardNumber } from "./luhn";

/**
 * Fixed order, first match wins:
 * 0 resolve user (photon_user_id, else phone → setPhotonUserId) and upsert dm_route;
 * 1 text null → markReadSafe, return; 2 containsCardNumber → T_CARD_INTERCEPT (replyTo), system event, return
 * (before ANY log/LLM/text write); 3 markReadSafe + typingOn; 4 no user → notifyRaw(T_NOT_IN_PLAN);
 * 5 INVITED and not a leave/other-plan command → onJoinText (any first text joins: ux-flow §8.1); else parseCommand →
 * handleCommand; no active plan → start-by-chat (plan/startByChat.ts); a web pre-fill (isPrefillText) → status;
 * 6 awaiting flags (holdgate/tiers/budget/name);
 * 7 stage handlers (JOINED → budget, BUDGET_LOCKED → prefs, VOTING ∧ ≥PREFS_DONE → digits or delegate ballot, else free).
 */
export async function route(e: InboundEvent): Promise<void> {
  const addr: DmAddress = { userId: e.from_user_id, spaceId: e.space_id, agentUserId: e.agent_user_id };
  const user = await resolveUser(e);
  if (user) await upsertDmRoute({ user_id: user.id, space_id: e.space_id, agent_user_id: e.agent_user_id, agent_number: null });

  const text = e.text;
  if (text === null) return markReadSafe(e);

  const ctx = user ? await loadContext(user) : null;

  if (containsCardNumber(text)) {
    if (user) await reply(user, "T_CARD_INTERCEPT", {}, e, ctx?.plan.id);
    else await notifyRaw(addr, "T_NOT_IN_PLAN", {}, replyKey(e.message_id, 1));
    await emit({ type: "system", level: "info", msg: `card number intercepted${ctx ? ` (lane ${ctx.participant.lane})` : ""}` });
    return;
  }

  markReadSafe(e);
  typingOn(addr);

  if (!user) {
    await notifyRaw(addr, "T_NOT_IN_PLAN", {}, replyKey(e.message_id, 1));
    return;
  }

  const cmd = parseCommand(text);
  // Forgiving first message: an INVITED member's first text joins whatever it says ("I'm in for Dinner + show!",
  // "hey"). Leaving, forget-me and a JOIN for another plan still run as commands.
  const joinsCurrent = !cmd || cmd.kind === "help" || cmd.kind === "status" || (cmd.kind === "join" && cmd.code === ctx?.plan.code);
  if (ctx?.participant.stage === "INVITED" && joinsCurrent) return onJoinText(user, ctx.plan.code, e);
  if (cmd) return handleCommand(user, ctx, cmd, e);
  if (!ctx) return handleStartText(user, e);
  // A member already past INVITED who taps Start or Open Messages again sends a pre-filled sentence. It is never a
  // budget, preference or vote, so it gets the status. Awaiting flags stay set for the member's next real answer.
  if (isPrefillText(text, ctx.plan.title)) return handleCommand(user, ctx, { kind: "status" }, e);

  const flag = await awaitingFlag(ctx);
  if (flag === "holdgate") {
    const yn = parseYesNo(text);
    if (yn) return holdGate.answer(ctx, yn === "yes", e);
    if (await resendHoldGate(ctx, e)) return;
    clearAwaiting(user.id); // stale flag: the gate is gone, so treat the text like any other
  } else if (flag === "tiers") {
    const tier = parseTier(text);
    return tier ? applyTier(ctx, tier, e) : handleBudgetText(ctx, e);
  } else if (flag === "budget") {
    return handleBudgetText(ctx, e);
  } else if (flag === "name") {
    // Only right after T_JOIN_WELCOME_NAME, and only once: a non-name ("40 max") is the budget answer, and a blank name
    // is never asked again. Never inferred from first_name === "" alone (a budget reply would become a name).
    clearAwaiting(user.id);
    if (ctx.participant.stage === "JOINED") {
      const name = looksLikeName(text);
      return name ? onNameText(ctx, name, e) : handleBudgetText(ctx, e);
    }
  }

  const { stage } = ctx.participant;
  if (stage === "JOINED") return handleBudgetText(ctx, e);
  if (stage === "BUDGET_LOCKED") return handlePrefsText(ctx, e);
  if (ctx.plan.state === "VOTING" && stageAtLeast(stage, "PREFS_DONE")) {
    const digits = parseDigitsBallot(text);
    return digits ? handleDigitsBallot(ctx, digits, e) : handleBallotText(ctx, e);
  }
  return handleFreeText(user, ctx, e);
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

/** The user's lane in their most recent active plan; null once they declined or were released. */
async function loadContext(user: UserRow): Promise<MemberContext | null> {
  const plan = await currentPlanForUser(user.id);
  const participant = plan ? await getParticipant(plan.id, user.id) : null;
  return plan && participant && !TERMINAL_STAGES.includes(participant.stage) ? { user, plan, participant } : null;
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
