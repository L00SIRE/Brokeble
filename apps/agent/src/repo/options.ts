// app.options: Scout options per plan (live CLI submits, result.text parses, or cached fixtures). Owner A.
import { createHash } from "node:crypto";
import { ScoutOption, type Category, type Option } from "@tab/shared";
import type postgres from "postgres";
import { sql, type Db } from "../db";

/** 'opt_' + sha1(category|name|address)[0:10] (PLAN §8). Stable across live and cached sources. */
export function optionId(o: Pick<ScoutOption, "category" | "name" | "address">): string {
  return "opt_" + createHash("sha1").update(`${o.category}|${o.name}|${o.address}`).digest("hex").slice(0, 10);
}

/** Upserts on (plan_id, optionId(o)) with run_id = the research_runs row id. Returns the number written. */
export async function upsertOptions(planId: string, researchRunId: string, options: readonly ScoutOption[], tx: Db = sql): Promise<number> {
  // Dedupe by id (last wins): one INSERT … ON CONFLICT DO UPDATE cannot touch the same row twice.
  const byId = new Map(options.map((o) => {
    const data = ScoutOption.parse(o);
    return [optionId(data), { id: optionId(data), category: data.category, data }] as const;
  }));
  if (byId.size === 0) return 0;
  // One statement for the whole batch: atomic and a single round trip on the pooler.
  const rows = await tx`
    insert into app.options (plan_id, id, run_id, category, data)
    select ${planId}, e->>'id', ${researchRunId}::uuid, e->>'category', e->'data'
    from jsonb_array_elements(${tx.json([...byId.values()] as postgres.JSONValue)}) e
    on conflict (plan_id, id) do update set run_id = excluded.run_id, category = excluded.category, data = excluded.data
    returning id`;
  return rows.length;
}

/** Every option for the plan as `Option` (source joined from research_runs.source; est_high_pp_cents = usd×100), sorted by id. */
export async function listOptions(planId: string, tx: Db = sql): Promise<Option[]> {
  const rows = await tx<{ id: string; run_id: string; source: Option["source"] | null; data: ScoutOption }[]>`
    select o.id, o.run_id::text as run_id, r.source, o.data
    from app.options o left join app.research_runs r on r.id = o.run_id
    where o.plan_id = ${planId} order by o.id`;
  return rows.map((r) => ({
    id: r.id,
    run_id: r.run_id,
    source: r.source ?? "live",
    data: r.data,
    est_high_pp_cents: Math.round(r.data.est_high_pp_usd * 100),
  }));
}

/** True if any option row came from this run (useCached must not mix cached into live data). */
export async function hasOptionsForRun(researchRunId: string, tx: Db = sql): Promise<boolean> {
  const [row] = await tx<{ ok: boolean }[]>`select exists(select 1 from app.options where run_id = ${researchRunId}) as ok`;
  return row!.ok;
}

/** Categories that have ≥1 option for the plan (check_research_ready: both → plan.onOptionsReady). */
export async function categoriesWithOptions(planId: string, tx: Db = sql): Promise<Category[]> {
  const rows = await tx<{ category: Category }[]>`
    select distinct category from app.options where plan_id = ${planId} order by category`;
  return rows.map((r) => r.category);
}

/** Both categories have options (the condition under which B's onOptionsReady queues the recompute). */
export async function optionsReady(planId: string, tx: Db = sql): Promise<boolean> {
  const have = await categoriesWithOptions(planId, tx);
  return have.includes("dinner") && have.includes("show");
}
