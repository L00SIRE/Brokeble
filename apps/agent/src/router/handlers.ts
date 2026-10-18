// Chat command handlers (A plan T11/T13). Replies use replyKey(e.message_id, n). No names, no budgets. Owner A.
import type { InboundEvent, LaneStage, TemplateId, TemplateVars } from "@tab/shared";
import { cancelResearch } from "../creao/research";
import { clearAwaiting, setAwaiting } from "../delegates/awaiting";
import { sql } from "../db";
import { releaseSeat } from "../join/seats";
import { errInfo, log } from "../log";
import { fanout } from "../notify/fanout";
import { notify, replyKey } from "../notify/notify";
import { stopPlanTyping } from "../notify/presence";
import { fmtDate, usd2 } from "../notify/render";
import { cancel } from "../plan/cancel";
import { STAGE_ORDER, stageAtLeast, transition } from "../plan/machine";
import { onGo, onJoinText, onOut, onWait } from "../plan/membership";
import { ports } from "../ports";
import * as ballots from "../repo/ballots";
import * as dmRoutes from "../repo/dmRoutes";
import * as holdGates from "../repo/holdGates";
import * as participants from "../repo/participants";
import * as payLinks from "../repo/payLinks";
import { getPlan } from "../repo/plans";
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
      return onJoinText(user, cmd.code, e);
    case "help":
    case "remove_card": // no VenuePort call can forget a payer, so T_CARD_REMOVED would be a false promise
      return void (await reply(user, "T_HELP", {}, e, ctx?.plan.id));
    case "receipts":
      return sendReceipts(user, e);
    case "forget_me":
      return forgetMe(user, ctx, e);
  }
  if (!ctx) return void (await reply(user, "T_NOT_IN_PLAN", {}, e));
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

/** Organizer only. Pre-order plans have nothing to reverse, so they are cancelled here; once an order may exist, cancel() reverses it. */
async function cancelPlan(ctx: MemberContext, e: InboundEvent): Promise<void> {
  const { user, plan } = ctx;
  if (plan.organizer_id !== user.id) return void (await reply(user, "T_ORGANIZER_ONLY", {}, e, plan.id));
  if (PRE_ORDER.includes(plan.state)) {
    const t = await transition(plan.id, PRE_ORDER, "CANCELLED");
    if (t) {
      stopPlanTyping(plan.id);
      await cancelResearch(plan.id);
      await fanout(plan.id, "T_CANCELLED", () => ({}), { version: t.version });
      return;
    }
  }
  await cancel(plan.id, "organizer"); // also the path when the plan moved to ORDERING between the read and the transition
}

/** Keeps the stage (dropping it would shrink member counts and trigger a recompute); allowed until the member is HELD. */
async function changeBudget(ctx: MemberContext, e: InboundEvent): Promise<void> {
  const { user, plan, participant } = ctx;
  if (!stageAtLeast(participant.stage, "JOINED")) return void (await reply(user, "T_HELP", {}, e, plan.id));
  if (stageAtLeast(participant.stage, "HELD") || plan.state === "COMMITTING") return sendStatus(ctx, e);
  setAwaiting(user.id, "budget");
  await reply(user, "T_BUDGET_ASK", {}, e, plan.id);
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
      return "cancelling";
    case "CANCELLED":
      return "cancelled";
    case "SHOWCASE":
      return "demo";
  }
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
      lines.push(`${plan.title}, ${fmtDate(plan.event_date)}: ${usd2(share.amount_cents)}${share.card_last4 ? ` on card ••${share.card_last4}` : ""}`);
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
