// app.participants. Owner A. Stage writes here do not emit SSE; plan/membership.ts setStage() wraps them and emits `lane`.
import type { LaneStage } from "@tab/shared";
import { sql, type Db } from "../db";
import { planCols } from "./plans";
import { inTx } from "./sql";
import type { MemberRow, ParticipantRow, PlanRow, PlanState } from "./types";

/** stage ≥ PREFS_DONE and not DECLINED/RELEASED: the set that is rated, votes and gets shares. */
const ACTIVE_STAGES: readonly LaneStage[] = ["PREFS_DONE", "VOTED", "GATED", "LINK_SENT", "HELD", "CAPTURED"];
const NON_RECIPIENT_STAGES: readonly LaneStage[] = ["DECLINED", "INVITED"];
/** Plan states a new member may still join (same set as membership.onJoinText and join/capacity). */
const JOINABLE_STATES: readonly PlanState[] = ["COLLECTING", "RESEARCHING", "VOTING"];

/** One participant row, or null. */
export async function getParticipant(planId: string, userId: string, tx: Db = sql): Promise<ParticipantRow | null> {
  const [row] = await tx<ParticipantRow[]>`
    select * from app.participants where plan_id = ${planId} and user_id = ${userId}`;
  return row ?? null;
}

/** Insert-or-return; a new row gets lane = coalesce(max(lane),0)+1 and stage INVITED. `created` tells the caller to emit `lane`. */
export async function upsertParticipant(planId: string, userId: string, tx?: Db): Promise<{ row: ParticipantRow; created: boolean }> {
  return inTx(tx, async (t) => {
    // Serializes concurrent joins of one plan so max(lane)+1 never collides on unique (plan_id, lane).
    // NO KEY UPDATE does not block the FK key-share locks other writers take on this plan row.
    await t`select 1 from app.plans where id = ${planId} for no key update`;
    const existing = await getParticipant(planId, userId, t);
    if (existing) return { row: existing, created: false };
    const [row] = await t<ParticipantRow[]>`
      insert into app.participants (plan_id, user_id, lane)
      select ${planId}, ${userId}, coalesce(max(lane), 0) + 1 from app.participants where plan_id = ${planId}
      returning *`;
    return { row: row!, created: true };
  });
}

/** Raw stage write; returns the updated row, or null if absent. */
export async function updateStage(planId: string, userId: string, stage: LaneStage, tx: Db = sql): Promise<ParticipantRow | null> {
  const [row] = await tx<ParticipantRow[]>`
    update app.participants set stage = ${stage} where plan_id = ${planId} and user_id = ${userId} returning *`;
  return row ?? null;
}

/**
 * Members ordered by lane. `active` (default true) = stage ≥ PREFS_DONE and not DECLINED/RELEASED: the set that
 * is rated, votes and gets shares. `active: false` returns every participant.
 */
export async function listMembers(planId: string, o: { active?: boolean } = {}, tx: Db = sql): Promise<MemberRow[]> {
  const active = o.active ?? true;
  return tx<MemberRow[]>`
    select pt.*, u.first_name, u.payer_ref from app.participants pt join app.users u on u.id = pt.user_id
    where pt.plan_id = ${planId} ${active ? tx`and pt.stage = any(${tx.array([...ACTIVE_STAGES])}::text[])` : tx``}
    order by pt.lane`;
}

/** Fan-out recipients: every participant whose stage ∉ {DECLINED, INVITED}, ordered by lane. */
export async function listRecipients(planId: string, tx: Db = sql): Promise<MemberRow[]> {
  return tx<MemberRow[]>`
    select pt.*, u.first_name, u.payer_ref from app.participants pt join app.users u on u.id = pt.user_id
    where pt.plan_id = ${planId} and pt.stage <> all(${tx.array([...NON_RECIPIENT_STAGES])}::text[])
    order by pt.lane`;
}

/** Count of participants per stage (status phase map, org_join_status). */
export async function countByStage(planId: string, tx: Db = sql): Promise<Partial<Record<LaneStage, number>>> {
  const rows = await tx<{ stage: LaneStage; n: number }[]>`
    select stage, count(*)::int as n from app.participants where plan_id = ${planId} group by stage`;
  return Object.fromEntries(rows.map((r) => [r.stage, r.n]));
}

/** The member holding `payerRef` in this plan (venue hook dispatch), or null. */
export async function memberByPayerRef(planId: string, payerRef: string, tx: Db = sql): Promise<MemberRow | null> {
  const [row] = await tx<MemberRow[]>`
    select pt.*, u.first_name, u.payer_ref from app.participants pt join app.users u on u.id = pt.user_id
    where pt.plan_id = ${planId} and u.payer_ref = ${payerRef}`;
  return row ?? null;
}

/** Plan ids (any state) where the user is CAPTURED, newest first (receipts). */
export async function capturedPlanIdsForUser(userId: string, tx: Db = sql): Promise<string[]> {
  const rows = await tx<{ id: string }[]>`
    select p.id from app.participants pt join app.plans p on p.id = pt.plan_id
    where pt.user_id = ${userId} and pt.stage = 'CAPTURED' order by p.created_at desc, p.id`;
  return rows.map((r) => r.id);
}

/**
 * The newest plan still open to joiners (COLLECTING|RESEARCHING|VOTING) where the user's lane is INVITED, or null.
 * Router only, and only after currentPlanForUser (which skips INVITED rows) found no live lane: an inbound text from
 * the phone itself proves possession of the number /join was given, so that text may confirm the lane.
 */
export async function newestInvitedPlanForUser(userId: string, tx: Db = sql): Promise<PlanRow | null> {
  const [row] = await tx<PlanRow[]>`
    select ${planCols(tx)} from app.plans p join app.participants pt on pt.plan_id = p.id
    where pt.user_id = ${userId} and pt.stage = 'INVITED' and p.state = any(${tx.array([...JOINABLE_STATES])}::text[])
    order by p.created_at desc, p.id limit 1`;
  return row ?? null;
}
