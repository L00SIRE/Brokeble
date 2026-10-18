// Deadline ladder and periodic jobs (A plan T10). Owner A.
// Every handler re-reads the plan and returns quietly when the state/version no longer matches: a job that fires
// late (retry, restart, a plan that moved on) must be a no-op, never an action on the wrong phase.
import { z } from "zod";
import { researchReady, startResearch } from "../creao/research";
import { enqueue, type DueJob, type Jobs } from "../dueJobs";
import { env } from "../env";
import { errInfo, log } from "../log";
import { fanout } from "../notify/fanout";
import { notify, tplKey } from "../notify/notify";
import { fmtDeadline } from "../notify/render";
import { bundleTitle } from "../plan/decision";
import { cancel } from "../plan/cancel";
import { commitJob } from "../plan/commit";
import { ports } from "../ports";
import { getBundle } from "../repo/bundles";
import { listMembers, countByStage } from "../repo/participants";
import { getPayLink } from "../repo/payLinks";
import { getPlan } from "../repo/plans";
import { listRunsForPlan } from "../repo/researchRuns";
import { TERMINAL_RUN_STATUSES, type PlanRow } from "../repo/types";
import { A_JOB_KINDS, aJobKeys } from "./kinds";

const VersionPayload = z.object({ version: z.int() });
const SWEEP_BUCKET_MS = 30_000;
const SWEEP_TIMEOUT_MS = 10_000;

async function planFor(job: DueJob): Promise<PlanRow | null> {
  return job.plan_id ? getPlan(job.plan_id) : null;
}

/** The plan iff it is still in `state` (and, when the job carries one, at the job's version). */
async function planIfStill(job: DueJob, state: PlanRow["state"], versioned: boolean): Promise<PlanRow | null> {
  const plan = await planFor(job);
  if (!plan || plan.state !== state) return null;
  if (versioned && plan.version !== VersionPayload.parse(job.payload).version) return null;
  return plan;
}

/**
 * `still_looking` (still:<planId>, research start + 90 s; enqueued in the COLLECTING→RESEARCHING transaction, so it
 * survives a crash): still RESEARCHING → research watchdog, then T_STILL_LOOKING fan-out (once per plan).
 *
 * Watchdog: a crash or DB error between the transition and B's startResearch scheduling its poll/timeout jobs would
 * otherwise strand the plan in RESEARCHING forever (nothing else re-runs it). So: a Scout run that never got a CREAO id
 * (or no Scout runs at all) → startResearch again (idempotent: same rows, same CREAO idempotency key, insert-or-ignore
 * jobs); options for both categories already stored → a fresh recompute (the options one may have already run).
 */
export async function stillLookingJob(job: DueJob): Promise<void> {
  const plan = await planIfStill(job, "RESEARCHING", false);
  if (!plan) return;
  await researchWatchdog(plan).catch((e) => log.warn({ ...errInfo(e), plan_id: plan.id }, "still_looking: research watchdog failed"));
  await fanout(plan.id, "T_STILL_LOOKING", () => ({}), { version: plan.version });
}

async function researchWatchdog(plan: PlanRow): Promise<void> {
  if (await researchReady(plan.id)) {
    await enqueue(A_JOB_KINDS.recompute, aJobKeys.recompute(plan.id, "still"), new Date(), {}, { planId: plan.id });
    return;
  }
  const scouts = await listRunsForPlan(plan.id, { kind: "scout" });
  const stranded = scouts.length === 0 || scouts.some((r) => !TERMINAL_RUN_STATUSES.includes(r.status) && !r.creao_run_id);
  if (env.PLANNER_MODE !== "cached" && stranded) {
    log.warn({ plan_id: plan.id, runs: scouts.length }, "still_looking: research looks stranded, restarting");
    await startResearch(plan.id);
  }
}

/** `org_join_status` (orgjoin:<planId>, create + 20 min, demo 3): COLLECTING and joined < target → T_ORG_JOIN_STATUS {k,n} to the organizer. */
export async function orgJoinStatusJob(job: DueJob): Promise<void> {
  const plan = await planIfStill(job, "COLLECTING", false);
  if (!plan?.organizer_id) return;
  const counts = await countByStage(plan.id);
  let k = 0;
  for (const [stage, n] of Object.entries(counts)) if (stage !== "INVITED" && stage !== "DECLINED" && stage !== "RELEASED") k += n ?? 0;
  // k counts the organizer (a participant since chat-first start), and GO needs 2 ready (membership.onGo), so k < 2
  // would offer a GO that is refused; k ≥ target means the plan already moved (or is about to) on its own.
  if (k < 2 || k >= plan.party_target) return;
  await notify(plan.organizer_id, "T_ORG_JOIN_STATUS", { k, n: plan.party_target }, {
    key: tplKey(plan.id, plan.organizer_id, "T_ORG_JOIN_STATUS", plan.version),
    planId: plan.id,
  });
}

