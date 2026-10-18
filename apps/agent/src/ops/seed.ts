// seedDemo (A plan T7/T14; PLAN §3.1 step 0). Writes rows and enqueues recompute; never sends (only the agent's
// poller sends). Team phones come from env DEMO_TEAM (PII); synthetic budgets/prefs from fixtures/demo-seed.json. Owner A.
import { readFile } from "node:fs/promises";
import * as z from "zod";
import { type Category, HHMM, Preferences } from "@tab/shared";
import { enqueue } from "../dueJobs";
import { env } from "../env";
import { emit } from "../events";
import { loadCachedOptions } from "../ports/cachedOptions";
import { aJobKeys, A_JOB_KINDS } from "../jobs/kinds";
import { transition } from "../plan/machine";
import { setStage } from "../plan/membership";
import * as options from "../repo/options";
import * as participants from "../repo/participants";
import * as plans from "../repo/plans";
import * as preferences from "../repo/preferences";
import * as privateConstraints from "../repo/privateConstraints";
import * as researchRuns from "../repo/researchRuns";
import * as users from "../repo/users";

/** fixtures/demo-seed.json: plan shape + lane i's synthetic budget and prefs (B's demo.fixture.test reads the same file). */
export const DemoSeed = z.strictObject({
  plan: z.strictObject({
    title: z.string().min(1),
    area: z.string().min(2).max(60),
    time_start: HHMM,
    time_end: HHMM,
    party_target: z.number().int().min(2).max(8),
  }),
  members: z
    .array(
      z.strictObject({
        target_pp_cents: z.number().int().min(500).max(100000),
        hard_max_pp_cents: z.number().int().min(500).max(100000).nullable(),
        prefs: Preferences,
      }),
    )
    .min(1)
    .max(8),
});
export type DemoSeed = z.infer<typeof DemoSeed>;

/** fixtures/demo-script.json: Replay's scripted team texts, in order (lane = DEMO_TEAM index + 1). */
export const DemoScript = z.strictObject({
  steps: z.array(z.strictObject({ lane: z.number().int().min(1).max(8), text: z.string().min(1).max(2000) })).min(1),
});
export type DemoScript = z.infer<typeof DemoScript>;

export const demoSeedPath = new URL("../../fixtures/demo-seed.json", import.meta.url);
export const demoScriptPath = new URL("../../fixtures/demo-script.json", import.meta.url);

const CATEGORIES: readonly Category[] = ["dinner", "show"];

/** Reads and validates fixtures/demo-seed.json. */
export async function loadDemoSeed(): Promise<DemoSeed> {
  return DemoSeed.parse(JSON.parse(await readFile(demoSeedPath, "utf8")));
}

/** Reads and validates fixtures/demo-script.json. */
export async function loadDemoScript(): Promise<DemoScript> {
  return DemoScript.parse(JSON.parse(await readFile(demoScriptPath, "utf8")));
}

/** LA-local today as IsoDate (Fly runs UTC, so `toISOString` would flip to tomorrow at 5 PM PT). */
export function laToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(now);
}

/**
 * Demo plan at RESEARCHING with the first min(seed, DEMO_TEAM) team members already at PREFS_DONE, cached Scout
 * options loaded and a `recompute` job queued; the agent's poller then runs the real shortlist. Writes rows only:
 * messages go out from the agent process. Lane i is DEMO_TEAM[i-1], so the replay script's lane numbers are stable.
 */
export async function seedDemo(): Promise<{ planId: string; planRef: string; code: string }> {
  const seed = await loadDemoSeed();
  const team = env.DEMO_TEAM.slice(0, seed.members.length);
  if (team.length === 0) throw new Error("DEMO_TEAM is empty: set it to a JSON array of {phone_e164, first_name}");

  const members = [];
  for (const t of team) members.push(await users.upsertUserByPhone({ phone_e164: t.phone_e164, first_name: t.first_name }));

  let plan;
  try {
    plan = await plans.insertPlan({ code: env.DEMO_CODE, event_date: laToday(), organizer_id: members[0]!.id, ...seed.plan });
  } catch (e) {
    if (e instanceof Error && "code" in e && e.code === "23505") throw new Error(`join code ${env.DEMO_CODE} is in use: run reset first`);
    throw e;
  }

  for (const [i, user] of members.entries()) {
    const m = seed.members[i]!;
    await participants.upsertParticipant(plan.id, user.id);
    await privateConstraints.upsert({
      plan_id: plan.id,
      user_id: user.id,
      target_pp_cents: m.target_pp_cents,
      hard_max_pp_cents: m.hard_max_pp_cents,
      source: "form",
      confidence: "high",
      confirmed_at: new Date().toISOString(),
    });
    await preferences.upsertPreferences(plan.id, user.id, m.prefs);
    await setStage(plan.id, user.id, "PREFS_DONE");
  }

  for (const category of CATEGORIES) {
    const cached = await loadCachedOptions(category, plan.ref);
    const run = await researchRuns.insertResearchRun({
      plan_id: plan.id,
      kind: "scout",
      category,
      idempotency_key: `seed:${plan.id}:${category}`,
      status: "completed",
      source: "cached",
      result: { cached_from_run_id: cached.run_id, share_url: cached.share_url },
    });
    await options.upsertOptions(plan.id, run.id, cached.options);
    await emit({ type: "creao.run", run_id: run.id, kind: "scout", category, status: "completed", elapsed_ms: 0, source: "cached", share_url: cached.share_url });
  }

  if (await transition(plan.id, "COLLECTING", "RESEARCHING")) {
    await enqueue(A_JOB_KINDS.recompute, aJobKeys.recompute(plan.id, "seed"), new Date(), {}, { planId: plan.id });
  }
  return { planId: plan.id, planRef: plan.ref, code: plan.code };
}
