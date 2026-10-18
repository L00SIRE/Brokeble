// pnpm --filter @tab/agent creao:snapshot <researchRunId> — owner B (docs/plans/B-intelligence-experience.md T10).
// Freezes one finished live Scout run into fixtures/cached-options/<category>.json (CachedOptionsFile format), the
// cached fallback and the PLANNER_MODE=cached source. Prints only counts and the path, never connection strings.
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { ScoutOption } from "@tab/shared";
import { sql } from "../src/db";
import { errInfo } from "../src/log";
import { CachedOptionsFile, cachedOptionsPath } from "../src/ports/cachedOptions";
import { getResearchRun } from "../src/repo/researchRuns";

const TEST_PLAN_REF = "00000000-0000-4000-8000-000000000000"; // fixtures are re-keyed per plan on load

async function main(id: string): Promise<void> {
  const run = await getResearchRun(id);
  if (!run) throw new Error("research run not found");
  if (!run.category || (run.kind !== "scout" && run.kind !== "scout_live_demo")) throw new Error(`run kind ${run.kind} is not a Scout run`);
  if (run.source !== "live" || !run.creao_run_id) throw new Error("only a live CREAO run can be snapshotted");

  // Live-demo runs keep options in result.submission; plan runs keep them in app.options.
  const options: ScoutOption[] = run.result?.submission?.options
    ?? (await sql<{ data: ScoutOption }[]>`select data from app.options where run_id = ${run.id} order by id`).map((r) => r.data);

  const file = CachedOptionsFile.parse({
    plan_ref: TEST_PLAN_REF,
    category: run.category,
    options,
    run_id: run.creao_run_id,
    share_url: run.result?.share_url ?? null,
    captured_at: (run.finished_at ?? new Date()).toISOString(),
    brief: null,
  });
  const path = cachedOptionsPath(run.category);
  await writeFile(path, JSON.stringify(file, null, 2) + "\n", "utf8");
  console.log(`snapshot ${run.category}: ${file.options.length} options → ${fileURLToPath(path)}`);
}

const id = process.argv[2];
if (!id) {
  console.error("usage: pnpm --filter @tab/agent creao:snapshot <researchRunId>");
  process.exit(2);
}
main(id)
  .then(() => sql.end())
  .catch(async (e) => {
    // Name/code only: driver errors can quote connection details.
    console.error("creao:snapshot failed", e instanceof Error ? e.name : "error", errInfo(e).code ?? "");
    await sql.end().catch(() => {});
    process.exit(1);
  });
