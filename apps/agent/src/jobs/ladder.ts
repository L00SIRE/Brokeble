// Deadline ladder and periodic jobs (A plan T10). Owner A.
// Every handler re-reads the plan and returns quietly when the state/version no longer matches: a job that fires
// late (retry, restart, a plan that moved on) must be a no-op, never an action on the wrong phase.
import { z } from "zod";
import { enqueue, type DueJob, type Jobs } from "../dueJobs";
import { env } from "../env";
import { errInfo, log } from "../log";
import { fanout } from "../notify/fanout";
import { notify, tplKey } from "../notify/notify";
import { fmtDeadline } from "../notify/render";
import { bundleTitle } from "../plan/decision";
import { cancel } from "../plan/cancel";
import { getBundle } from "../repo/bundles";
import { listMembers, countByStage } from "../repo/participants";
import { getPayLink } from "../repo/payLinks";
import { getPlan } from "../repo/plans";
import type { PlanRow } from "../repo/types";
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

/** `still_looking` (still:<planId>, research start + 90 s): still RESEARCHING → T_STILL_LOOKING fan-out (once per plan). */
export async function stillLookingJob(job: DueJob): Promise<void> {
  const plan = await planIfStill(job, "RESEARCHING", false);
  if (!plan) return;
  await fanout(plan.id, "T_STILL_LOOKING", () => ({}), { version: plan.version });
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

/** `approve_deadline` (approve:<planId>:<v>): still APPROVING at v → cancel(planId, "deadline"), which releases every hold. */
export async function approveDeadlineJob(job: DueJob): Promise<void> {
  const plan = await planIfStill(job, "APPROVING", true);
  if (plan) await cancel(plan.id, "deadline");
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
