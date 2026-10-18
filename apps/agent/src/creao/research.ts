// Scout research lifecycle: start, reconcile (hook + poll + timeout share it), cached fallback (B plan T5).
// Hooks for A (standard-names): startResearch(planId), cancelResearch(planId). B → A: plan.onOptionsReady(planId).
// Owner B.
import type { Category, CreaoRun, ResearchBrief, ScoutSubmission } from "@tab/shared";
import { validateSubmission } from "../agentApi/routes";
import { enqueue, type DueJob } from "../dueJobs";
import { env } from "../env";
import { emit } from "../events";
import { errInfo, log } from "../log";
import * as plan from "../plan";
import { ports } from "../ports";
import { loadCachedOptions } from "../ports/cachedOptions";
import * as optionsRepo from "../repo/options";
import { listMembers } from "../repo/participants";
import { getPlan } from "../repo/plans";
import { listPreferences } from "../repo/preferences";
import * as runs from "../repo/researchRuns";
import type { PlanRow, ResearchRunRow, ResearchRunStatus } from "../repo/types";
import { buildResearchBrief } from "./brief";
import { conciergeFallback, onConciergeCompleted } from "./concierge";
import { B_JOB_KINDS, bJobKeys, CONCIERGE_TIMEOUT_MS, POLL_INTERVAL_MS, SCOUT_TIMEOUT_MS } from "./jobs";
import { emitScoutXray } from "./xray";

const CATEGORIES = ["dinner", "show"] as const satisfies readonly Category[];
/** PLANNER_MODE=cached: the "run" resolves from fixtures this long after start, so the console still shows a lane. */
const CACHED_DELAY_MS = 2_000;

type Terminal = Exclude<ResearchRunStatus, "pending" | "running">;
const isTerminal = (s: ResearchRunStatus): s is Terminal => s !== "pending" && s !== "running";

/** The console must never break research: emit failures are logged and swallowed. */
async function safeEmit(ev: Parameters<typeof emit>[0]): Promise<void> {
  try {
    await emit(ev);
  } catch (e) {
    log.warn(errInfo(e), "creao.emit");
  }
}

/** The id the console and /agent/progress use for a run: the CREAO id once known, else ours. */
const consoleRunId = (r: Pick<ResearchRunRow, "id" | "creao_run_id">): string => r.creao_run_id ?? r.id;

async function emitRun(r: ResearchRunRow, status: string, source: "live" | "cached", shareUrl: string | null): Promise<void> {
  await safeEmit({
    type: "creao.run",
    run_id: consoleRunId(r),
    kind: r.kind,
    category: r.category,
    status,
    elapsed_ms: Math.max(0, Date.now() - r.started_at.getTime()),
    source,
    share_url: shareUrl,
  });
}

/** Poll-chain head and the hard timeout (Scout 6 min, Concierge 10 min after the run started). Idempotent on the dedupe keys. */
export async function scheduleRunJobs(
  r: Pick<ResearchRunRow, "id" | "plan_id" | "kind" | "started_at">,
  firstPollDelayMs = POLL_INTERVAL_MS,
): Promise<void> {
  const payload = { research_run_id: r.id };
  const limit = r.kind === "concierge" ? CONCIERGE_TIMEOUT_MS : SCOUT_TIMEOUT_MS;
  await enqueue(B_JOB_KINDS.creaoPoll, bJobKeys.creaoPoll(r.id, 1), new Date(Date.now() + firstPollDelayMs), { ...payload, n: 1 }, { planId: r.plan_id });
  await enqueue(B_JOB_KINDS.creaoTimeout, bJobKeys.creaoTimeout(r.id), new Date(r.started_at.getTime() + limit), payload, { planId: r.plan_id });
}

/**
 * Starts one Scout run whose row already exists (so the agent's first CLI calls pass the active-run check). Never
 * throws for CREAO errors: 402/4xx/5xx settle the run as failed with cached options. Safe to repeat.
 */
