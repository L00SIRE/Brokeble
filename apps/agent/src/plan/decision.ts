// recompute: shortlist → VOTING / refresh / NO_FIT (A plan T7). Heavy work runs as a due_job, off the inbound path.
// A owns plan transitions, app.bundles writes, the `shortlist` SSE and every fan-out; B's computeShortlist only computes.
// Owner A.
import type { Bundle, PublicBundle } from "@tab/shared";
import { cancelResearch } from "../creao/research";
import { sql, type Tx } from "../db";
import { computeShortlist, type ShortlistResult } from "../decide/score";
import { enqueue, type DueJob } from "../dueJobs";
import { env } from "../env";
import { emit } from "../events";
import { A_JOB_KINDS, aJobKeys } from "../jobs/kinds";
import { errInfo, log } from "../log";
import { fanout } from "../notify/fanout";
import { stopPlanTyping } from "../notify/presence";
import { picksLines, sanitizePitch } from "../notify/render";
import { getShortlist, writeBundles } from "../repo/bundles";
import { usersSentTemplate } from "../repo/outbound";
import { listMembers } from "../repo/participants";
import { getPlan, mergeDeadlines } from "../repo/plans";
import type { MemberRow } from "../repo/types";
import { maybeCloseVote } from "./ballots";
import { stageAtLeast, transition } from "./machine";
import { setStage } from "./membership";
import { WINDOWS } from "./order";

/** B → A hook (standard-names): both categories have options. Enqueues `recompute` with jobKeys.recomputeOptions(planId), due now. */
export async function onOptionsReady(planId: string): Promise<void> {
  await enqueue(A_JOB_KINDS.recompute, aJobKeys.recompute(planId, "options"), new Date(), {}, { planId });
}

/**
 * computeShortlist(planId) → top3 < 3: transition([RESEARCHING, VOTING]→CANCELLED) + T_NO_FIT fan-out (never who or why).
 * RESEARCHING: →VOTING with writeBundles + `shortlist` + vote deadline in the same transaction, then stopPlanTyping, T_PICKS.
 * VOTING and top3 ids (in rank order) changed: VOTING→VOTING {version, bumpVersion} (null → another recompute won), same
 * writes for the new version, VOTED stages reset, T_PICKS_REFRESH to prior holders + T_PICKS to newcomers.
 * Unchanged: T_PICKS to newcomers only, then maybeCloseVote (a leaver may have been the last non-voter).
 * Any other state (incl. SHOWCASE, whose options are only a live-Scout showcase) is a no-op.
 */
export async function recompute(planId: string): Promise<void> {
  const plan = await getPlan(planId);
  if (!plan || (plan.state !== "RESEARCHING" && plan.state !== "VOTING")) return;
  const result = await computeShortlist(planId);

  if (result.top3.length < 3) {
    const t = await transition(planId, ["RESEARCHING", "VOTING"], "CANCELLED", { version: plan.version });
    if (!t) return;
    stopPlanTyping(planId);
    await fanout(planId, "T_NO_FIT", () => ({}), { version: t.version });
    await cancelResearch(planId).catch((err: unknown) => log.warn({ ...errInfo(err), plan_id: planId }, "plan.recompute cancelResearch"));
    return;
  }

  const top3Ids = result.top3.map((b) => b.id);
  const publicTop3 = result.top3.map((b, i) => toPublicBundle(b, i + 1));
  const publish = (tx: Tx, version: number) => publishVersion(tx, planId, version, result, top3Ids, publicTop3);

  if (plan.state === "RESEARCHING") {
    const t = await transition(planId, "RESEARCHING", "VOTING", { version: plan.version, inTx: (tx, w) => publish(tx, w.version) });
    if (!t) return;
    stopPlanTyping(planId);
    await sendPicks(planId, t.version, publicTop3, new Set());
    return;
  }

  const current = await getShortlist(planId, plan.version);
  const holders = await picksHolders(planId);
  if (sameIds(current.map((b) => b.id), top3Ids)) {
    await sendPicks(planId, plan.version, publicTop3, holders, { newcomersOnly: true });
    await maybeCloseVote(planId, plan.version);
    return;
  }

  const t = await transition(planId, "VOTING", "VOTING", { version: plan.version, bumpVersion: true, inTx: (tx, w) => publish(tx, w.version) });
  if (!t) return;
  // Ballots are keyed by version, so old votes no longer count: reset VOTED lanes so the console and tally agree.
  const members = await listMembers(planId);
  for (const m of members) if (m.stage === "VOTED") await setStage(planId, m.user_id, "PREFS_DONE");
  await emit({ type: "vote.tally", plan_id: planId, voted: 0, total: members.length });
  await sendPicks(planId, t.version, publicTop3, holders);
}

