// app.bundles: composed bundles per plan version. Written only by A after a winning transition (decision.ts). Owner A.
import type { Bundle } from "@tab/shared";
import type postgres from "postgres";
import { sql, type Db } from "../db";
import { inTx } from "./sql";

/**
 * Writes one version's rows: every survivor with survived=true, shortlist_rank 1..3 in `top3Ids` order, null
 * otherwise. Idempotent on (plan_id, plan_version, id).
 */
export async function writeBundles(planId: string, version: number, survivors: readonly Bundle[], top3Ids: readonly string[], tx?: Db): Promise<void> {
  const rank = new Map(top3Ids.map((id, i) => [id, i + 1]));
  const missing = top3Ids.find((id) => !survivors.some((b) => b.id === id));
  if (missing !== undefined) throw new Error(`writeBundles: shortlist id ${missing} is not a survivor`);
  const byId = new Map(survivors.map((b) => [b.id, { id: b.id, all_in: b.all_in_pp_cents, rank: rank.get(b.id) ?? null, data: b }]));
  const ids = [...byId.keys()];
  await inTx(tx, async (t) => {
    // A rewrite of the same version replaces the set exactly, so a stale shortlist row can never linger.
    await t`
      delete from app.bundles
      where plan_id = ${planId} and plan_version = ${version} and id <> all(${t.array(ids)}::text[])`;
    if (ids.length === 0) return;
    await t`
      insert into app.bundles (plan_id, plan_version, id, data, all_in_pp_cents, survived, shortlist_rank)
      select ${planId}, ${version}, e->>'id', e->'data', (e->>'all_in')::int, true, (e->>'rank')::smallint
      from jsonb_array_elements(${t.json([...byId.values()] as postgres.JSONValue)}) e
      on conflict (plan_id, plan_version, id) do update set data = excluded.data,
        all_in_pp_cents = excluded.all_in_pp_cents, survived = true, shortlist_rank = excluded.shortlist_rank`;
  });
}

/** The version's shortlist ordered by shortlist_rank (index 1..3 = array position + 1). Empty if none. */
export async function getShortlist(planId: string, version: number, tx: Db = sql): Promise<Bundle[]> {
  const rows = await tx<{ data: Bundle }[]>`
    select data from app.bundles
    where plan_id = ${planId} and plan_version = ${version} and shortlist_rank is not null
    order by shortlist_rank`;
  return rows.map((r) => r.data);
}

/** One bundle of a version, or null (create_order loads the winner). */
export async function getBundle(planId: string, version: number, bundleId: string, tx: Db = sql): Promise<Bundle | null> {
  const [row] = await tx<{ data: Bundle }[]>`
    select data from app.bundles where plan_id = ${planId} and plan_version = ${version} and id = ${bundleId}`;
  return row?.data ?? null;
}
