// "Start live Scout" demo beat (B plan C-9/T12). Runs against a dedicated SHOWCASE plan so the /agent active-run check
// stays unambiguous; its options never enter app.options (kept in research_runs.result.submission). Owner B.
import { randomInt } from "node:crypto";
import { errInfo, log } from "../log";
import { laToday } from "../ops/seed";
import { findShowcasePlan, insertPlan } from "../repo/plans";
import { insertResearchRun, latestLiveDemoStartedAt, listRunsForPlan } from "../repo/researchRuns";
import type { PlanRow } from "../repo/types";
import { buildResearchBrief } from "./brief";
import { launchScout } from "./research";

export const LIVE_DEMO_DEBOUNCE_MS = 3 * 60_000;

export type LiveScoutResult = { ok: true; research_run_id: string } | { ok: false; reason: "debounced" };

const SHOWCASE = { title: "Live Scout showcase", area: "Westwood / Sawtelle", time_start: "18:30", time_end: "23:00", party_target: 4 } as const;
const isUniqueViolation = (e: unknown): boolean => e instanceof Error && "code" in e && e.code === "23505";

/** The one SHOWCASE plan, created on first use with code 'S' + 3 base36 chars (retried on a code collision). */
export async function ensureShowcasePlan(): Promise<PlanRow> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const existing = await findShowcasePlan();
    if (existing) return existing;
    const code = "S" + randomInt(36 ** 3).toString(36).padStart(3, "0");
    try {
      return await insertPlan({ ...SHOWCASE, code, event_date: laToday(), organizer_id: null, state: "SHOWCASE" });
    } catch (e) {
      if (!isUniqueViolation(e)) throw e; // a code collision or a concurrent creator: look again
    }
  }
  throw new Error("could not create the showcase plan");
}

/**
 * A → B hook (/ops/live-scout). A live demo started < 3 min ago → {ok:false, reason:"debounced"}. Else a
 * scout_live_demo run (dinner, key `live-<showcaseRef>-dinner-<unixMinute>`) with poll + timeout jobs. A CREAO
 * failure still returns ok: the run settles on cached options like any Scout run.
 */
export async function startLiveScoutDemo(): Promise<LiveScoutResult> {
  const last = await latestLiveDemoStartedAt();
  if (last && Date.now() - last.getTime() < LIVE_DEMO_DEBOUNCE_MS) return { ok: false, reason: "debounced" };
  const plan = await ensureShowcasePlan();
  // The showcase row outlives the day it was created on, so the brief always carries today's date.
  const brief = buildResearchBrief("dinner", { ...plan, event_date: laToday() }, [], plan.party_target);
  // CREAO's idempotency key is derived from the attempt, so every demo run needs its own attempt number.
  const attempt = (await listRunsForPlan(plan.id, { kind: "scout_live_demo" })).length + 1;
  const row = await insertResearchRun({
    plan_id: plan.id,
    kind: "scout_live_demo",
    category: "dinner",
    attempt,
    idempotency_key: `live-${plan.ref}-dinner-${Math.floor(Date.now() / 60_000)}`,
  });
  await launchScout(plan, row, brief).catch((e) => log.error({ run_id: row.id, ...errInfo(e) }, "creao.live_demo"));
  return { ok: true, research_run_id: row.id };
}
