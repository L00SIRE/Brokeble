// Ballots, tally and winner (A plan T8). Constraints are resolved by B's resolveApprovals; A never re-implements it.
// Owner A.
import type { BallotParse, InboundEvent, PublicBundle } from "@tab/shared";
import { computeWinner } from "../decide/score";
import { resolveApprovals } from "../decide/ballot";
import { enqueue, type DueJob } from "../dueJobs";
import { emit } from "../events";
import { A_JOB_KINDS, aJobKeys } from "../jobs/kinds";
import { fanout } from "../notify/fanout";
import { notify, replyKey, tplKey } from "../notify/notify";
import { listBallots, upsertBallot } from "../repo/ballots";
import { getShortlist } from "../repo/bundles";
import { getParticipant, listMembers } from "../repo/participants";
import { getPlan, setChosenBundle } from "../repo/plans";
import type { MemberContext, PlanRow } from "../repo/types";
import { bundleTitle, toPublicBundle } from "./decision";
import { stageAtLeast, transition } from "./machine";
import { setStage } from "./membership";

/** The version's shortlist as PublicBundles (index 1..3), from repo getShortlist. */
export async function publicShortlist(planId: string, version: number): Promise<PublicBundle[]> {
  const bundles = await getShortlist(planId, version);
  return bundles.map((b, i) => toPublicBundle(b, i + 1));
}

/** A voting member: stage ≥ PREFS_DONE (terminal stages never qualify) in a plan that is VOTING at the current version. */
async function votingContext(ctx: MemberContext): Promise<{ plan: PlanRow } | null> {
  const [plan, participant] = await Promise.all([getPlan(ctx.plan.id), getParticipant(ctx.plan.id, ctx.user.id)]);
  if (!plan || plan.state !== "VOTING" || !participant || !stageAtLeast(participant.stage, "PREFS_DONE")) return null;
  return { plan };
}

/** T_BALLOT_CLARIFY once per version (tplKey dedupes); any later unparseable reply gets T_HELP. */
async function clarifyOrHelp(ctx: MemberContext, version: number, e: InboundEvent): Promise<void> {
  const outcome = await notify(ctx.user.id, "T_BALLOT_CLARIFY", {}, {
    key: tplKey(ctx.plan.id, ctx.user.id, "T_BALLOT_CLARIFY", version), planId: ctx.plan.id, replyTo: e.message_id,
  });
  if (outcome === "duplicate") await notify(ctx.user.id, "T_HELP", {}, { key: replyKey(e.message_id, 1), planId: ctx.plan.id, replyTo: e.message_id });
}

/** Digits reply ("1 3"): recordBallot with {approvals: indices, constraints: [], none_of_these: false, intent: "ballot", confidence: "high"}. */
export async function handleDigitsBallot(ctx: MemberContext, indices: readonly number[], e: InboundEvent): Promise<void> {
  const v = await votingContext(ctx);
  if (!v) return;
  const available = new Set((await publicShortlist(v.plan.id, v.plan.version)).map((b) => b.index));
  const approvals = [...new Set(indices)].filter((i) => available.has(i)).sort((a, b) => a - b);
  if (approvals.length === 0) return clarifyOrHelp(ctx, v.plan.version, e);
  await recordBallot(ctx, { approvals, constraints: [], none_of_these: false, intent: "ballot", confidence: "high" }, "digits", e);
}

/**
 * resolveApprovals(parse, publicShortlist, plan.time_start) → upsertBallot(bundle ids, constraints, source) →
 * setStage VOTED → T_VOTE_TALLY {k,n} fan-out (suffix k) + emit vote.tally → maybeCloseVote. Re-votes overwrite until close.
 */
export async function recordBallot(ctx: MemberContext, parse: BallotParse, source: "digits" | "delegate", e: InboundEvent): Promise<void> {
  const v = await votingContext(ctx);
  if (!v) return;
  const { plan } = v;
  const shortlist = await publicShortlist(plan.id, plan.version);
  const approvals = resolveApprovals(parse, shortlist, plan.time_start);
  await upsertBallot({
    plan_id: plan.id, user_id: ctx.user.id, plan_version: plan.version, approvals, constraints: parse.constraints, source,
    at: new Date().toISOString(),
  });
  const stage = ctx.participant.stage;
  if (!stageAtLeast(stage, "VOTED")) await setStage(plan.id, ctx.user.id, "VOTED");
  await publishTally(plan.id, plan.version);
  await maybeCloseVote(plan.id, plan.version);
}

/** Active members and how many hold a ballot for `version` (a ballot from someone who has since left does not count). */
async function tally(planId: string, version: number) {
  const [members, ballots] = await Promise.all([listMembers(planId), listBallots(planId, version)]);
  const voters = new Set(ballots.map((b) => b.user_id));
  return { total: members.length, voted: members.filter((m) => voters.has(m.user_id)).length };
}

/** "k of n voted." to everyone in the vote: counts only, never who. Re-votes keep k, so the tplKey dedupes them. */
async function publishTally(planId: string, version: number): Promise<void> {
  const { voted, total } = await tally(planId, version);
  await emit({ type: "vote.tally", plan_id: planId, voted, total });
  await fanout(planId, "T_VOTE_TALLY", () => ({ k: voted, n: total }), {
    version, suffix: voted, only: (r) => stageAtLeast(r.stage, "PREFS_DONE"),
  });
}

/** Closes when every active member has a ballot for `version`. */
export async function maybeCloseVote(planId: string, version: number): Promise<void> {
  const plan = await getPlan(planId);
  if (!plan || plan.state !== "VOTING" || plan.version !== version) return;
  const { voted, total } = await tally(planId, version);
  if (total > 0 && voted === total) await closeVote(planId, version);
}

/**
 * winnerId = B's computeWinner(planId, version) (non-voters approve nothing) → transition(VOTING→ORDERING, {version}).
 * The winner sets chosen_bundle_id, fans out T_WINNER {title}, enqueues create_order (aJobKeys.createOrder).
 */
export async function closeVote(planId: string, version: number): Promise<void> {
  const plan = await getPlan(planId);
  if (!plan || plan.state !== "VOTING" || plan.version !== version) return;
  const winnerId = await computeWinner(planId, version);
  const winner = (await getShortlist(planId, version)).find((b) => b.id === winnerId);
  if (!winner) throw new Error("closeVote: winner is not in the shortlist");
  // The chosen bundle and create_order commit with the transition: a concurrent closer (last vote vs the vote deadline)
  // can never overwrite the winner afterwards, and a crash can never strand the plan in ORDERING without its job.
  const t = await transition(planId, "VOTING", "ORDERING", {
    version,
    inTx: async (tx) => {
      await setChosenBundle(planId, winnerId, tx);
      await enqueue(A_JOB_KINDS.createOrder, aJobKeys.createOrder(planId, version), new Date(), { version }, { planId, tx });
    },
  });
  if (!t) return;
  await fanout(planId, "T_WINNER", () => ({ title: bundleTitle(winner) }), {
    version, only: (r) => stageAtLeast(r.stage, "PREFS_DONE"),
  });
}

/** due_jobs kind `vote_deadline` (payload {version}): if still VOTING at that version → closeVote. */
export async function voteDeadlineJob(job: DueJob): Promise<void> {
  const version = Number(job.payload.version);
  if (!job.plan_id || !Number.isInteger(version)) return;
  await closeVote(job.plan_id, version);
}
