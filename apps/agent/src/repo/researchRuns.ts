// app.research_runs: CREAO Scout/Concierge runs (B's main table; SQL owned by A). Owner A.
import type { Category } from "@tab/shared";
import type postgres from "postgres";
import { sql, type Db } from "../db";
import { getPlan } from "./plans";
import { isUuid } from "./sql";
import type { NewResearchRun, PlanRow, ResearchRunKind, ResearchRunResult, ResearchRunRow, ResearchRunStatus } from "./types";

/** PLAN §8: the /agent/* active-run window. */
const DEFAULT_ACTIVE_MAX_AGE_MIN = 20;
const json = (db: Db, v: unknown) => db.json(v as postgres.JSONValue);

/** Insert-or-return on idempotency_key (unique): a retried startResearch never creates a second row. */
export async function insertResearchRun(r: NewResearchRun, tx: Db = sql): Promise<ResearchRunRow> {
  const [row] = await tx<ResearchRunRow[]>`
    insert into app.research_runs (plan_id, kind, category, attempt, idempotency_key, status, source, creao_run_id, result)
    values (${r.plan_id}, ${r.kind}, ${r.category}, ${r.attempt ?? 1}, ${r.idempotency_key}, ${r.status ?? "pending"},
      ${r.source ?? "live"}, ${r.creao_run_id ?? null}, ${r.result == null ? null : json(tx, r.result)})
    on conflict (idempotency_key) do nothing
    returning *`;
  if (row) return row;
  const [existing] = await tx<ResearchRunRow[]>`select * from app.research_runs where idempotency_key = ${r.idempotency_key}`;
  return existing!;
}

/** One run by id, or null. */
export async function getResearchRun(id: string, tx: Db = sql): Promise<ResearchRunRow | null> {
  if (!isUuid(id)) return null;
  const [row] = await tx<ResearchRunRow[]>`select * from app.research_runs where id = ${id}`;
  return row ?? null;
}

/** By CREAO run id (webhook hint), or null. */
export async function findRunByCreaoRunId(creaoRunId: string, tx: Db = sql): Promise<ResearchRunRow | null> {
  const [row] = await tx<ResearchRunRow[]>`select * from app.research_runs where creao_run_id = ${creaoRunId}`;
  return row ?? null;
}

/** Stores the CREAO run id (and thread id) after POST /runs. */
export async function setCreaoRunId(id: string, creaoRunId: string, threadId: string | null, tx: Db = sql): Promise<void> {
  await tx`update app.research_runs set creao_run_id = ${creaoRunId}, thread_id = ${threadId} where id = ${id}`;
}

/** pending → running only; a terminal row is never touched. */
export async function markRunRunning(id: string, tx: Db = sql): Promise<void> {
  await tx`update app.research_runs set status = 'running' where id = ${id} and status = 'pending'`;
}

/**
 * The exactly-once finish: `update … set status, finished_at=now() where id=$1 and status in ('pending','running')`.
 * True only for the caller that won; only that caller may act on the result (useCached, check_research_ready).
 */
export async function finishRun(
  id: string,
  status: Exclude<ResearchRunStatus, "pending" | "running">,
  o: { source?: "live" | "cached" } = {},
  tx: Db = sql,
): Promise<boolean> {
  const rows = await tx`
    update app.research_runs set status = ${status}, finished_at = now(), source = coalesce(${o.source ?? null}, source)
    where id = ${id} and status in ('pending', 'running')
    returning id`;
  return rows.length > 0;
}

/** Sets source='cached' (useCached), independent of status. */
export async function markRunCached(id: string, tx: Db = sql): Promise<void> {
  await tx`update app.research_runs set source = 'cached' where id = ${id}`;
}

/** Shallow-merges keys into result (jsonb ||), so `creao` never overwrites `itinerary`. */
export async function mergeRunResult(id: string, patch: ResearchRunResult, tx: Db = sql): Promise<void> {
  await tx`update app.research_runs set result = coalesce(result, '{}'::jsonb) || ${json(tx, patch)} where id = ${id}`;
}

/** Runs for a plan, oldest first; filters are ANDed. */
export async function listRunsForPlan(
  planId: string,
  o: { kind?: ResearchRunKind; nonTerminal?: boolean } = {},
  tx: Db = sql,
): Promise<ResearchRunRow[]> {
  return tx<ResearchRunRow[]>`
    select * from app.research_runs
    where plan_id = ${planId}
      ${o.kind ? tx`and kind = ${o.kind}` : tx``}
      ${o.nonTerminal ? tx`and status in ('pending', 'running')` : tx``}
    order by started_at, id`;
}

/**
 * /agent/* active-run check (PLAN §8): plans.ref = planRef, kind ∈ kinds, status ∈ (pending, running),
 * started_at > now() - maxAgeMin, and category = `category` when it is non-null. Newest match, or null.
 */
export async function findActiveRun(
  planRef: string,
  kinds: readonly ResearchRunKind[],
  category: Category | null,
  maxAgeMin: number = DEFAULT_ACTIVE_MAX_AGE_MIN,
  tx: Db = sql,
): Promise<{ run: ResearchRunRow; plan: PlanRow } | null> {
  if (!isUuid(planRef) || kinds.length === 0) return null;
  const [run] = await tx<ResearchRunRow[]>`
    select r.* from app.research_runs r join app.plans p on p.id = r.plan_id
    where p.ref = ${planRef} and r.kind = any(${tx.array([...kinds])}::text[]) and r.status in ('pending', 'running')
      and r.started_at > now() - interval '1 minute' * ${maxAgeMin}::float8
      ${category ? tx`and r.category = ${category}` : tx``}
    order by r.started_at desc limit 1`;
  if (!run) return null;
  const plan = await getPlan(run.plan_id, tx);
  return plan ? { run, plan } : null;
}

/** started_at of the newest scout_live_demo run (3-min debounce), or null. */
export async function latestLiveDemoStartedAt(tx: Db = sql): Promise<Date | null> {
  const [row] = await tx<{ at: Date | null }[]>`
    select max(started_at) as at from app.research_runs where kind = 'scout_live_demo'`;
  return row?.at ?? null;
}
