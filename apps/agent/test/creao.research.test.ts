import { beforeEach, describe, expect, it, vi } from "vitest";
import { CreaoError } from "../src/creao/client";

const m = vi.hoisted(() => ({
  startScout: vi.fn(), getRun: vi.fn(), cancel: vi.fn(), repairScoutJson: vi.fn(),
  emit: vi.fn(), enqueue: vi.fn(), onOptionsReady: vi.fn(),
  conciergeFallback: vi.fn(), onConciergeCompleted: vi.fn(),
  getPlan: vi.fn(), listMembers: vi.fn(), listPreferences: vi.fn(),
  insertResearchRun: vi.fn(), getResearchRun: vi.fn(), findRunByCreaoRunId: vi.fn(), setCreaoRunId: vi.fn(), markRunRunning: vi.fn(),
  finishRun: vi.fn(), markRunCached: vi.fn(), mergeRunResult: vi.fn(), listRunsForPlan: vi.fn(),
  hasOptionsForRun: vi.fn(), upsertOptions: vi.fn(), categoriesWithOptions: vi.fn(),
}));
vi.mock("../src/ports", () => ({
  ports: { planner: { startScout: m.startScout, getRun: m.getRun, cancel: m.cancel }, llm: { repairScoutJson: m.repairScoutJson } },
}));
vi.mock("../src/events", () => ({ emit: m.emit }));
vi.mock("../src/dueJobs", async (orig) => ({ ...(await orig<typeof import("../src/dueJobs")>()), enqueue: m.enqueue }));
vi.mock("../src/plan", () => ({ onOptionsReady: m.onOptionsReady }));
vi.mock("../src/creao/concierge", () => ({
  conciergeFallback: m.conciergeFallback, onConciergeCompleted: m.onConciergeCompleted, deliverItinerary: vi.fn(),
}));
vi.mock("../src/repo/plans", () => ({ getPlan: m.getPlan }));
vi.mock("../src/repo/participants", () => ({ listMembers: m.listMembers }));
vi.mock("../src/repo/preferences", () => ({ listPreferences: m.listPreferences }));
vi.mock("../src/repo/researchRuns", () => ({
  insertResearchRun: m.insertResearchRun, getResearchRun: m.getResearchRun, findRunByCreaoRunId: m.findRunByCreaoRunId,
  setCreaoRunId: m.setCreaoRunId, markRunRunning: m.markRunRunning, finishRun: m.finishRun, markRunCached: m.markRunCached,
  mergeRunResult: m.mergeRunResult, listRunsForPlan: m.listRunsForPlan,
}));
vi.mock("../src/repo/options", () => ({
  hasOptionsForRun: m.hasOptionsForRun, upsertOptions: m.upsertOptions, categoriesWithOptions: m.categoriesWithOptions,
}));

import type { Option, ScoutOption } from "@tab/shared";
import { compose } from "../src/decide/compose";
import { SHORTLIST_N } from "../src/decide/config";
import { filter } from "../src/decide/filter";
import { fitsPrefs } from "../src/decide/fitsPrefs";
import { selectForRating } from "../src/decide/rateCandidates";
import { shortlist } from "../src/decide/score";
import { DEFAULT_END, DEFAULT_START } from "../src/plan/defaults";
import type { DueJob } from "../src/dueJobs";
import { loadCachedOptions } from "../src/ports/cachedOptions";
import { env } from "../src/env";
import {
  cancelResearch, checkResearchReadyJob, creaoPollJob, creaoTimeoutJob, extractScoutJson, reconcile, reconcileByCreaoRunId,
  researchReady, startResearch, useCached,
} from "../src/creao/research";

