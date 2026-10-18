// B's due_jobs kinds, keys and payloads (B plan T5), registered by registerB via registerBJobs. Owner B.
import { jobKeys, type Jobs } from "../dueJobs";
import { checkResearchReadyJob, creaoPollJob, creaoTimeoutJob } from "./research";

export const B_JOB_KINDS = {
  creaoPoll: "creao_poll",
  creaoTimeout: "creao_timeout",
  checkResearchReady: "check_research_ready",
} as const;

/** job.payload per kind. */
export type BPayloads = {
  creao_poll: { research_run_id: string; n: number };
  creao_timeout: { research_run_id: string };
  check_research_ready: { research_run_id: string };
};

export const bJobKeys = {
  /** `<researchRunId>:<n>`, due +15 s; the handler inserts n+1 while the run is not terminal. */
  creaoPoll: (researchRunId: string, n: number) => `${researchRunId}:${n}`,
  /** `<researchRunId>`, due started + 6 min (Scout) / + 10 min (Concierge). */
  creaoTimeout: (researchRunId: string) => researchRunId,
  /** `<planId>:<researchRunId>` (standard-names). */
  checkResearchReady: jobKeys.checkResearchReady,
} as const;

export const POLL_INTERVAL_MS = 15_000;
export const SCOUT_TIMEOUT_MS = 6 * 60_000;
export const CONCIERGE_TIMEOUT_MS = 10 * 60_000;

/** Registers creao_poll, creao_timeout and check_research_ready once at boot. */
export function registerBJobs(jobs: Jobs): void {
  jobs.register(B_JOB_KINDS.creaoPoll, creaoPollJob);
  jobs.register(B_JOB_KINDS.creaoTimeout, creaoTimeoutJob);
  jobs.register(B_JOB_KINDS.checkResearchReady, checkResearchReadyJob);
}
