// app.assignments: Photon shared-line seats. Owner A.
import { sql, type Db } from "../db";
import type { AssignmentRow } from "./types";

/** The user's active seat (released_at is null), or null. */
export async function getActiveAssignment(userId: string, tx: Db = sql): Promise<AssignmentRow | null> {
  const [row] = await tx<AssignmentRow[]>`
    select * from app.assignments where user_id = ${userId} and released_at is null
    order by created_at desc limit 1`;
  return row ?? null;
}

/** Records a new seat; idempotent on photon_assignment_id (unique). */
export async function insertAssignment(
  a: { user_id: string; photon_assignment_id: string; assigned_number: string },
  tx: Db = sql,
): Promise<AssignmentRow> {
  // The no-op DO UPDATE makes RETURNING yield the existing row when an assign is replayed.
  const [row] = await tx<AssignmentRow[]>`
    insert into app.assignments (user_id, photon_assignment_id, assigned_number)
    values (${a.user_id}, ${a.photon_assignment_id}, ${a.assigned_number})
    on conflict (photon_assignment_id) do update set photon_assignment_id = excluded.photon_assignment_id
    returning *`;
  return row!;
}

/** How many released seats the user has had: the `:<n>` suffix of the join idempotency key. */
export async function countReleasedAssignments(userId: string, tx: Db = sql): Promise<number> {
  const [row] = await tx<{ n: number }[]>`
    select count(*)::int as n from app.assignments where user_id = ${userId} and released_at is not null`;
  return row!.n;
}

/** Sets released_at=now() (repeat-safe). */
export async function markAssignmentReleased(photonAssignmentId: string, tx: Db = sql): Promise<void> {
  await tx`
    update app.assignments set released_at = now()
    where photon_assignment_id = ${photonAssignmentId} and released_at is null`;
}

/** Active seats whose user's phone is not in `keepPhones` (DEMO_TEAM): /ops/release-seats. */
export async function listActiveAssignmentsExcept(keepPhones: readonly string[], tx: Db = sql): Promise<AssignmentRow[]> {
  return tx<AssignmentRow[]>`
    select a.* from app.assignments a join app.users u on u.id = a.user_id
    where a.released_at is null and u.phone_e164 <> all(${tx.array([...keepPhones])}::text[])
    order by a.created_at, a.id`;
}

/**
 * Active seats older than `olderThanMin` minutes whose user never texted on them: no dm_routes row, or one last
 * updated before the seat was created. Excludes `keepPhones` (DEMO_TEAM). /ops/release-untexted.
 */
export async function listUntextedAssignments(olderThanMin: number, keepPhones: readonly string[], tx: Db = sql): Promise<AssignmentRow[]> {
  return tx<AssignmentRow[]>`
    select a.* from app.assignments a
    join app.users u on u.id = a.user_id
    left join app.dm_routes d on d.user_id = a.user_id
    where a.released_at is null
      and a.created_at < now() - make_interval(mins => ${olderThanMin}::int)
      and (d.user_id is null or d.updated_at < a.created_at)
      and u.phone_e164 <> all(${tx.array([...keepPhones])}::text[])
    order by a.created_at, a.id`;
}
