// Chat command handlers (A plan T11/T13). Replies use replyKey(e.message_id, n). No names, no budgets. Owner A.
import type { InboundEvent, LaneStage, TemplateId, TemplateVars } from "@tab/shared";
import { cancelResearch } from "../creao/research";
import { clearAwaiting, setAwaiting } from "../delegates/awaiting";
import { sql } from "../db";
import { joinWouldOverfill } from "../join/capacity";
import { releaseSeat } from "../join/seats";
import { errInfo, log } from "../log";
import { fanout } from "../notify/fanout";
import { notify, replyKey } from "../notify/notify";
import { stopPlanTyping } from "../notify/presence";
import { fmtDate, usd2 } from "../notify/render";
import { cancel } from "../plan/cancel";
import { STAGE_ORDER, stageAtLeast, transition } from "../plan/machine";
import { onGo, onJoinText, onOut, onWait } from "../plan/membership";
import { beginStartChat } from "../plan/startByChat";
import { ports } from "../ports";
import * as ballots from "../repo/ballots";
import * as dmRoutes from "../repo/dmRoutes";
import * as holdGates from "../repo/holdGates";
import * as participants from "../repo/participants";
import * as payLinks from "../repo/payLinks";
import { ACTIVE_STATES, getPlan } from "../repo/plans";
import * as preferences from "../repo/preferences";
import * as privateConstraints from "../repo/privateConstraints";
import * as ratings from "../repo/ratings";
import type { MemberContext, PlanState, UserRow } from "../repo/types";
import { scrubUser } from "../repo/users";
import type { Command } from "./commands";

/** One template to one user as a threaded reply to the inbound text; `n` numbers multiple replies to the same inbound. */
export function reply<T extends TemplateId>(user: UserRow, id: T, vars: TemplateVars<T>, e: InboundEvent, planId?: string, n = 1) {
  return notify(user.id, id, vars, { key: replyKey(e.message_id, n), replyTo: e.message_id, ...(planId ? { planId } : {}) });
}

const PRE_ORDER: readonly PlanState[] = ["COLLECTING", "RESEARCHING", "VOTING"];

/**
 * Dispatches a parsed command for a known user. `ctx` is null when the user has no live lane in an active plan (join
 * and the plan-free commands still work; plan commands reply T_NOT_IN_PLAN).
 */
export async function handleCommand(user: UserRow, ctx: MemberContext | null, cmd: Command, e: InboundEvent): Promise<void> {
  switch (cmd.kind) {
    case "join":
      // The lane stays INVITED, so the same JOIN works once a spot frees up.
      if (await joinWouldOverfill(user, cmd.code)) return void (await reply(user, "T_PLAN_FULL", {}, e));
      return onJoinText(user, cmd.code, e);
    case "help":
    case "remove_card": // no VenuePort call can forget a payer, so T_CARD_REMOVED would be a false promise
      return void (await reply(user, "T_HELP", {}, e, ctx?.plan.id));
    case "receipts":
      return sendReceipts(user, e);
    case "forget_me":
      return forgetMe(user, ctx, e);
    case "new_plan":
      return newPlan(user, ctx, e);
  }
  if (!ctx) return void (await reply(user, "T_NOT_IN_PLAN", {}, e));
  // Once everyone held, the booking is final: leaving gets the truthful "too late", every other plan command the status.
  if (cmd.kind === "out" && isBooked(ctx)) return sendOutTooLate(ctx, e);
  // After capture nothing can be undone or changed: every plan command answers with where things stand.
  if (ctx.plan.state === "CONFIRMED") return sendStatus(ctx, e);
  switch (cmd.kind) {
    case "status":
      return sendStatus(ctx, e);
    case "out":
      return onOut(ctx, e, "member_out");
    case "go":
      return onGo(ctx, e);
    case "wait":
      return onWait(ctx, e);
    case "cancel_plan":
      return cancelPlan(ctx, e);
    case "change_budget":
      return changeBudget(ctx, e);
  }
}

/**
 * COLLECTING|RESEARCHING|VOTING → CANCELLED + T_PLAN_OFF fan-out (names nobody). Nothing to reverse: no pay link, order
 * or hold exists before ORDERING. False when the plan already moved on (the caller falls back to the money-safe path).
 */
