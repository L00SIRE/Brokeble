// A's due_jobs kinds, dedupe keys and payloads (A plan T10), registered by registerA via registerAJobs. Owner A.
// Every handler is idempotent: a unique (kind, dedupe_key) plus a state/version guard. Cross-owner keys
// (recompute:<planId>:options, voice:<planId>:<v>, check_research_ready) come from jobKeys in src/dueJobs.ts.
import { jobKeys, type Jobs } from "../dueJobs";
import { env } from "../env";
import { errInfo, log } from "../log";
import { recomputeJob } from "../plan/decision";
import { voteDeadlineJob } from "../plan/ballots";
import { createOrderJob } from "../plan/order";
import { commitJob, postConfirmJob } from "../plan/commit";
import { postCancelJob } from "../plan/cancel";
import { approveDeadlineJob, approveRepingJob, bootstrapVenueSweep, orgJoinStatusJob, stillLookingJob, venueSweepJob } from "./ladder";

export const A_JOB_KINDS = {
  stillLooking: "still_looking",
  orgJoinStatus: "org_join_status",
  recompute: "recompute",
  voteDeadline: "vote_deadline",
  createOrder: "create_order",
  approveReping: "approve_reping",
  approveDeadline: "approve_deadline",
  commit: "commit",
  venueSweep: "venue_sweep",
  postConfirm: "post_confirm",
  postCancel: "post_cancel",
} as const;

/**
 * create_order gives up after this many attempts (backoff 2+4+…+128 s ≈ 4 min of retries) and calls the plan off: a
 * venue that is down that long would otherwise leave everyone at "setting up the holds" forever.
 */
export const CREATE_ORDER_MAX_ATTEMPTS = 8;
/** post_confirm / post_cancel run this long after the winning transition, as a durable backstop for its follow-ups. */
export const FOLLOW_UP_BACKSTOP_MS = 30_000;

/** job.payload per kind (job.plan_id carries the plan for every plan-scoped kind). */
export type APayloads = {
  still_looking: Record<string, never>;
  org_join_status: Record<string, never>;
  recompute: Record<string, never>;
  vote_deadline: { version: number };
  create_order: { version: number };
  approve_reping: { version: number };
  approve_deadline: { version: number };
  commit: { version: number; share_id: string };
  venue_sweep: Record<string, never>;
  post_confirm: { version: number };
  post_cancel: { version: number };
};

/** Dedupe keys (A plan T10 table). recompute(planId, "options") === jobKeys.recomputeOptions(planId). */
export const aJobKeys = {
  stillLooking: (planId: string) => `still:${planId}`,
  orgJoinStatus: (planId: string) => `orgjoin:${planId}`,
  /** triggerId: the inbound event id, "options" (B) or "seed". */
  recompute: (planId: string, triggerId: string) => (triggerId === "options" ? jobKeys.recomputeOptions(planId) : `recompute:${planId}:${triggerId}`),
  voteDeadline: (planId: string, version: number) => `vote:${planId}:${version}`,
  createOrder: (planId: string, version: number) => `order:${planId}:${version}`,
  approveReping: (planId: string, version: number) => `reping:${planId}:${version}`,
  approveDeadline: (planId: string, version: number) => `approve:${planId}:${version}`,
  /** One per share: a single per-plan key would swallow the last share's commit after an early no-op. */
  commit: (planId: string, version: number, shareId: string) => `commit:${planId}:${version}:${shareId}`,
  /** 30-second bucket. */
  venueSweep: (epochMs: number) => `sweep:${Math.floor(epochMs / 30_000)}`,
  postConfirm: (planId: string, version: number) => `postconfirm:${planId}:${version}`,
  postCancel: (planId: string, version: number) => `postcancel:${planId}:${version}`,
} as const;

/** Registers every A kind once at boot; in VENUE_MODE=live also inserts the current venue_sweep bucket. */
export function registerAJobs(jobs: Jobs): void {
  jobs.register(A_JOB_KINDS.stillLooking, stillLookingJob);
  jobs.register(A_JOB_KINDS.orgJoinStatus, orgJoinStatusJob);
  jobs.register(A_JOB_KINDS.recompute, recomputeJob);
  jobs.register(A_JOB_KINDS.voteDeadline, voteDeadlineJob);
  jobs.register(A_JOB_KINDS.createOrder, createOrderJob, { maxAttempts: CREATE_ORDER_MAX_ATTEMPTS });
  jobs.register(A_JOB_KINDS.approveReping, approveRepingJob);
  jobs.register(A_JOB_KINDS.approveDeadline, approveDeadlineJob);
  jobs.register(A_JOB_KINDS.commit, commitJob);
  jobs.register(A_JOB_KINDS.venueSweep, venueSweepJob);
  jobs.register(A_JOB_KINDS.postConfirm, postConfirmJob);
  jobs.register(A_JOB_KINDS.postCancel, postCancelJob);
  if (env.VENUE_MODE === "live") bootstrapVenueSweep(jobs).catch((e) => log.error(errInfo(e), "venue_sweep bootstrap"));
}
