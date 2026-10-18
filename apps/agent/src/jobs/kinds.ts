// A's due_jobs kinds, dedupe keys and payloads (A plan T10), registered by registerA via registerAJobs. Owner A.
// Every handler is idempotent: a unique (kind, dedupe_key) plus a state/version guard. Cross-owner keys
// (recompute:<planId>:options, voice:<planId>:<v>, check_research_ready) come from jobKeys in src/dueJobs.ts.
import { jobKeys, type Jobs } from "../dueJobs";
import { env } from "../env";
import { errInfo, log } from "../log";
import { recomputeJob } from "../plan/decision";
import { voteDeadlineJob } from "../plan/ballots";
import { createOrderJob } from "../plan/order";
import { commitJob } from "../plan/commit";
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
} as const;

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
} as const;

/** Registers every A kind once at boot; in VENUE_MODE=live also inserts the current venue_sweep bucket. */
export function registerAJobs(jobs: Jobs): void {
  jobs.register(A_JOB_KINDS.stillLooking, stillLookingJob);
  jobs.register(A_JOB_KINDS.orgJoinStatus, orgJoinStatusJob);
  jobs.register(A_JOB_KINDS.recompute, recomputeJob);
  jobs.register(A_JOB_KINDS.voteDeadline, voteDeadlineJob);
  jobs.register(A_JOB_KINDS.createOrder, createOrderJob);
  jobs.register(A_JOB_KINDS.approveReping, approveRepingJob);
  jobs.register(A_JOB_KINDS.approveDeadline, approveDeadlineJob);
  jobs.register(A_JOB_KINDS.commit, commitJob);
  jobs.register(A_JOB_KINDS.venueSweep, venueSweepJob);
  if (env.VENUE_MODE === "live") bootstrapVenueSweep(jobs).catch((e) => log.error(errInfo(e), "venue_sweep bootstrap"));
}