async function cancelPreOrder(planId: string): Promise<boolean> {
  const t = await transition(planId, PRE_ORDER, "CANCELLED");
  if (!t) return false;
  stopPlanTyping(planId);
  await cancelResearch(planId);
  // No pay link exists before ORDERING, so there is no authorization to talk about.
  await fanout(planId, "T_PLAN_OFF", () => ({}), { version: t.version });
  return true;
}

/** Organizer only. Pre-order plans have nothing to reverse, so they are cancelled here; once an order may exist, cancel() reverses it. */
async function cancelPlan(ctx: MemberContext, e: InboundEvent): Promise<void> {
  const { user, plan } = ctx;
  if (plan.organizer_id !== user.id) return void (await reply(user, "T_ORGANIZER_ONLY", {}, e, plan.id));
  if (PRE_ORDER.includes(plan.state) && (await cancelPreOrder(plan.id))) return;
  const won = await cancel(plan.id, "organizer"); // also the path when the plan moved to ORDERING between the read and the transition
  // A finished cancel fans out T_CANCELLED. Otherwise (venue unreachable → still CANCELLING until the hook or expiry
  // sweep, or nothing to cancel any more) the organizer would hear nothing, so tell them where it stands.
  const now = await getPlan(plan.id);
  if (now && (!won || now.state === "CANCELLING")) await sendStatus({ ...ctx, plan: now }, e);
}

/**
 * "new plan" / "start over" / "start fresh": leave the current plan, then the chat-first start (T_START_HELLO).
 * - no plan, or a CONFIRMED one (nothing left to leave) → start right away;
 * - the organizer of a COLLECTING|RESEARCHING|VOTING plan → that plan is called off (T_PLAN_OFF, nobody named): no hold
 *   can exist yet, and a plan without its organizer would otherwise sit open with nobody able to GO;
 * - anyone else, or a plan past VOTING → onOut, exactly like "I'm out" (APPROVING/ORDERING go through cancel(), which
 *   releases every hold; COMMITTING answers with the status because it is too late).
 * The start chat begins only once the old plan no longer counts this person (lane terminal, or plan no longer active):
 * otherwise their next text would still land in the old plan, and the status/ack already told them where it stands.
 */
async function newPlan(user: UserRow, ctx: MemberContext | null, e: InboundEvent): Promise<void> {
  clearAwaiting(user.id);
  if (!ctx || ctx.plan.state === "CONFIRMED") return beginStartChat(user.id, e);
  const organizerCancelled = ctx.plan.organizer_id === user.id && PRE_ORDER.includes(ctx.plan.state) && (await cancelPreOrder(ctx.plan.id));
  if (!organizerCancelled) await onOut(ctx, e, "member_out");
  const [plan, lane] = await Promise.all([getPlan(ctx.plan.id), participants.getParticipant(ctx.plan.id, user.id)]);
  const stillIn = plan && ACTIVE_STATES.includes(plan.state) && lane && lane.stage !== "DECLINED" && lane.stage !== "RELEASED";
  if (!stillIn) await beginStartChat(user.id, e, 2);
}

/** T_ALREADY_IN_PLAN {title, ready, total}: the /start pre-fill from someone still in an open plan. */
export async function sendAlreadyInPlan({ user, plan }: MemberContext, e: InboundEvent): Promise<void> {
  const by = await participants.countByStage(plan.id);
  await reply(user, "T_ALREADY_IN_PLAN", { title: plan.title, ready: countFrom(by, "PREFS_DONE"), total: plan.party_target }, e, plan.id);
}

/** Keeps the stage (dropping it would shrink member counts and trigger a recompute); allowed until the member is HELD. */
async function changeBudget(ctx: MemberContext, e: InboundEvent): Promise<void> {
  const { user, plan, participant } = ctx;
  if (!stageAtLeast(participant.stage, "JOINED")) return void (await reply(user, "T_HELP", {}, e, plan.id));
  if (stageAtLeast(participant.stage, "HELD") || plan.state === "COMMITTING") return sendStatus(ctx, e);
  setAwaiting(user.id, "budget");
  await reply(user, "T_BUDGET_REASK", {}, e, plan.id);
}

const countFrom = (by: Partial<Record<LaneStage, number>>, from: LaneStage): number =>
  STAGE_ORDER.slice(STAGE_ORDER.indexOf(from)).reduce((n, s) => n + (by[s] ?? 0), 0);