export async function launchScout(p: Pick<PlanRow, "ref">, row: ResearchRunRow, brief: ResearchBrief): Promise<void> {
  if (isTerminal(row.status)) return;
  let started = row;
  if (!row.creao_run_id && env.PLANNER_MODE !== "cached") {
    try {
      const { runId } = await ports.planner.startScout(p.ref, brief, row.attempt);
      await runs.setCreaoRunId(row.id, runId, null);
      started = { ...row, creao_run_id: runId };
    } catch (e) {
      log.warn({ run_id: row.id, ...errInfo(e) }, "creao.start_failed");
      await fallback(row);
      await settle(row, "failed");
      return;
    }
  }
  await emitRun(started, started.status, "live", null);
  await scheduleRunJobs(started, started.creao_run_id ? POLL_INTERVAL_MS : CACHED_DELAY_MS);
}

/**
 * A → B, called by the winner of COLLECTING→RESEARCHING. Per category: brief → insertResearchRun (pending, idempotent
 * key) BEFORE the POST → startScout in parallel → setCreaoRunId → poll + timeout jobs → scout x-ray. Safe to retry.
 */
export async function startResearch(planId: string): Promise<void> {
  const p = await getPlan(planId);
  if (!p || p.state !== "RESEARCHING") {
    log.warn({ plan_id: planId, state: p?.state ?? null }, "creao.start_skipped");
    return;
  }
  const members = await listMembers(planId);
  const prefs = (
    await listPreferences(
      planId,
      members.map((m) => m.user_id),
    )
  ).map((x) => x.prefs);
  const briefs = CATEGORIES.map((c) => buildResearchBrief(c, p, prefs, members.length));
  const rows = await Promise.all(
    briefs.map((b) => runs.insertResearchRun({ plan_id: p.id, kind: "scout", category: b.category, attempt: 1, idempotency_key: `scout-${p.ref}-${b.category}-a1` })),
  );
  await Promise.all([
    emitScoutXray(p.id, briefs).catch((e) => log.warn(errInfo(e), "creao.xray")),
    ...rows.map((row, i) => launchScout(p, row, briefs[i]!)),
  ]);
}

/** A → B, on CANCELLED / reset: best-effort planner.cancel for every non-terminal run, then finish them as cancelled. */
export async function cancelResearch(planId: string): Promise<void> {
  const open = await runs.listRunsForPlan(planId, { nonTerminal: true });
  await Promise.all(
    open.map(async (row) => {
      if (row.creao_run_id) await ports.planner.cancel(row.creao_run_id).catch((e) => log.warn({ run_id: row.id, ...errInfo(e) }, "creao.cancel"));
      await settle(row, "cancelled", { ready: false });
    }),
  );
}

/**
 * The exactly-once finish. Only the caller whose conditional update wins emits the final event and, for Scout rows,
 * schedules the readiness check. Options are written before this point, so "both finished" implies "both stored".
 */
async function settle(row: ResearchRunRow, status: Terminal, o: { ready: boolean } = { ready: true }): Promise<boolean> {
  if (!(await runs.finishRun(row.id, status))) return false;
  const fresh = (await runs.getResearchRun(row.id)) ?? row;
  await emitRun(fresh, status, fresh.source, fresh.result?.share_url ?? null);
  if (o.ready && row.kind === "scout") {
    await enqueue(B_JOB_KINDS.checkResearchReady, bJobKeys.checkResearchReady(row.plan_id, row.id), new Date(), { research_run_id: row.id }, { planId: row.plan_id });
  }
  return true;
}

/** Cached options for Scout rows, the code-built itinerary for Concierge rows. */
async function fallback(row: ResearchRunRow): Promise<void> {
  if (row.kind === "concierge") await conciergeFallback(row.plan_id);
  else await useCached(row);
}