/** The winning transaction's writes: bundles for `version`, the `shortlist` event, the vote deadline and its job. */
async function publishVersion(tx: Tx, planId: string, version: number, r: ShortlistResult, top3Ids: readonly string[], bundles: PublicBundle[]): Promise<void> {
  await writeBundles(planId, version, r.survivors, top3Ids, tx);
  await emit({ type: "shortlist", plan_id: planId, version, from_count: r.from_count, survived_count: r.survived_count, bundles }, tx);
  const voteAt = new Date(Date.now() + WINDOWS[env.DEMO_TIMERS ? "demo" : "normal"].voteMs);
  await mergeDeadlines(planId, { vote_at: voteAt.toISOString() }, tx);
  await enqueue(A_JOB_KINDS.voteDeadline, aJobKeys.voteDeadline(planId, version), voteAt, { version }, { planId, tx });
}

/**
 * T_PICKS to active members who never got picks; T_PICKS_REFRESH to those who did (skipped when `newcomersOnly`).
 * tplKey(version) dedupes retries of this job.
 */
async function sendPicks(planId: string, version: number, bundles: readonly PublicBundle[], holders: ReadonlySet<string>, o: { newcomersOnly?: boolean } = {}): Promise<void> {
  const lines = picksLines(bundles);
  const active = (m: MemberRow) => stageAtLeast(m.stage, "PREFS_DONE");
  await fanout(planId, "T_PICKS", () => ({ lines }), { version, only: (m) => active(m) && !holders.has(m.user_id) });
  if (!o.newcomersOnly && holders.size > 0) {
    await fanout(planId, "T_PICKS_REFRESH", () => ({ lines }), { version, only: (m) => active(m) && holders.has(m.user_id) });
  }
}

const picksHolders = (planId: string) => usersSentTemplate(planId, ["T_PICKS", "T_PICKS_REFRESH"]);

const sameIds = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((id, i) => id === b[i]);

/** due_jobs kind `recompute` (key recompute:<planId>:<triggerId>): recompute(job.plan_id). */
export async function recomputeJob(job: DueJob): Promise<void> {
  if (!job.plan_id) throw new Error("recompute job without plan_id");
  await recompute(job.plan_id);
}

/** "Dinner at <dinner name> → Show at <show name>". */
export function bundleTitle(b: Bundle): string {
  return `Dinner at ${b.dinner.data.name} → Show at ${b.show.data.name}`;
}

/** Bundle → PublicBundle with `index` 1..3: public fields only; pitch = sanitized dinner + show pitches, ≤280 chars. */
export function toPublicBundle(b: Bundle, index: number): PublicBundle {
  return {
    id: b.id,
    index,
    title: bundleTitle(b),
    dinner_name: b.dinner.data.name,
    show_name: b.show.data.name,
    dinner_time: b.dinner_time,
    show_start: b.show_start,
    show_end_est: b.show_end_est,
    all_in_pp_cents: b.all_in_pp_cents,
    dietary_fit: [...b.dinner.data.dietary_fit],
    pitch: sanitizePitch(`${b.dinner.data.pitch} ${b.show.data.pitch}`, 280),
  };
}