/**
 * `approve_reping` (reping:<planId>:<v>): APPROVING at v → T_REPING {title, deadline, url} (suffix 1). Goes only to members
 * holding a live pay link who have not yet held (stage LINK_SENT): HELD/CAPTURED members are done, and a GATED member never
 * said YES to their share, so a link must not reach them. Nobody learns who else is outstanding.
 */
export async function approveRepingJob(job: DueJob): Promise<void> {
  const plan = await planIfStill(job, "APPROVING", true);
  const approveAt = plan?.deadlines.approve_at;
  if (!plan || !approveAt) return;
  const waiting = (await listMembers(plan.id)).filter((m) => m.stage === "LINK_SENT");
  const now = Date.now();
  const urls = new Map<string, string>();
  await Promise.all(
    waiting.map(async (m) => {
      const link = await getPayLink(plan.id, m.user_id, plan.version);
      if (link && link.expires_at.getTime() > now) urls.set(m.user_id, link.pay_url);
    }),
  );
  if (urls.size === 0) return;
  const bundle = plan.chosen_bundle_id ? await getBundle(plan.id, plan.version, plan.chosen_bundle_id) : null;
  const title = bundle ? bundleTitle(bundle) : plan.title;
  const deadline = fmtDeadline(approveAt);
  await fanout(plan.id, "T_REPING", (m) => ({ title, deadline, url: urls.get(m.user_id)! }), {
    version: plan.version,
    suffix: 1,
    only: (m) => urls.has(m.user_id),
  });
}

/**
 * `approve_deadline` (approve:<planId>:<v>): still APPROVING at v → if the venue already holds every share (the last
 * hold landed just before the deadline, or its share.authorized hook was lost), commit instead; otherwise
 * cancel(planId, "deadline"), which releases every hold. A retry that finds COMMITTING re-runs the commit (the venue's
 * commit is idempotent), so a crash mid-commit never strands the plan.
 */
export async function approveDeadlineJob(job: DueJob): Promise<void> {
  const plan = await planFor(job);
  if (!plan || plan.version !== VersionPayload.parse(job.payload).version) return;
  const asCommit: DueJob = { ...job, kind: A_JOB_KINDS.commit, payload: { version: plan.version, share_id: "deadline" } };
  if (plan.state === "COMMITTING" && job.attempts > 1) return commitJob(asCommit);
  if (plan.state !== "APPROVING") return;
  if (plan.venue_order_id) {
    const order = await ports.venue.getOrder(plan.venue_order_id).catch((e) => {
      log.warn({ ...errInfo(e), plan_id: plan.id }, "approve_deadline: getOrder failed; cancelling");
      return null;
    });
    if (order?.status === "OPEN" && order.shares.length > 0 && order.shares.every((s) => s.status === "AUTHORIZED")) return commitJob(asCommit);
  }
  await cancel(plan.id, "deadline");
}

/** C owns the module; loaded lazily so mock mode never touches the venue client. */
const callVenueSweep = async () => (await import("../venueClient/sweep")).callVenueSweep();

/** Next 30 s bucket: key from the bucket start, due at the bucket start (≤ 30 s away). */
const nextSweep = (now: number) => {
  const at = (Math.floor(now / SWEEP_BUCKET_MS) + 1) * SWEEP_BUCKET_MS;
  return { key: aJobKeys.venueSweep(at), at: new Date(at) };
};

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([p, new Promise<never>((_, rej) => (timer = setTimeout(() => rej(new Error(`timed out after ${ms} ms`)), ms)))]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * `venue_sweep` (sweep:<30 s bucket>): skip when VENUE_MODE=mock; else await C's callVenueSweep() (10 s limit); in
 * `finally` enqueue the next bucket. A failed sweep is logged, not retried: the next bucket is the retry, and a
 * poller retry on top would just double-sweep.
 */
export async function venueSweepJob(_job: DueJob, sweep: () => Promise<unknown> = callVenueSweep): Promise<void> {
  if (env.VENUE_MODE === "mock") return;
  try {
    await withTimeout(sweep(), SWEEP_TIMEOUT_MS);
  } catch (e) {
    log.warn(errInfo(e), "venue_sweep failed");
  } finally {
    const next = nextSweep(Date.now());
    await enqueue(A_JOB_KINDS.venueSweep, next.key, next.at);
  }
}

/** Boot: enqueue the current venue_sweep bucket so the self-rescheduling chain starts (insert-or-ignore; chains merge on the bucket key). */
export async function bootstrapVenueSweep(jobs: Jobs): Promise<void> {
  const now = Date.now();
  await jobs.enqueue(A_JOB_KINDS.venueSweep, aJobKeys.venueSweep(now), new Date(now));
}
