// app.ballots: one ballot per (plan, user, version); a re-vote overwrites. Owner A.
import { Ballot } from "@tab/shared";
import type postgres from "postgres";
import { sql, type Db } from "../db";

/** Validates with Ballot.parse (approvals are bundle ids, already resolved in code), then upserts. */
export async function upsertBallot(b: Ballot, tx: Db = sql): Promise<void> {
  const v = Ballot.parse(b);
  await tx`
    insert into app.ballots (plan_id, user_id, plan_version, approvals, constraints, source, created_at)
    values (${v.plan_id}, ${v.user_id}, ${v.plan_version}, ${tx.array(v.approvals)}::text[],
      ${tx.json(v.constraints as postgres.JSONValue)}, ${v.source}, ${v.at}::timestamptz)
    on conflict (plan_id, user_id, plan_version) do update set approvals = excluded.approvals,
      constraints = excluded.constraints, source = excluded.source, created_at = excluded.created_at`;
}

/** Every ballot for a version (`at` = created_at ISO). */
export async function listBallots(planId: string, version: number, tx: Db = sql): Promise<Ballot[]> {
  const rows = await tx<(Omit<Ballot, "at"> & { created_at: Date })[]>`
    select plan_id, user_id, plan_version, approvals, constraints, source, created_at from app.ballots
    where plan_id = ${planId} and plan_version = ${version} order by created_at, user_id`;
  return rows.map(({ created_at, ...r }) => ({ ...r, at: created_at.toISOString() }));
}

/** "forget me". */
export async function deleteBallotsForUser(userId: string, tx: Db = sql): Promise<void> {
  await tx`delete from app.ballots where user_id = ${userId}`;
}