const REF = "11111111-1111-4111-8111-111111111111";
const PLAN = { id: "plan-1", ref: REF, state: "RESEARCHING", area: "Westwood / Sawtelle", event_date: "2026-10-17", time_start: "18:30", time_end: "23:00" };
const row = (o: object = {}) => ({
  id: "run-1", plan_id: "plan-1", kind: "scout", category: "dinner", attempt: 1, creao_run_id: "cr-1", status: "pending", source: "live",
  started_at: new Date(Date.now() - 5_000), finished_at: null, result: null, ...o,
});
const dinner = (i: number) => ({
  category: "dinner", name: `Place ${i}`, address: `${i} Main St, Los Angeles, CA`, area: "westwood / sawtelle", url: "https://example.com/p",
  price_tier: "$25-50", est_low_pp_usd: 20, est_high_pp_usd: 40, price_evidence_url: "https://example.com/menu",
  dietary_fit: [], pitch: "Great tacos see https://x.com", opens: "11:00", closes: "23:00", hours_evidence_url: "https://example.com/hours",
});
const submission = { plan_ref: REF, category: "dinner", options: Array.from({ length: 6 }, (_, i) => dinner(i)) };
const fenced = (o: unknown) => "Done!\n```json\n" + JSON.stringify(o) + "\n```\nbye";
const completed = (text: string) => ({ id: "cr-1", status: "completed", result: { text } });
const job = (payload: Record<string, unknown>, o: Partial<DueJob> = {}): DueJob => ({
  id: 1, plan_id: "plan-1", kind: "x", dedupe_key: "k", due_at: new Date(), payload, attempts: 1, ...o,
});
const enqueued = (kind: string) => m.enqueue.mock.calls.filter((c) => c[0] === kind);

beforeEach(() => {
  vi.resetAllMocks();
  env.PLANNER_MODE = "mock";
  m.enqueue.mockResolvedValue(true);
  m.emit.mockResolvedValue(1);
  m.getPlan.mockResolvedValue(PLAN);
  m.getResearchRun.mockResolvedValue(row());
  m.finishRun.mockResolvedValue(true);
  m.hasOptionsForRun.mockResolvedValue(false);
  m.upsertOptions.mockResolvedValue(6);
  m.cancel.mockResolvedValue(undefined);
});

