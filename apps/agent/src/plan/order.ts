// create_order: venue order → pay links or holdGate asks (A plan T9). A never builds TAP headers (C's VenuePort does).
// pay_url is a bearer secret: it goes only into app.pay_links and the owner's own T_PAY_LINK, never into logs or SSE.
// Owner A.
import type { Bundle, CreateOrderRequest } from "@tab/shared";
import { enqueue, jobKeys, type DueJob } from "../dueJobs";
import { setAwaiting } from "../delegates/awaiting";
import { env } from "../env";
import { A_JOB_KINDS, aJobKeys, type APayloads } from "../jobs/kinds";
import { errInfo, log } from "../log";
import * as holdGate from "../money/holdGate";
import { fanout } from "../notify/fanout";
import { notify, tplKey } from "../notify/notify";
import { fmtDeadline, usd2 } from "../notify/render";
import { ports } from "../ports";
import { getBundle } from "../repo/bundles";
import { getPayLink, upsertPayLink } from "../repo/payLinks";
import { listMembers } from "../repo/participants";
import { getPlan, setVenueOrder } from "../repo/plans";
import type { MemberRow, PlanRow } from "../repo/types";
import { VOICE_NUDGE_KIND } from "../voice/call";
import { bundleTitle } from "./decision";
import { stageAtLeast, transition } from "./machine";
import { setStage } from "./membership";

export type Windows = { voteMs: number; approveMs: number; repingBeforeMs: number };

const MIN = 60_000;
/** DEMO_TIMERS=1 → vote 5 min, approve 10 min, re-ping T-3 min; otherwise 30 / 60 / T-30 (A plan T9). */
export const WINDOWS: Readonly<{ demo: Windows; normal: Windows }> = {
  demo: { voteMs: 5 * MIN, approveMs: 10 * MIN, repingBeforeMs: 3 * MIN },
  normal: { voteMs: 30 * MIN, approveMs: 60 * MIN, repingBeforeMs: 30 * MIN },
};
/** voice_nudge fires at approve_at − 15 min (B's handler; only when VOICE_ENABLED). */
export const VOICE_NUDGE_BEFORE_MS = 15 * MIN;

/** The active windows for this process. */
export const windows = (): Windows => (env.DEMO_TIMERS ? WINDOWS.demo : WINDOWS.normal);

/**
 * CreateOrderRequest: plan_ref = plan.ref, plan_version, bundle {bundle_key: bundle.id, date: plan.event_date,
 * dinner {name, address, time: dinner_time, est_high_pp_usd}, show {…, time: show_start}}, party_size = members.length,
 * payer_refs = members' payer_ref (lane order), deadline_at.
 */
export function buildCreateOrderRequest(plan: PlanRow, bundle: Bundle, members: readonly MemberRow[], deadlineAt: Date): CreateOrderRequest {
  const d = bundle.dinner.data;
  const s = bundle.show.data;
  return {
    plan_ref: plan.ref,
    plan_version: plan.version,
    bundle: {
      bundle_key: bundle.id,
      date: plan.event_date,
      dinner: { name: d.name, address: d.address, time: bundle.dinner_time, est_high_pp_usd: d.est_high_pp_usd },
      show: { name: s.name, address: s.address, time: bundle.show_start, est_high_pp_usd: s.est_high_pp_usd },
    },
    party_size: members.length,
    payer_refs: [...members].sort((a, b) => a.lane - b.lane).map((m) => m.payer_ref),
    deadline_at: deadlineAt.toISOString(),
  };
}

type Link = { member: MemberRow; amount_cents: number; pay_url: string };

/**
 * due_jobs kind `create_order` (payload {version}): checkAvailability (no → ORDERING→CANCELLED + T_NO_FIT) →
 * createOrder → pay_links + setVenueOrder → transition(ORDERING→APPROVING, {version}) (null → venue.cancel(orphan,
 * "plan_cancelled")) → per share: holdGate.check → T_PAY_LINK + LINK_SENT | T_HOLD_GATE + GATED + awaiting → schedule
 * approve_reping, approve_deadline and (VOICE_ENABLED) voice_nudge.
 *
 * Retry-safe: the venue allows one order per (plan_ref, version), so pay links are persisted before the transition and
 * a retry with venue_order_id already set resumes from them instead of creating a second order. Members already at
 * ≥ GATED were handled by an earlier attempt and are skipped (never downgraded).
 */
