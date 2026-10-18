import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  findShowcasePlan: vi.fn(), insertPlan: vi.fn(), insertResearchRun: vi.fn(), latestLiveDemoStartedAt: vi.fn(), listRunsForPlan: vi.fn(), launchScout: vi.fn(),
  emitScoutXray: vi.fn(),
}));
vi.mock("../src/repo/plans", () => ({ findShowcasePlan: m.findShowcasePlan, insertPlan: m.insertPlan }));
vi.mock("../src/repo/researchRuns", () => ({
  insertResearchRun: m.insertResearchRun, latestLiveDemoStartedAt: m.latestLiveDemoStartedAt, listRunsForPlan: m.listRunsForPlan,
}));
vi.mock("../src/ops/seed", () => ({ laToday: () => "2026-10-17" }));
vi.mock("../src/creao/research", () => ({ launchScout: m.launchScout }));
vi.mock("../src/creao/xray", () => ({ emitScoutXray: m.emitScoutXray }));

import { ensureShowcasePlan, LIVE_DEMO_DEBOUNCE_MS, startLiveScoutDemo } from "../src/creao/liveDemo";

const PLAN = { id: "p", ref: "11111111-1111-4111-8111-111111111111", area: "Westwood / Sawtelle", event_date: "2026-01-01", time_start: "18:30", time_end: "23:00", party_target: 4 };
const dup = Object.assign(new Error("dup"), { code: "23505" });

beforeEach(() => {
  vi.resetAllMocks();
  m.findShowcasePlan.mockResolvedValue(PLAN);
  m.latestLiveDemoStartedAt.mockResolvedValue(null);
  m.listRunsForPlan.mockResolvedValue([{}, {}]);
  m.insertResearchRun.mockImplementation(async (r) => ({ id: "run-live", ...r }));
  m.launchScout.mockResolvedValue(undefined);
  m.emitScoutXray.mockResolvedValue(undefined);
});

describe("ensureShowcasePlan", () => {
  it("returns the existing showcase plan", async () => {
    expect(await ensureShowcasePlan()).toBe(PLAN);
    expect(m.insertPlan).not.toHaveBeenCalled();
  });
  it("creates it with an S-prefixed code and retries on a code collision", async () => {
    m.findShowcasePlan.mockResolvedValue(null);
    m.insertPlan.mockRejectedValueOnce(dup).mockImplementationOnce(async (p) => ({ ...PLAN, ...p }));
    const p = await ensureShowcasePlan();
    expect(p.code).toMatch(/^S[0-9a-z]{3}$/);
    expect(m.insertPlan).toHaveBeenCalledWith(expect.objectContaining({ state: "SHOWCASE", organizer_id: null, title: "Live Scout showcase", event_date: "2026-10-17" }));
    expect(m.insertPlan).toHaveBeenCalledTimes(2);
  });
  it("rethrows other database errors", async () => {
    m.findShowcasePlan.mockResolvedValue(null);
    m.insertPlan.mockRejectedValue(new Error("boom"));
    await expect(ensureShowcasePlan()).rejects.toThrow("boom");
  });
});

describe("startLiveScoutDemo", () => {
  it("debounces a second press within 3 minutes", async () => {
    m.latestLiveDemoStartedAt.mockResolvedValue(new Date(Date.now() - LIVE_DEMO_DEBOUNCE_MS + 5_000));
    expect(await startLiveScoutDemo()).toEqual({ ok: false, reason: "debounced" });
    expect(m.insertResearchRun).not.toHaveBeenCalled();
  });

  it("starts a dinner scout_live_demo run with a fresh attempt, today's date and a PII-free brief", async () => {
    m.latestLiveDemoStartedAt.mockResolvedValue(new Date(Date.now() - LIVE_DEMO_DEBOUNCE_MS - 1_000));
    expect(await startLiveScoutDemo()).toEqual({ ok: true, research_run_id: "run-live" });
    expect(m.insertResearchRun).toHaveBeenCalledWith({
      plan_id: "p", kind: "scout_live_demo", category: "dinner", attempt: 3,
      idempotency_key: expect.stringMatching(new RegExp(`^live-${PLAN.ref}-dinner-\\d+$`)),
    });
    const [plan, row, brief] = m.launchScout.mock.calls[0]!;
    expect(plan).toBe(PLAN);
    expect(row.id).toBe("run-live");
    expect(brief).toMatchObject({ category: "dinner", date: "2026-10-17", party_size: 4, dietary_tags: [], vibe: [] });
    expect(m.emitScoutXray).toHaveBeenCalledWith("p", [brief]); // the X-ray shows exactly what CREAO receives
  });

  it("still reports ok when launching or the X-ray throws", async () => {
    m.launchScout.mockRejectedValue(new Error("x"));
    m.emitScoutXray.mockRejectedValue(new Error("y"));
    expect(await startLiveScoutDemo()).toEqual({ ok: true, research_run_id: "run-live" });
  });
});