describe("extractScoutJson", () => {
  it("prefers the fenced json block", () => {
    expect(extractScoutJson('x {"a":0}\n```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });
  it("falls back to the outermost braces, including when a fence holds no JSON", () => {
    expect(extractScoutJson('Here: {"a":{"b":2}} thanks')).toEqual({ a: { b: 2 } });
    expect(extractScoutJson('```json\nnot json\n```\n{"a":3}')).toEqual({ a: 3 });
  });
  it("returns null when nothing parses", () => {
    expect(extractScoutJson("no json here")).toBeNull();
    expect(extractScoutJson("{ not json }")).toBeNull();
  });
});

describe("startResearch", () => {
  beforeEach(() => {
    m.listMembers.mockResolvedValue([{ user_id: "u1" }, { user_id: "u2" }, { user_id: "u3" }]);
    m.listPreferences.mockResolvedValue([{ user_id: "u1", prefs: { dietary: ["vegan"], vibe: ["lively"], cuisines_like: ["thai"] } }]);
    m.insertResearchRun.mockImplementation(async (r) => row({ id: `run-${r.category}`, category: r.category, creao_run_id: null }));
    m.startScout.mockImplementation(async (_ref, b) => ({ runId: `cr-${b.category}` }));
  });

  it("inserts both rows before any POST, sends PII-free briefs, and schedules poll + timeout", async () => {
    await startResearch("plan-1");
    expect(m.insertResearchRun.mock.calls.map((c) => c[0].idempotency_key)).toEqual([`scout-${REF}-dinner-a1`, `scout-${REF}-show-a1`]);
    expect(Math.max(...m.insertResearchRun.mock.invocationCallOrder)).toBeLessThan(Math.min(...m.startScout.mock.invocationCallOrder));
    const briefs = m.startScout.mock.calls.map((c) => c[1]);
    expect(briefs.map((b) => b.category)).toEqual(["dinner", "show"]);
    expect(briefs[0]).toMatchObject({ party_size: 3, dietary_tags: ["vegan"], vibe: ["lively"] });
    expect(JSON.stringify(briefs)).not.toMatch(/thai|u1|cents/);
    expect(m.setCreaoRunId).toHaveBeenCalledWith("run-dinner", "cr-dinner", null);
    expect(enqueued("creao_poll")).toHaveLength(2);
    expect(enqueued("creao_timeout")).toHaveLength(2);
    const xray = m.emit.mock.calls.map((c) => c[0]).find((e) => e.type === "xray");
    expect(xray.contexts.map((c: { name: string }) => c.name)).toEqual(["scout_input:dinner", "scout_input:show"]);
  });

  it("falls back to cached options when CREAO refuses, without throwing", async () => {
    m.startScout.mockRejectedValue(new CreaoError(402, "no credits"));
    await expect(startResearch("plan-1")).resolves.toBeUndefined();
    expect(m.upsertOptions).toHaveBeenCalledTimes(2);
    expect(m.finishRun).toHaveBeenCalledWith("run-dinner", "failed");
    expect(enqueued("check_research_ready")).toHaveLength(2);
    expect(enqueued("creao_poll")).toHaveLength(0);
  });

  it("PLANNER_MODE=cached skips CREAO and polls again in 2 s", async () => {
    env.PLANNER_MODE = "cached";
    await startResearch("plan-1");
    expect(m.startScout).not.toHaveBeenCalled();
    const due = enqueued("creao_poll")[0]![2] as Date;
    expect(due.getTime() - Date.now()).toBeLessThanOrEqual(2_000);
  });

  it("does nothing unless the plan is RESEARCHING", async () => {
    m.getPlan.mockResolvedValue({ ...PLAN, state: "VOTING" });
    await startResearch("plan-1");
    expect(m.insertResearchRun).not.toHaveBeenCalled();
  });

  it("does not POST again for a row that already has a CREAO run", async () => {
    m.insertResearchRun.mockImplementation(async (r) => row({ id: `run-${r.category}`, category: r.category }));
    await startResearch("plan-1");
    expect(m.startScout).not.toHaveBeenCalled();
    expect(enqueued("creao_poll")).toHaveLength(2);
  });
});

describe("reconcile", () => {
  it("ignores terminal rows and rows without a CREAO run", async () => {
    m.getResearchRun.mockResolvedValue(row({ status: "completed" }));
    await reconcile("run-1");
    m.getResearchRun.mockResolvedValue(row({ creao_run_id: null }));
    await reconcile("run-1");
    expect(m.getRun).not.toHaveBeenCalled();
  });

  it("marks a running run and does not finish it", async () => {
    m.getRun.mockResolvedValue({ id: "cr-1", status: "running" });
    await reconcile("run-1");
    expect(m.markRunRunning).toHaveBeenCalledWith("run-1");
    expect(m.finishRun).not.toHaveBeenCalled();
    expect(m.emit).toHaveBeenCalledWith(expect.objectContaining({ type: "creao.run", run_id: "cr-1", status: "running", source: "live" }));
  });

  it("emits creao.run only on the pending → running change, not on every 15 s poll", async () => {
    m.getResearchRun.mockResolvedValue(row({ status: "running" }));
    m.getRun.mockResolvedValue({ id: "cr-1", status: "running" });
    await reconcile("run-1");
    m.getResearchRun.mockResolvedValue(row({ status: "pending" }));
    m.getRun.mockResolvedValue({ id: "cr-1", status: "pending" });
    await reconcile("run-1");
    expect(m.emit).not.toHaveBeenCalled();
    expect(m.finishRun).not.toHaveBeenCalled();
  });

  it("stores sanitized live options from result.text and announces readiness once", async () => {
    m.getRun.mockResolvedValue(completed(fenced({ ...submission, plan_ref: "ignored" })));
    await reconcile("run-1");
    const [planId, runId, options] = m.upsertOptions.mock.calls[0]!;
    expect([planId, runId]).toEqual(["plan-1", "run-1"]);
    expect(options[0].pitch).toBe("Great tacos see");
    expect(m.markRunCached).not.toHaveBeenCalled();
    expect(m.mergeRunResult).toHaveBeenCalledWith("run-1", { creao: expect.objectContaining({ status: "completed" }) });
    expect(m.finishRun).toHaveBeenCalledWith("run-1", "completed");
    expect(enqueued("check_research_ready")[0]).toEqual([
      "check_research_ready", "plan-1:run-1", expect.any(Date), { research_run_id: "run-1" }, { planId: "plan-1" },
    ]);
  });

  it("keeps CLI-submitted options and never overwrites them", async () => {
    m.hasOptionsForRun.mockResolvedValue(true);
    m.getRun.mockResolvedValue(completed("anything"));
    await reconcile("run-1");
    expect(m.upsertOptions).not.toHaveBeenCalled();
    expect(m.repairScoutJson).not.toHaveBeenCalled();
    expect(m.finishRun).toHaveBeenCalledWith("run-1", "completed");
  });

  it("never asks an LLM to invent options: unparseable text goes straight to cached", async () => {
    // The real saved Scout's result.text is a session echo; a forced-schema "repair" fabricated 6 placeholder venues.
    m.getRun.mockResolvedValue({
      id: "cr-1", status: "completed",
      result: { text: JSON.stringify({ plan_ref: REF, category: "dinner", brief: "{}", option_count: "12" }), chatText: "## Dinner options - Marugame Udon" },
    });
    await reconcile("run-1");
    expect(m.repairScoutJson).not.toHaveBeenCalled();
    expect(m.upsertOptions).toHaveBeenCalledTimes(1);
    expect(m.markRunCached).toHaveBeenCalledWith("run-1");
    expect(m.finishRun).toHaveBeenCalledWith("run-1", "completed");
  });

  it("uses cached options when the submission is invalid", async () => {
    m.getRun.mockResolvedValue(completed(fenced({ ...submission, options: submission.options.slice(0, 2) })));
    await reconcile("run-1");
    expect(m.repairScoutJson).not.toHaveBeenCalled();
    expect(m.markRunCached).toHaveBeenCalledWith("run-1");
    expect(m.mergeRunResult).toHaveBeenCalledWith("run-1", expect.objectContaining({ cached_from_run_id: expect.any(String) }));
    expect(m.finishRun).toHaveBeenCalledWith("run-1", "completed");
  });

  it("rejects options for the wrong area", async () => {
    const wrongArea = { ...submission, options: submission.options.map((o) => ({ ...o, area: "Elsewhere" })) };
    m.getRun.mockResolvedValue(completed(fenced(wrongArea)));
    await reconcile("run-1");
    expect(m.markRunCached).toHaveBeenCalled();
  });

  it("falls back to cached options for failed runs and records the status", async () => {
    m.getRun.mockResolvedValue({ id: "cr-1", status: "failed", errorCode: "x" });
    await reconcile("run-1");
    expect(m.markRunCached).toHaveBeenCalledWith("run-1");
    expect(m.finishRun).toHaveBeenCalledWith("run-1", "failed");
  });

  it("lets only the finishRun winner announce", async () => {
    m.getRun.mockResolvedValue(completed(fenced(submission)));
    m.finishRun.mockResolvedValue(false);
    await reconcile("run-1");
    expect(enqueued("check_research_ready")).toHaveLength(0);
    expect(m.emit).not.toHaveBeenCalledWith(expect.objectContaining({ status: "completed" }));
  });

  it("routes Concierge rows to the Concierge handlers and never queues a readiness check", async () => {
    m.getResearchRun.mockResolvedValue(row({ kind: "concierge", category: null }));
    m.getRun.mockResolvedValue(completed("x"));
    await reconcile("run-1");
    expect(m.onConciergeCompleted).toHaveBeenCalledOnce();
    expect(m.upsertOptions).not.toHaveBeenCalled();
    expect(enqueued("check_research_ready")).toHaveLength(0);
    m.getRun.mockResolvedValue({ id: "cr-1", status: "failed" });
    await reconcile("run-1");
    expect(m.conciergeFallback).toHaveBeenCalledWith("plan-1");
  });

  it("keeps the live demo's options out of app.options", async () => {
    m.getResearchRun.mockResolvedValue(row({ kind: "scout_live_demo" }));
    m.getRun.mockResolvedValue(completed(fenced(submission)));
    await reconcile("run-1");
    expect(m.upsertOptions).not.toHaveBeenCalled();
    expect(m.mergeRunResult).toHaveBeenCalledWith("run-1", { submission: expect.objectContaining({ category: "dinner" }) });
    expect(enqueued("check_research_ready")).toHaveLength(0);
  });
});

describe("useCached", () => {
  it("is a no-op when the run already has options", async () => {
    m.hasOptionsForRun.mockResolvedValue(true);
    await useCached(row() as never);
    expect(m.upsertOptions).not.toHaveBeenCalled();
    expect(m.markRunCached).not.toHaveBeenCalled();
  });
  it("loads the fixture for the run's plan and tells the console", async () => {
    await useCached(row({ category: "show" }) as never);
    expect(m.upsertOptions).toHaveBeenCalledWith("plan-1", "run-1", expect.any(Array));
    expect(m.emit).toHaveBeenCalledWith(expect.objectContaining({ type: "creao.run", source: "cached" }));
    expect(m.emit).toHaveBeenCalledWith({ type: "system", level: "info", msg: "cached options (show)" });
  });

  // A chat-created plan can be anywhere ("Santa Monica"), but the snapshot is one area. compose() keeps only options in
  // the plan's area, so without re-scoping every chat plan that fell back to cached research ended in T_NO_FIT.
  const CHAT_PLAN = { ...PLAN, area: "Santa Monica", time_start: DEFAULT_START, time_end: DEFAULT_END }; // startByChat defaults
  const cachedForChatPlan = async (): Promise<Option[]> => {
    m.getPlan.mockResolvedValue(CHAT_PLAN);
    await useCached(row({ id: "run-d", category: "dinner" }) as never);
    await useCached(row({ id: "run-s", category: "show" }) as never);
    return (m.upsertOptions.mock.calls as [string, string, ScoutOption[]][]).flatMap(([, runId, opts]) =>
      opts.map((data, i) => ({ id: `${runId}-${i}`, run_id: runId, source: "cached" as const, data, est_high_pp_cents: data.est_high_pp_usd * 100 })),
    );
  };

  it("re-scopes the fixture to the plan's area and keeps every venue", async () => {
    const options = await cachedForChatPlan();
    expect(options.length).toBe((await loadCachedOptions("dinner")).options.length + (await loadCachedOptions("show")).options.length);
    expect(new Set(options.map((o) => o.data.area))).toEqual(new Set(["Santa Monica"]));
  });

  it("a chat-created plan in another area still reaches a full shortlist from the cached fallback", async () => {
    const { EMPTY_PREFERENCES } = await vi.importActual<typeof import("../src/repo/preferences")>("../src/repo/preferences");
    const options = await cachedForChatPlan();
    const constraints = [150, 150, 160, 140].map((usd, i) => ({ user_id: `u${i}`, target_pp_cents: usd * 100, hard_max_pp_cents: null }));
    const bundles = compose(options, CHAT_PLAN);
    const survivors = filter(fitsPrefs(bundles, constraints.map(() => EMPTY_PREFERENCES)), constraints as never);
    expect(bundles.length).toBeGreaterThan(0);
    expect(shortlist(selectForRating(survivors), [], constraints as never)).toHaveLength(SHORTLIST_N);
  });

  // The demo risk this pins: with the old 19:00 default only 2 cached shows started T+90..T+150, so a chat-created plan
  // on cached research hit T_NO_FIT. Typical group budgets ($45+ each, no hard max) must reach a full 3-option ballot.
  it.each([45, 60, 90])("the default chat plan reaches %i-dollar budgets with a full shortlist from the cached snapshot", async (usd) => {
    const { EMPTY_PREFERENCES } = await vi.importActual<typeof import("../src/repo/preferences")>("../src/repo/preferences");
    const options = await cachedForChatPlan();
    const constraints = [0, 1, 2, 3].map((i) => ({ user_id: `u${i}`, target_pp_cents: usd * 100, hard_max_pp_cents: null }));
    const survivors = filter(fitsPrefs(compose(options, CHAT_PLAN), constraints.map(() => EMPTY_PREFERENCES)), constraints as never);
    const picks = shortlist(selectForRating(survivors), [], constraints as never);
    expect(picks).toHaveLength(SHORTLIST_N);
    expect(new Set(picks.map((b) => b.show.id)).size).toBe(SHORTLIST_N);
  });
});

describe("hook, poll and timeout jobs", () => {
  it("reconcileByCreaoRunId ignores unknown runs", async () => {
    m.findRunByCreaoRunId.mockResolvedValue(null);
    await reconcileByCreaoRunId("smoke");
    expect(m.getRun).not.toHaveBeenCalled();
  });

  it("poll queues the next poll before reconciling and survives a CREAO error", async () => {
    m.getRun.mockRejectedValue(new CreaoError(503, "down"));
    await expect(creaoPollJob(job({ research_run_id: "run-1", n: 3 }))).resolves.toBeUndefined();
    expect(enqueued("creao_poll")[0]![1]).toBe("run-1:4");
    expect(m.enqueue.mock.invocationCallOrder[0]!).toBeLessThan(m.getRun.mock.invocationCallOrder[0]!);
  });

  it("poll stops on a terminal row", async () => {
    m.getResearchRun.mockResolvedValue(row({ status: "timed_out" }));
    await creaoPollJob(job({ research_run_id: "run-1", n: 1 }));
    expect(m.enqueue).not.toHaveBeenCalled();
  });

  it("cached-mode poll resolves a run that never had a CREAO id", async () => {
    env.PLANNER_MODE = "cached";
    m.getResearchRun.mockResolvedValue(row({ creao_run_id: null }));
    await creaoPollJob(job({ research_run_id: "run-1", n: 1 }));
    expect(m.markRunCached).toHaveBeenCalled();
    expect(m.finishRun).toHaveBeenCalledWith("run-1", "completed");
    expect(enqueued("check_research_ready")).toHaveLength(1);
  });

  it("timeout cancels, caches and finishes as timed_out", async () => {
    m.getRun.mockResolvedValue({ id: "cr-1", status: "running" });
    await creaoTimeoutJob(job({ research_run_id: "run-1" }));
    expect(m.cancel).toHaveBeenCalledWith("cr-1");
    expect(m.markRunCached).toHaveBeenCalled();
    expect(m.finishRun).toHaveBeenCalledWith("run-1", "timed_out");
    expect(enqueued("check_research_ready")).toHaveLength(1);
  });

  it("timeout still finishes when the last reconcile throws, and leaves a finished run alone", async () => {
    m.getRun.mockRejectedValue(new Error("net"));
    await creaoTimeoutJob(job({ research_run_id: "run-1" }));
    expect(m.finishRun).toHaveBeenCalledWith("run-1", "timed_out");
    vi.clearAllMocks();
    m.getResearchRun.mockResolvedValue(row({ status: "completed" }));
    await creaoTimeoutJob(job({ research_run_id: "run-1" }));
    expect(m.cancel).not.toHaveBeenCalled();
  });

  it("a timed-out Concierge uses its fallback", async () => {
    m.getResearchRun.mockResolvedValue(row({ kind: "concierge", category: null }));
    m.getRun.mockResolvedValue({ id: "cr-1", status: "running" });
    await creaoTimeoutJob(job({ research_run_id: "run-1" }));
    expect(m.conciergeFallback).toHaveBeenCalledWith("plan-1");
  });

  it("check_research_ready calls A only when both categories have options", async () => {
    m.categoriesWithOptions.mockResolvedValue(["dinner"]);
    await checkResearchReadyJob(job({ research_run_id: "run-1" }));
    expect(m.onOptionsReady).not.toHaveBeenCalled();
    m.categoriesWithOptions.mockResolvedValue(["dinner", "show"]);
    await checkResearchReadyJob(job({ research_run_id: "run-1" }));
    expect(m.onOptionsReady).toHaveBeenCalledWith("plan-1");
    expect(await researchReady("plan-1")).toBe(true);
  });
});

describe("cancelResearch", () => {
  it("cancels every open run at CREAO (best effort) and finishes them without a readiness check", async () => {
    m.listRunsForPlan.mockResolvedValue([row(), row({ id: "run-2", creao_run_id: null })]);
    m.cancel.mockRejectedValueOnce(new Error("gone"));
    await cancelResearch("plan-1");
    expect(m.cancel).toHaveBeenCalledTimes(1);
    expect(m.finishRun).toHaveBeenCalledWith("run-1", "cancelled");
    expect(m.finishRun).toHaveBeenCalledWith("run-2", "cancelled");
    expect(enqueued("check_research_ready")).toHaveLength(0);
  });
});
