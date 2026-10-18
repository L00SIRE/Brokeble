// P1: the ONLY file with SQL that touches app.private_constraints. Owner A.
// Callers on the P1 allowlist only: src/delegates/**, src/decide/filter.ts, src/decide/score.ts, src/money/holdGate.ts,
// plus write-only callers src/join/routes.ts and src/ops/seed.ts (source 'form'; they never import @tab/shared/private and
// never read). Never log, emit or return these values anywhere else. Import as a namespace: `import * as privateConstraints from "../repo/privateConstraints"`.
import { PrivateConstraints } from "@tab/shared/private";
import { sql, type Db } from "../db";

export type PrivateConstraintsInput = Omit<PrivateConstraints, "confirmed_at"> & { confirmed_at?: string | null };

type Row = Omit<PrivateConstraints, "confirmed_at"> & { confirmed_at: Date | null };
const toConstraints = (r: Row): PrivateConstraints => ({ ...r, confirmed_at: r.confirmed_at ? r.confirmed_at.toISOString() : null });
const COLS = (db: Db) => db`plan_id, user_id, target_pp_cents, hard_max_pp_cents, source, confidence, confirmed_at`;

/** That person's constraints for the plan, or null. */
export async function get(planId: string, userId: string, tx: Db = sql): Promise<PrivateConstraints | null> {
  const [row] = await tx<Row[]>`
    select ${COLS(tx)} from app.private_constraints where plan_id = ${planId} and user_id = ${userId}`;
  return row ? toConstraints(row) : null;
}

/** Validates with PrivateConstraints.parse (500..100000 cents, hard_max ≥ target), then upserts on (plan_id, user_id). */
export async function upsert(c: PrivateConstraintsInput, tx: Db = sql): Promise<void> {
  const v = PrivateConstraints.parse({ ...c, confirmed_at: c.confirmed_at ?? null });
  // Message names no values (P1): this error can reach logs via errInfo.
  if (v.hard_max_pp_cents !== null && v.hard_max_pp_cents < v.target_pp_cents) throw new Error("private_constraints: hard_max below target");
  await tx`
    insert into app.private_constraints (plan_id, user_id, target_pp_cents, hard_max_pp_cents, source, confidence, confirmed_at)
    values (${v.plan_id}, ${v.user_id}, ${v.target_pp_cents}, ${v.hard_max_pp_cents}, ${v.source}, ${v.confidence},
      ${v.confirmed_at}::timestamptz)
    on conflict (plan_id, user_id) do update set target_pp_cents = excluded.target_pp_cents,
      hard_max_pp_cents = excluded.hard_max_pp_cents, source = excluded.source, confidence = excluded.confidence,
      confirmed_at = excluded.confirmed_at`;
}

/** Every member's constraints for the plan (optionally only `userIds`): decide/score.ts orchestrators only. */
export async function listForPlan(planId: string, userIds?: readonly string[], tx: Db = sql): Promise<PrivateConstraints[]> {
  const rows = await tx<Row[]>`
    select ${COLS(tx)} from app.private_constraints
    where plan_id = ${planId} ${userIds ? tx`and user_id = any(${tx.array([...userIds])}::uuid[])` : tx``}
    order by user_id`;
  return rows.map(toConstraints);
}

/** "forget me": deletes the user's rows in every plan. */
export async function deleteForUser(userId: string, tx: Db = sql): Promise<void> {
  await tx`delete from app.private_constraints where user_id = ${userId}`;
}
