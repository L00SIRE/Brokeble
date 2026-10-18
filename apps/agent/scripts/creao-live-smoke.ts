// Live Scout smoke test (B plan T10): starts ONE real Scout run on the CREAO hackathon API, polls it exactly like
// research.ts does (15 s, 6 min cap), then parses result.text with the production parser and validator.
// Gated: RUN_LIVE=1 and CREAO_SCOUT_APP_ID (plus CREAO_API_KEY). It spends CREAO credits, so it never runs in CI.
// No database: the run uses TEST_PLAN_REF, so the deployed agent must have AGENT_API_ALLOW_TEST_REF=1 and the CREAO
// secret TAB_AGENT_TOKEN set; the CLI inside the run then validates against it and persists nothing.
// Prints statuses, timings and counts only (never result text, tokens or keys).
// Run: RUN_LIVE=1 pnpm --filter @tab/agent exec tsx --env-file-if-exists=../../.env.local scripts/creao-live-smoke.ts
if (process.env.RUN_LIVE !== "1" || !process.env.CREAO_SCOUT_APP_ID?.trim() || !process.env.CREAO_API_KEY?.trim()) {
  console.log("creao-live-smoke: needs RUN_LIVE=1, CREAO_SCOUT_APP_ID and CREAO_API_KEY; skipping");
  process.exit(0);
}

// Never touches the database or other adapters; pin them so an unrelated .env.local value cannot fail env parsing.
Object.assign(process.env, {
  DATABASE_URL: "postgres://unused@127.0.0.1:9/unused",
  MESSAGING_MODE: "mock",
  LLM_MODE: "mock",
  PLANNER_MODE: "mock",
  VENUE_MODE: "mock",
  VOICE_ENABLED: "false",
  LOG_LEVEL: process.env.LOG_LEVEL || "warn",
});

const { buildResearchBrief } = await import("../src/creao/brief");
const { CreaoPlanner } = await import("../src/creao/client");
const { POLL_INTERVAL_MS, SCOUT_TIMEOUT_MS } = await import("../src/creao/jobs");
const { extractScoutJson } = await import("../src/creao/research");
const { TEST_PLAN_REF, validateSubmission } = await import("../src/agentApi/routes");

const planner = new CreaoPlanner();
const category = process.env.SMOKE_CATEGORY === "show" ? "show" : "dinner";
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date());
const brief = buildResearchBrief(category, { area: "Westwood / Sawtelle", event_date: today, time_start: "18:30", time_end: "23:00" }, [], 4);

const t0 = Date.now();
const secs = () => `${Math.round((Date.now() - t0) / 1000)}s`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const fail = (what: string, e?: unknown): never => {
  console.error(`FAIL ${what}${e instanceof Error ? ` (${e.name}${"status" in e ? ` ${String(e.status)}` : ""})` : ""}`);
  process.exit(1);
};

// A fresh attempt number per invocation: CREAO replays the same run for a repeated idempotency key.
const { runId } = await planner.startScout(TEST_PLAN_REF, brief, Math.floor(Date.now() / 1000)).catch((e) => fail("startScout", e));
console.log(`started ${category} run ${runId} (${secs()})`);

let last = "";
let run = await planner.getRun(runId).catch((e) => fail("getRun", e));
while (run.status === "pending" || run.status === "running") {
  if (run.status !== last) console.log(`[${secs()}] ${run.status}`);
  last = run.status;
  if (Date.now() - t0 > SCOUT_TIMEOUT_MS) {
    await planner.cancel(runId).catch(() => {});
    fail(`timed out after ${secs()} (the production timeout would fall back to cached options)`);
  }
  await sleep(POLL_INTERVAL_MS);
  run = await planner.getRun(runId).catch((e) => fail("getRun", e));
}
console.log(`[${secs()}] ${run.status}${run.errorCode ? ` errorCode=${run.errorCode}` : ""}`);
if (run.status !== "completed") fail(`run ended ${run.status}`);

const text = run.result?.text ?? run.result?.chatText ?? "";
const raw = extractScoutJson(text);
console.log(`result text: ${text.length} chars, JSON ${raw ? "found" : "NOT found"}, artifacts: ${run.result?.artifacts?.length ?? 0}`);
if (raw && typeof raw === "object") {
  const { result, submission } = validateSubmission({ category, ...raw, plan_ref: TEST_PLAN_REF }, { planArea: "Westwood / Sawtelle", runCategory: category });
  if (!result.ok) {
    console.log("validation errors:");
    for (const e of result.errors.slice(0, 10)) console.log(`  ${e.path}: ${e.message}`);
  } else {
    const tiers = new Map<string, number>();
    for (const o of submission!.options) tiers.set(o.price_tier, (tiers.get(o.price_tier) ?? 0) + 1);
    console.log(`valid submission: ${submission!.options.length} options, tiers ${JSON.stringify(Object.fromEntries(tiers))}`);
  }
  process.exit(result.ok ? 0 : 1);
}
// No JSON in the text: Scout may have submitted through the tab CLI instead (the agent logs agent.options). Unverifiable here.
console.log("no JSON in result.text; check the deployed agent's logs for agent.options");
process.exit(1);
