// cancel: reverse everything, name nobody (A plan T9/T11). T_CANCELLED is one group template with no names, so the
// person who left (or whose card failed) is never revealed. Owner A.
import { cancelResearch } from "../creao/research";
import { emit } from "../events";
import { errInfo, log } from "../log";
import { fanout } from "../notify/fanout";
import { ports } from "../ports";
import { getPlan } from "../repo/plans";
import type { PlanState } from "../repo/types";
import { transition } from "./machine";
import { venueClient } from "./venueHook";

export type CancelReason = "member_out" | "holdgate_no" | "deadline" | "commit_rejected" | "organizer" | "plan_cancelled";

/**
 * transition([ORDERING, APPROVING]→CANCELLING), or COMMITTING→CANCELLING only for commit_rejected (null → return). Once a
 * commit has started, nothing else (I'm out, organizer, a deadline that read APPROVING a moment earlier) may cancel: the
 * venue may already be capturing, and a CANCELLING plan could never confirm a capture that succeeds.
 * No venue_order_id → CANCELLED + T_CANCELLED fan-out (an in-flight create_order cancels its orphan). Else
 * venue.cancel(orderId, reason): CANCELLED → CANCELLED + T_CANCELLED + emitCounters; otherwise wait for order.cancelled.
 * Then B's cancelResearch(planId). Resolves true iff this call won the transition.
 */
export async function cancel(planId: string, reason: CancelReason): Promise<boolean> {
  const t = await transition(planId, reason === "commit_rejected" ? "COMMITTING" : ["ORDERING", "APPROVING"], "CANCELLING");
  if (!t) return false;
  try {
    const plan = await getPlan(planId);
    if (!plan?.venue_order_id) {
      await finishCancel(planId);
    } else {
      const order = await ports.venue.cancel(plan.venue_order_id, reason);
      if (order.status === "CANCELLED") await finishCancel(planId);
    }
  } catch (e) {
    // The plan stays CANCELLING; the venue's expiry sweep releases the holds and its order.cancelled hook finishes us.
    log.error({ ...errInfo(e), planId, reason }, "cancel: venue cancel failed");
    await emit({ type: "system", level: "error", msg: "cancel: venue did not confirm; holds release at expiry" }).catch(() => {});
  }
  await cancelResearch(planId).catch((e) => log.error({ ...errInfo(e), planId }, "cancel: cancelResearch failed"));
  return true;
}

/**
 * Idempotent final step (also run by the order.cancelled hook): transition(from→CANCELLED). The winner fans out
 * T_CANCELLED to every recipient and emits counters.
 */
export async function finishCancel(planId: string, from: PlanState | readonly PlanState[] = "CANCELLING"): Promise<void> {
  const t = await transition(planId, from, "CANCELLED");
  if (!t) return;
  await fanout(planId, "T_CANCELLED", () => ({}), { version: t.version }).catch((e) => log.error({ ...errInfo(e), planId }, "T_CANCELLED fan-out failed"));
  await venueClient.emitCounters().catch((e) => log.error({ ...errInfo(e), planId }, "counters failed"));
}