/** Live data for this run: CLI-submitted options (live demo: the stored submission). */
async function hasLiveData(row: ResearchRunRow): Promise<boolean> {
  if (row.kind === "scout_live_demo") return ((await runs.getResearchRun(row.id)) ?? row).result?.submission != null;
  return optionsRepo.hasOptionsForRun(row.id);
}

/**
 * No-op if this run already has data (live wins; a repeat is harmless). Else loads the fixture, stores it as this
 * run's options (live demo: result.submission, never app.options), marks the run cached and tells the console.
 */
export async function useCached(row: ResearchRunRow): Promise<void> {
  if (!row.category || (await hasLiveData(row))) return;
  const p = await getPlan(row.plan_id);
  if (!p) return;
  const f = await loadCachedOptions(row.category, p.ref);
  if (row.kind === "scout_live_demo") {
    await runs.mergeRunResult(row.id, {
      submission: { plan_ref: f.plan_ref, category: f.category, options: f.options },
      cached_from_run_id: f.run_id,
      share_url: f.share_url,
    });
  } else {
    await optionsRepo.upsertOptions(p.id, row.id, f.options);
    await runs.mergeRunResult(row.id, { cached_from_run_id: f.run_id, share_url: f.share_url });
  }
  await runs.markRunCached(row.id);
  await emitRun(row, row.status, "cached", f.share_url);
  await safeEmit({ type: "system", level: "info", msg: `cached options (${row.category})` });
}

/** The first ```json fenced block, else the outermost {…}, JSON-parsed; null if none parses. */
export function extractScoutJson(text: string): unknown | null {
  const tryParse = (s: string): unknown | null => {
    try {
      return JSON.parse(s) as unknown;
    } catch {
      return null;
    }
  };
  const fenced = /```json\s*([\s\S]*?)```/i.exec(text)?.[1];
  const fromFence = fenced === undefined ? null : tryParse(fenced);
  if (fromFence !== null) return fromFence;
  const a = text.indexOf("{");
  const b = text.lastIndexOf("}");
  return a >= 0 && b > a ? tryParse(text.slice(a, b + 1)) : null;
}

/** Scout text → a validated, sanitized submission scoped to this run (plan_ref comes from our row, not the model). */
function parseSubmission(raw: unknown, row: ResearchRunRow, p: PlanRow): ScoutSubmission | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const body = { category: row.category, ...raw, plan_ref: p.ref };
  return validateSubmission(body, { planArea: p.area, runCategory: row.category }).submission;
}

/** Completed Scout run without CLI-submitted options: parse result.text, repair once with the LLM, else cached. */
async function ingestScoutResult(row: ResearchRunRow, run: CreaoRun): Promise<void> {
  if (await hasLiveData(row)) return;
  const p = await getPlan(row.plan_id);
  if (!p || !row.category) return;
  const texts = [run.result?.text, run.result?.chatText].filter((t): t is string => !!t);
  let sub: ScoutSubmission | null = null;
  for (const t of texts) {
    sub = parseSubmission(extractScoutJson(t), row, p);
    if (sub) break;
  }
  if (!sub && texts[0]) {
    try {
      const fixed = await ports.llm.repairScoutJson(texts[0], row.category);
      sub = parseSubmission(typeof fixed === "string" ? extractScoutJson(fixed) : fixed, row, p);
    } catch (e) {
      log.warn({ run_id: row.id, ...errInfo(e) }, "creao.repair_failed");
    }
  }
  if (!sub) {
    log.warn({ run_id: row.id }, "creao.scout_unparseable");
    await useCached(row);
  } else if (row.kind === "scout_live_demo") await runs.mergeRunResult(row.id, { submission: sub });
  else await optionsRepo.upsertOptions(p.id, row.id, sub.options);
}

/**
 * Idempotent; shared by hook, poll and timeout. Terminal row → return. getRun → emit → pending|running: mark running;
 * completed: CLI-submitted options or parsed result.text, else cached; failed|cancelled: cached. The raw run is stored
 * under result.creao and the conditional finishRun decides who announces completion. Concierge rows go to the
 * Concierge handlers instead.
 */
