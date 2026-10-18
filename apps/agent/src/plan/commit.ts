// commit + confirm (A plan T9, M4/M5). Exactly-once comes from the APPROVING→COMMITTING transition, not the job key
// (one commit job per share: commit:<planId>:<v>:<shareId>). The consent body is always rebuilt from the venue's own
// order (consentFromOrder), never hand-built. Owner A.
import type { OrderStatus } from "@tab/shared";
import { consentFromOrder } from "@tab/shared/tap";
import { startConciergeFor } from "../creao/concierge";
import type { DueJob } from "../dueJobs";
import { emit } from "../events";
import type { APayloads } from "../jobs/kinds";
import { errInfo, log } from "../log";
import { fanout } from "../notify/fanout";
import { usd2 } from "../notify/render";
import { ports } from "../ports";
import { getBundle } from "../repo/bundles";
import { listMembers } from "../repo/participants";
import { getPayLink } from "../repo/payLinks";
import { getPlan } from "../repo/plans";
import { cancel } from "./cancel";
import { bundleTitle } from "./decision";
import { transition } from "./machine";
import { venueClient } from "./venueHook";

const allAuthorized = (o: OrderStatus) => o.shares.length > 0 && o.shares.every((s) => s.status === "AUTHORIZED");

/** C's venue client throws CommitPendingError when a timed-out commit left the order COMMITTING/CAPTURED. */
const isCommitPending = (e: unknown) => e instanceof Error && e.name === "CommitPendingError";

export const needsAttention = (planId: string) =>
  emit({ type: "system", level: "error", msg: "capture needs attention" }).then(
    () => log.error({ planId }, "capture needs attention"),
    (e) => log.error({ ...errInfo(e), planId }, "system event emit failed"),
  );

/**
 * due_jobs kind `commit` (payload {version, share_id}): getOrder; any share not AUTHORIZED → return.
 * transition(APPROVING→COMMITTING, {version}) (null → return). venue.commit(orderId, consentFromOrder(order)) (C emits
 * tap.signed/tap.verify): captured → confirm; rejected → getOrder: OPEN → cancel("commit_rejected"),
 * NEEDS_ATTENTION → system:error, else wait for order.captured; partial → system:error, no DMs.
 * CommitPendingError → wait for order.captured.
 *
 * A retry (attempts > 1) of the transition winner may find the plan already COMMITTING: it re-reads the order and
 * commits again (the venue's commit is idempotent and row-locked), so a crash after the transition never strands the
 * plan. First attempts that find COMMITTING belong to other shares and leave the commit to the winner.
 */
export async function commitJob(job: DueJob): Promise<void> {
  const planId = job.plan_id;
  const { version } = job.payload as APayloads["commit"];
  if (!planId) return;
  const plan = await getPlan(planId);
  const orderId = plan?.venue_order_id;
  if (!plan || !orderId || plan.version !== version) return;
  if (!(plan.state === "APPROVING" || (plan.state === "COMMITTING" && job.attempts > 1))) return;

  const order = await ports.venue.getOrder(orderId);
  if (order.status === "CAPTURED") return confirm(planId);
  if (order.status !== "OPEN" || !allAuthorized(order)) return;
  if (plan.state === "APPROVING" && !(await transition(planId, "APPROVING", "COMMITTING", { version }))) return;

  let res;
  try {
    res = await ports.venue.commit(orderId, consentFromOrder(order));
  } catch (e) {
    if (isCommitPending(e)) return log.info({ planId }, "commit pending; waiting for order.captured");
    throw e;
  }
  if (res.result === "captured") return confirm(planId);
  if (res.result === "partial") return needsAttention(planId);
  const after = await ports.venue.getOrder(orderId);
  if (after.status === "OPEN") {
    await cancel(planId, "commit_rejected");
    return;
  }
  if (after.status === "NEEDS_ATTENTION") return needsAttention(planId);
  // COMMITTING / CAPTURED: order.captured will confirm.
}

/**
 * Idempotent: transition(COMMITTING→CONFIRMED). The winner fans out T_CAPTURED {title, amount: usd2(own share)},
 * calls C's emitCounters() and B's startConciergeFor(planId). Each follow-up is isolated so one failure never
 * swallows the others (the winner runs exactly once).
 */
export async function confirm(planId: string): Promise<void> {
  const t = await transition(planId, "COMMITTING", "CONFIRMED");
  if (!t) return;
  const fail = (what: string) => (e: unknown) => log.error({ ...errInfo(e), planId }, `confirm: ${what} failed`);
  await (async () => {
    const plan = await getPlan(planId);
    const bundle = plan?.chosen_bundle_id ? await getBundle(planId, t.version, plan.chosen_bundle_id) : null;
    if (!bundle) throw new Error("chosen bundle not found");
    const members = await listMembers(planId);
    const amounts = new Map<string, number>();
    for (const m of members) {
      const link = await getPayLink(planId, m.user_id, t.version);
      if (link) amounts.set(m.user_id, link.amount_cents);
    }
    const title = bundleTitle(bundle);
    await fanout(planId, "T_CAPTURED", (r) => ({ title, amount: usd2(amounts.get(r.user_id) ?? 0) }), {
      version: t.version,
      only: (r) => amounts.has(r.user_id),
    });
  })().catch(fail("T_CAPTURED fan-out"));
  await venueClient.emitCounters().catch(fail("counters"));
  await startConciergeFor(planId).catch(fail("concierge"));
}
