// app.hold_gates: the private YES/NO when a share exceeds a member's effective max (M7). Owner A.
import { sql, type Db } from "../db";
import { ACTIVE_STATES } from "./plans";
import type { HoldGateRow } from "./types";

/** Inserts a pending gate (on conflict do nothing). True if this call created it. */
export async function insertPendingHoldGate(planId: string, userId: string, planVersion: number, shareAmountCents: number, tx: Db = sql): Promise<boolean> {
  const rows = await tx`
    insert into app.hold_gates (plan_id, user_id, plan_version, share_amount_cents, status)
    values (${planId}, ${userId}, ${planVersion}, ${shareAmountCents}, 'pending')
    on conflict (plan_id, user_id, plan_version) do nothing
    returning plan_id`;
  return rows.length > 0;
}

/** One gate, or null. */
export async function getHoldGate(planId: string, userId: string, planVersion: number, tx: Db = sql): Promise<HoldGateRow | null> {
  const [row] = await tx<HoldGateRow[]>`
    select * from app.hold_gates where plan_id = ${planId} and user_id = ${userId} and plan_version = ${planVersion}`;
  return row ?? null;
}

/** The user's newest pending gate in any active plan (the router's 'holdgate' source of truth), or null. */
export async function findPendingHoldGate(userId: string, tx: Db = sql): Promise<HoldGateRow | null> {
  const [row] = await tx<HoldGateRow[]>`
    select g.* from app.hold_gates g join app.plans p on p.id = g.plan_id
    where g.user_id = ${userId} and g.status = 'pending' and p.state = any(${tx.array([...ACTIVE_STATES])}::text[])
    order by g.asked_at desc limit 1`;
  return row ?? null;
}

/** pending → approved|declined, answered_at=now(). True only for the caller that changed it. */
export async function answerHoldGate(planId: string, userId: string, planVersion: number, status: "approved" | "declined", tx: Db = sql): Promise<boolean> {
  const rows = await tx`
    update app.hold_gates set status = ${status}, answered_at = now()
    where plan_id = ${planId} and user_id = ${userId} and plan_version = ${planVersion} and status = 'pending'
    returning plan_id`;
  return rows.length > 0;
}

/** "forget me". */
export async function deleteHoldGatesForUser(userId: string, tx: Db = sql): Promise<void> {
  await tx`delete from app.hold_gates where user_id = ${userId}`;
}
