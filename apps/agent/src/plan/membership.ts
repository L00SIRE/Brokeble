// Membership and the research trigger (A plan T7/T11). Owner A.
import type { InboundEvent, LaneStage } from "@tab/shared";
import { cancelResearch, startResearch } from "../creao/research";
import { sql } from "../db";
import { confirmFormBudget } from "../delegates/budget";
import { enqueue } from "../dueJobs";
import { emit } from "../events";
import { A_JOB_KINDS, aJobKeys } from "../jobs/kinds";
import { errInfo, log } from "../log";
import { fanout } from "../notify/fanout";
import { notify, replyKey, tplKey } from "../notify/notify";
import { startPlanTyping, stopPlanTyping } from "../notify/presence";
import { fmtDate } from "../notify/render";
import { getParticipant, listMembers, updateStage } from "../repo/participants";
import { getPlan, getPlanByCode } from "../repo/plans";
import type { MemberContext, PlanState, UserRow } from "../repo/types";
import { getUser } from "../repo/users";
import { sendStatus } from "../router/handlers";
import { cancel } from "./cancel";
import { stageAtLeast, transition } from "./machine";

export const STILL_LOOKING_AFTER_MS = 90_000;
const JOINABLE: readonly PlanState[] = ["COLLECTING", "RESEARCHING", "VOTING"];
/** Plans whose organizer already got T_SMALL_GROUP; the next GO proceeds. In-memory: a restart re-warns once (harmless). */
const smallGroupWarned = new Set<string>();

/**
 * The only stage writer that emits SSE: repo updateStage + emit `lane` {plan_id, lane, first_name, stage,
 * amount_cents (share amount, public; null before the order), cybs_id_short}, in one transaction. Never a budget.
 */
export async function setStage(planId: string, userId: string, stage: LaneStage, o: { amountCents?: number | null; cybsIdShort?: string | null } = {}): Promise<void> {
  await sql.begin(async (tx) => {
    const row = await updateStage(planId, userId, stage, tx);
    if (!row) return;
    const user = await getUser(userId, tx);
    await emit(
      {
        type: "lane", plan_id: planId, lane: row.lane, first_name: user?.first_name ?? "", stage,
        amount_cents: o.amountCents ?? null, cybs_id_short: o.cybsIdShort ?? null,
      },
      tx,
    );
  });
}

/**
 * "JOIN <code>": plan must be COLLECTING|RESEARCHING|VOTING and the user a non-terminal participant (joined via
 * /join), else T_NOT_IN_PLAN. INVITED/JOINED: set JOINED, T_JOIN_WELCOME {title, date} (once per plan version), then
 * delegates.confirmFormBudget or T_BUDGET_ASK. Already past JOINED: a repeated JOIN just gets T_STATUS.
 */
export async function onJoinText(user: UserRow, code: string, e: InboundEvent): Promise<void> {
  const plan = await getPlanByCode(code);
  const participant = plan && JOINABLE.includes(plan.state) ? await getParticipant(plan.id, user.id) : null;
  if (!plan || !participant || !stageAtLeast(participant.stage, "INVITED")) {
    await notify(user.id, "T_NOT_IN_PLAN", {}, { key: replyKey(e.message_id, 1), replyTo: e.message_id });
    return;
  }
  if (stageAtLeast(participant.stage, "BUDGET_LOCKED")) {
    await sendStatus({ user, plan, participant }, e);
    return;
  }
  if (participant.stage === "INVITED") await setStage(plan.id, user.id, "JOINED");
  const ctx: MemberContext = { user, plan, participant: { ...participant, stage: "JOINED" } };
  await notify(user.id, "T_JOIN_WELCOME", { title: plan.title, date: fmtDate(plan.event_date) }, {
    key: tplKey(plan.id, user.id, "T_JOIN_WELCOME", plan.version), planId: plan.id, replyTo: e.message_id,
  });
  if (await confirmFormBudget(ctx, e)) return;
  // replyKey, not tplKey: a repeated JOIN text re-asks, while a redelivery of the same message stays deduped.
  await notify(user.id, "T_BUDGET_ASK", {}, { key: replyKey(e.message_id, 2), planId: plan.id });
}

/**
 * After a member reaches PREFS_DONE. COLLECTING: PREFS_DONE count ≥ party_target → triggerResearch. RESEARCHING:
 * nothing (recompute runs when options are ready). VOTING: enqueue recompute keyed by `triggerId` (membership changed).
 */
export async function onPrefsDone(planId: string, triggerId: string): Promise<void> {
  const plan = await getPlan(planId);
  if (!plan) return;
  if (plan.state === "COLLECTING") {
    if ((await listMembers(planId)).length >= plan.party_target) await triggerResearch(planId);
  } else if (plan.state === "VOTING") {
    await enqueue(A_JOB_KINDS.recompute, aJobKeys.recompute(planId, triggerId), new Date(), {}, { planId });
  }
}

/**
 * transition(COLLECTING→RESEARCHING), enqueueing still_looking at +90 s in the same transaction. The winner starts
 * typing and calls B's startResearch(planId) (which never throws for CREAO errors). Returns true if this call won.
 */