export async function reconcile(researchRunId: string): Promise<void> {
  const row = await runs.getResearchRun(researchRunId);
  if (!row || isTerminal(row.status) || !row.creao_run_id) return;
  const run = await ports.planner.getRun(row.creao_run_id);
  if (run.status === "pending" || run.status === "running") {
    await runs.markRunRunning(row.id);
    await emitRun(row, run.status, "live", null);
    return;
  }
  if (row.kind === "concierge") {
    if (run.status === "completed") await onConciergeCompleted(row, run);
    else await conciergeFallback(row.plan_id);
  } else if (run.status === "completed") await ingestScoutResult(row, run);
  else await useCached(row);
  await runs.mergeRunResult(row.id, { creao: run });
  await settle(row, run.status);
}

/** Webhook path: findRunByCreaoRunId → reconcile; unknown id (smoke-test run) → log and return. */
export async function reconcileByCreaoRunId(creaoRunId: string): Promise<void> {
  const row = await runs.findRunByCreaoRunId(creaoRunId);
  if (!row) {
    log.info({ creao_run_id: creaoRunId }, "creao.hook.unknown_run");
    return;
  }
  await reconcile(row.id);
}

/** Both categories now have options (live or cached). */
export async function researchReady(planId: string): Promise<boolean> {
  const have = await optionsRepo.categoriesWithOptions(planId);
  return CATEGORIES.every((c) => have.includes(c));
}

const runIdOf = (job: DueJob): string | null => (typeof job.payload.research_run_id === "string" ? job.payload.research_run_id : null);

/**
 * due_jobs `creao_poll` ({research_run_id, n}): queue poll n+1 first so a transient CREAO error cannot break the
 * chain, then reconcile. PLANNER_MODE=cached runs have no CREAO id and resolve from fixtures here.
 */
export async function creaoPollJob(job: DueJob): Promise<void> {
  const id = runIdOf(job);
  const row = id ? await runs.getResearchRun(id) : null;
  if (!row || isTerminal(row.status)) return;
  const n = Number(job.payload.n) || 1;
  await enqueue(B_JOB_KINDS.creaoPoll, bJobKeys.creaoPoll(row.id, n + 1), new Date(Date.now() + POLL_INTERVAL_MS), { research_run_id: row.id, n: n + 1 }, { planId: row.plan_id });
  try {
    if (!row.creao_run_id && env.PLANNER_MODE === "cached") {
      await fallback(row);
      await settle(row, "completed");
    } else await reconcile(row.id);
  } catch (e) {
    log.warn({ run_id: row.id, n, ...errInfo(e) }, "creao.poll");
  }
}

/** due_jobs `creao_timeout` ({research_run_id}): one last reconcile, then cancel (best effort), timed_out and the fallback. */
export async function creaoTimeoutJob(job: DueJob): Promise<void> {
  const id = runIdOf(job);
  if (!id) return;
  await reconcile(id).catch((e) => log.warn({ run_id: id, ...errInfo(e) }, "creao.timeout_reconcile"));
  const row = await runs.getResearchRun(id);
  if (!row || isTerminal(row.status)) return;
  if (row.creao_run_id) await ports.planner.cancel(row.creao_run_id).catch((e) => log.warn({ run_id: id, ...errInfo(e) }, "creao.cancel"));
  await fallback(row);
  await settle(row, "timed_out");
}

/** due_jobs `check_research_ready` (key <planId>:<researchRunId>): both categories stored → plan.onOptionsReady (A dedupes). */
export async function checkResearchReadyJob(job: DueJob): Promise<void> {
  const id = runIdOf(job);
  const planId = job.plan_id ?? (id ? (await runs.getResearchRun(id))?.plan_id : undefined);
  if (planId && (await researchReady(planId))) await plan.onOptionsReady(planId);
}
