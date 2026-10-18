// Format of fixtures/cached-options/<category>.json: the cached-Scout fallback (B's research.ts) and the source
// for PLANNER_MODE=mock|cached. The committed files are placeholders (fake venues on example.com); owner B replaces
// them with real Scout snapshots (`pnpm --filter @tab/agent creao:snapshot <researchRunId>`).
import { readFile } from "node:fs/promises";
import * as z from "zod";
import { type Category, IsoDateTime, ResearchBrief, ScoutSubmission } from "@tab/shared";

export const CachedOptionsFile = ScoutSubmission.extend({
  run_id: z.string().min(1), // the real CREAO run id the snapshot came from
  share_url: z.url().nullable(), // public share link of that run's [API] thread
  captured_at: IsoDateTime,
  brief: ResearchBrief.nullable(),
});
export type CachedOptionsFile = z.infer<typeof CachedOptionsFile>;

export const cachedOptionsPath = (category: Category): URL => new URL(`../../fixtures/cached-options/${category}.json`, import.meta.url);

/** Loads and validates a fixture; `planRef` rewrites plan_ref for the plan being served. */
export async function loadCachedOptions(category: Category, planRef?: string): Promise<CachedOptionsFile> {
  const file = CachedOptionsFile.parse(JSON.parse(await readFile(cachedOptionsPath(category), "utf8")));
  if (file.category !== category) throw new Error(`fixture ${category}.json has category ${file.category}`);
  return planRef ? { ...file, plan_ref: planRef } : file;
}