export async function triggerResearch(planId: string): Promise<boolean> {
  const t = await transition(planId, "COLLECTING", "RESEARCHING", {
    inTx: async (tx) => {
      await enqueue(A_JOB_KINDS.stillLooking, aJobKeys.stillLooking(planId), new Date(Date.now() + STILL_LOOKING_AFTER_MS), {}, { planId, tx });
    },
  });
  if (!t) return false;
  smallGroupWarned.delete(planId);
  startPlanTyping(planId);
  await startResearch(planId);
  return true;
}

/** Organizer GO (else T_ORGANIZER_ONLY): needs ≥2 PREFS_DONE; <3 and not yet warned → T_SMALL_GROUP once; else triggerResearch. */
export async function onGo(ctx: MemberContext, e: InboundEvent): Promise<void> {
  const { user } = ctx;
  if (ctx.plan.organizer_id !== user.id) {
    await notify(user.id, "T_ORGANIZER_ONLY", {}, { key: replyKey(e.message_id, 1), planId: ctx.plan.id, replyTo: e.message_id });
    return;
  }
  const plan = (await getPlan(ctx.plan.id)) ?? ctx.plan;
  const ready = plan.state === "COLLECTING" ? (await listMembers(plan.id)).length : 0;
  if (ready < 2) {
    await sendStatus({ ...ctx, plan }, e); // already past COLLECTING, or too few ready: the status phase says which
    return;
  }
  if (ready < 3 && !smallGroupWarned.has(plan.id)) {
    smallGroupWarned.add(plan.id);
    await notify(user.id, "T_SMALL_GROUP", {}, { key: replyKey(e.message_id, 1), planId: plan.id, replyTo: e.message_id });
    return;
  }
  if (!(await triggerResearch(plan.id))) await sendStatus({ ...ctx, plan: (await getPlan(plan.id)) ?? plan }, e);
}

/** WAIT → T_STATUS. */
export async function onWait(ctx: MemberContext, e: InboundEvent): Promise<void> {
  await sendStatus(ctx, e);
}

export type OutReason = "member_out" | "holdgate_no";

/**
 * "I'm out" / STOP / holdGate NO. COLLECTING|RESEARCHING|VOTING → DECLINED + T_OUT_ACK; in RESEARCHING|VOTING, fewer
 * than 2 active members left → CANCELLED + T_CANCELLED fan-out, else VOTING enqueues recompute. (COLLECTING never
 * auto-cancels: friends may still be joining.) ORDERING|APPROVING → plan/cancel cancel(planId, reason), nobody named.
 * COMMITTING|CONFIRMED and terminal states → T_STATUS (too late). `e` is null when not triggered by an inbound text.
 */
export async function onOut(ctx: MemberContext, e: InboundEvent | null, reason: OutReason): Promise<void> {
  const { user } = ctx;
  const plan = (await getPlan(ctx.plan.id)) ?? ctx.plan;
  const participant = (await getParticipant(plan.id, user.id)) ?? ctx.participant;
  const decline = async () => {
    // DECLINED is reachable only from pre-HELD stages (PLAN §7).
    if (participant.stage !== "DECLINED" && !stageAtLeast(participant.stage, "HELD")) await setStage(plan.id, user.id, "DECLINED");
    await notify(user.id, "T_OUT_ACK", { title: plan.title }, {
      key: tplKey(plan.id, user.id, "T_OUT_ACK", plan.version), planId: plan.id, replyTo: e?.message_id,
    });
  };

  switch (plan.state) {
    case "COLLECTING":
      await decline();
      return;
    case "RESEARCHING":
    case "VOTING": {
      await decline();
      if ((await listMembers(plan.id)).length < 2) {
        const t = await transition(plan.id, ["RESEARCHING", "VOTING"], "CANCELLED");
        if (!t) return;
        stopPlanTyping(plan.id);
        await fanout(plan.id, "T_CANCELLED", () => ({}), { version: t.version });
        await cancelResearch(plan.id).catch((err: unknown) => log.warn({ ...errInfo(err), plan_id: plan.id }, "plan.onOut cancelResearch"));
      } else if (plan.state === "VOTING") {
        await enqueue(A_JOB_KINDS.recompute, aJobKeys.recompute(plan.id, e?.event_id ?? `out:${user.id}`), new Date(), {}, { planId: plan.id });
      }
      return;
    }
    case "ORDERING":
    case "APPROVING":
      // The leaver gets their own ack; everyone else only T_CANCELLED from cancel(), which names nobody. The stage moves
      // first so the leaver is not in that fan-out; the ack waits for the outcome, because a commit that started a moment
      // earlier wins (only a HELD leaver can race one) and then the truthful reply is the status, not "you're out".
      if (!stageAtLeast(participant.stage, "HELD")) await setStage(plan.id, user.id, "DECLINED");
      if (await cancel(plan.id, reason)) await decline();
      else if (e) await sendStatus({ user, plan: (await getPlan(plan.id)) ?? plan, participant }, e);
      return;
    default:
      if (e) await sendStatus({ user, plan, participant }, e);
  }
}