export async function createOrderJob(job: DueJob): Promise<void> {
  const planId = job.plan_id;
  const { version } = job.payload as APayloads["create_order"];
  if (!planId) return;
  const plan = await getPlan(planId);
  if (!plan || plan.version !== version || !(plan.state === "ORDERING" || (plan.state === "APPROVING" && plan.venue_order_id))) return;
  if (!plan.chosen_bundle_id) throw new Error("create_order: plan has no chosen bundle");
  const bundle = await getBundle(planId, version, plan.chosen_bundle_id);
  if (!bundle) throw new Error("create_order: chosen bundle not found");
  const members = await listMembers(planId);
  const byPayerRef = new Map(members.map((m) => [m.payer_ref, m]));

  let orderId = plan.venue_order_id;
  let approveAt: Date;
  let links: Link[];
  if (!orderId) {
    if (members.length < 2) {
      const t = await transition(planId, "ORDERING", "CANCELLED", { version });
      if (t) await fanout(planId, "T_CANCELLED", () => ({}), { version });
      return;
    }
    if (!(await ports.venue.checkAvailability(bundle.id)).available) {
      const t = await transition(planId, "ORDERING", "CANCELLED", { version });
      if (t) await fanout(planId, "T_NO_FIT", () => ({}), { version });
      return;
    }
    approveAt = new Date(Date.now() + windows().approveMs);
    const res = await ports.venue.createOrder(buildCreateOrderRequest(plan, bundle, members, approveAt));
    orderId = res.order_id;
    links = [];
    for (const s of res.shares) {
      const member = byPayerRef.get(s.payer_ref);
      if (!member) throw new Error("create_order: venue share has an unknown payer_ref");
      await upsertPayLink({ plan_id: planId, user_id: member.user_id, plan_version: version, share_id: s.share_id, amount_cents: s.amount_cents, pay_url: s.pay_url, expires_at: new Date(s.expires_at) });
      links.push({ member, amount_cents: s.amount_cents, pay_url: s.pay_url });
    }
    await setVenueOrder(planId, orderId, approveAt);
  } else {
    if (!plan.deadlines.approve_at) throw new Error("create_order: order without approve_at");
    approveAt = new Date(plan.deadlines.approve_at);
    const order = await ports.venue.getOrder(orderId);
    links = [];
    for (const s of order.shares) {
      const member = byPayerRef.get(s.payer_ref);
      const link = member && (await getPayLink(planId, member.user_id, version));
      if (member && link) links.push({ member, amount_cents: link.amount_cents, pay_url: link.pay_url });
    }
  }

  if (plan.state === "ORDERING" && !(await transition(planId, "ORDERING", "APPROVING", { version }))) {
    // Cancelled while the order was in flight: nobody else knows about this order, so release it here.
    await ports.venue.cancel(orderId, "plan_cancelled").catch((e) => log.error({ ...errInfo(e), planId }, "create_order: orphan cancel failed"));
    return;
  }

  // The ladder is scheduled before any DM: if Photon keeps failing below, the deadline still exists to release every hold.
  const at = approveAt.getTime();
  const o = { planId };
  await enqueue(A_JOB_KINDS.approveReping, aJobKeys.approveReping(planId, version), new Date(at - windows().repingBeforeMs), { version }, o);
  await enqueue(A_JOB_KINDS.approveDeadline, aJobKeys.approveDeadline(planId, version), approveAt, { version }, o);
  if (env.VOICE_ENABLED) await enqueue(VOICE_NUDGE_KIND, jobKeys.voiceNudge(planId, version), new Date(at - VOICE_NUDGE_BEFORE_MS), { version }, o);

  const title = bundleTitle(bundle);
  const deadline = fmtDeadline(approveAt);
  for (const { member, amount_cents, pay_url } of links) {
    if (stageAtLeast(member.stage, "GATED")) continue;
    const userId = member.user_id;
    if ((await holdGate.check(planId, userId, version, amount_cents)) === "link") {
      await notify(userId, "T_PAY_LINK", { title, amount: usd2(amount_cents), deadline, url: pay_url }, { key: tplKey(planId, userId, "T_PAY_LINK", version), planId });
      await setStage(planId, userId, "LINK_SENT", { amountCents: amount_cents });
    } else {
      setAwaiting(userId, "holdgate");
      await notify(userId, "T_HOLD_GATE", { amount: usd2(amount_cents) }, { key: tplKey(planId, userId, "T_HOLD_GATE", version, amount_cents), planId });
      await setStage(planId, userId, "GATED", { amountCents: amount_cents });
    }
  }

}