/** Public, name-free, budget-free phase text. Exported for tests. */
export function phaseText(state: PlanState, by: Partial<Record<LaneStage, number>>, partyTarget: number): string {
  switch (state) {
    case "COLLECTING":
      return `waiting on friends (${countFrom(by, "PREFS_DONE")} of ${partyTarget} ready)`;
    case "RESEARCHING":
      return "finding dinner and a show";
    case "VOTING":
      return `${countFrom(by, "VOTED")} of ${countFrom(by, "PREFS_DONE")} voted`;
    case "ORDERING":
      return "setting up the holds";
    case "APPROVING":
      return `waiting on holds (${countFrom(by, "HELD")} of ${countFrom(by, "VOTED")} in)`;
    case "COMMITTING":
      return "booking now";
    case "CONFIRMED":
      return "confirmed";
    case "CANCELLING":
      return "cancelling; any holds are released automatically";
    case "CANCELLED":
      return "cancelled";
    case "SHOWCASE":
      return "demo";
  }
}

/** COMMITTING or CONFIRMED: every share is held or charged, and nothing can be undone by text. */
export const isBooked = ({ plan }: MemberContext): boolean => plan.state === "COMMITTING" || plan.state === "CONFIRMED";

/** T_OUT_TOO_LATE {title}: 'I'm out' (or wanting out) after the booking went through. */
export async function sendOutTooLate({ user, plan }: MemberContext, e: InboundEvent): Promise<void> {
  await reply(user, "T_OUT_TOO_LATE", { title: plan.title }, e, plan.id);
}

/** T_STATUS {title, phase} from the fixed phase map plus counts. */
export async function sendStatus({ user, plan }: MemberContext, e: InboundEvent): Promise<void> {
  const by = await participants.countByStage(plan.id);
  await reply(user, "T_STATUS", { title: plan.title, phase: phaseText(plan.state, by, plan.party_target) }, e, plan.id);
}

/** T_RECEIPTS: CONFIRMED plans where the user is CAPTURED → their own share by payer_ref, or "None yet.". */
export async function sendReceipts(user: UserRow, e: InboundEvent): Promise<void> {
  const lines: string[] = [];
  for (const planId of await participants.capturedPlanIdsForUser(user.id)) {
    try {
      const plan = await getPlan(planId);
      if (plan?.state !== "CONFIRMED" || !plan.venue_order_id) continue;
      const share = (await ports.venue.getOrder(plan.venue_order_id)).shares.find((s) => s.payer_ref === user.payer_ref);
      if (share?.status !== "CAPTURED") continue;
      lines.push(`${plan.title}, ${fmtDate(plan.event_date)}: $${usd2(share.amount_cents)}${share.card_last4 ? ` on card ••${share.card_last4}` : ""}`);
    } catch (err) {
      log.warn({ plan_id: planId, ...errInfo(err) }, "receipts lookup failed"); // one bad order must not hide the rest
    }
  }
  await reply(user, "T_RECEIPTS", { lines: lines.length ? lines.join("\n") : "None yet." }, e);
}

/**
 * "forget me": leave a plan that is still open first (nobody keeps counting a deleted member), send T_FORGOTTEN while
 * the dm_route still exists, then delete everything the user owns in one transaction and release the seat.
 */
export async function forgetMe(user: UserRow, ctx: MemberContext | null, e: InboundEvent): Promise<void> {
  if (ctx && (PRE_ORDER.includes(ctx.plan.state) || ctx.plan.state === "ORDERING" || ctx.plan.state === "APPROVING")) {
    await onOut(ctx, e, "member_out");
  }
  await reply(user, "T_FORGOTTEN", {}, e, undefined, 2);
  await sql.begin(async (tx) => {
    await privateConstraints.deleteForUser(user.id, tx);
    await preferences.deletePreferencesForUser(user.id, tx);
    await ratings.deleteRatingsForUser(user.id, tx);
    await ballots.deleteBallotsForUser(user.id, tx);
    await holdGates.deleteHoldGatesForUser(user.id, tx);
    await payLinks.deletePayLinksForUser(user.id, tx);
    await dmRoutes.deleteDmRoute(user.id, tx);
    await scrubUser(user.id, tx);
  });
  clearAwaiting(user.id);
  try {
    await releaseSeat(user.id);
  } catch (err) {
    log.error({ user_id: user.id, ...errInfo(err) }, "forget me: seat release failed"); // /ops/release-seats sweeps leftovers
  }
}
