import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "../src/env";

const m = vi.hoisted(() => {
  const fn = vi.fn;
  return {
    plans: { listActivePlans: fn(), renameCode: fn(), insertPlan: fn(), getPlan: fn(), latestPlanWithOrder: fn() },
    participants: { upsertParticipant: fn(), listMembers: fn() },
    users: { upsertUserByPhone: fn(), findUserByPhone: fn() },
    dmRoutes: { getDmRoute: fn() },
    privateConstraints: { upsert: fn() },
    preferences: { upsertPreferences: fn() },
    researchRuns: { insertResearchRun: fn() },
    options: { upsertOptions: fn() },
    transition: fn(),
    setStage: fn(),
    enqueue: fn(),
    emit: fn(),
    cancelVenue: fn(),
    cancelResearch: fn(),
    clearAwaiting: fn(),
    route: fn(),
    runTapTest: fn(),
    startLiveScoutDemo: fn(),
    releaseAllExceptTeam: fn(),
  };
});

vi.mock("../src/repo/plans", () => ({ ...m.plans, ACTIVE_STATES: ["COLLECTING", "RESEARCHING"] }));
vi.mock("../src/repo/participants", () => m.participants);
vi.mock("../src/repo/users", () => m.users);
vi.mock("../src/repo/dmRoutes", () => m.dmRoutes);
vi.mock("../src/repo/privateConstraints", () => m.privateConstraints);
vi.mock("../src/repo/preferences", () => m.preferences);
vi.mock("../src/repo/researchRuns", () => m.researchRuns);
vi.mock("../src/repo/options", () => m.options);
vi.mock("../src/plan/machine", () => ({ transition: m.transition }));
vi.mock("../src/plan/membership", () => ({ setStage: m.setStage }));
vi.mock("../src/jobs/kinds", () => ({ A_JOB_KINDS: { recompute: "recompute" }, aJobKeys: { recompute: (p: string, t: string) => `recompute:${p}:${t}` } }));
vi.mock("../src/dueJobs", () => ({ enqueue: m.enqueue }));
vi.mock("../src/events", () => ({ emit: m.emit }));
vi.mock("../src/ports", () => ({ ports: { venue: { cancel: m.cancelVenue } } }));
vi.mock("../src/creao/research", () => ({ cancelResearch: m.cancelResearch }));
vi.mock("../src/delegates/awaiting", () => ({ clearAwaiting: m.clearAwaiting }));
vi.mock("../src/router/route", () => ({ route: m.route }));
vi.mock("../src/venueClient/tapTest", () => ({ runTapTest: m.runTapTest }));
vi.mock("../src/creao/liveDemo", () => ({ startLiveScoutDemo: m.startLiveScoutDemo }));
vi.mock("../src/join/seats", () => ({ releaseAllExceptTeam: m.releaseAllExceptTeam }));

const { laToday, seedDemo } = await import("../src/ops/seed");
const { replayDemo, ReplayError, resetDemo } = await import("../src/ops/reset");
const { mountOps } = await import("../src/ops/routes");

const TEAM = [
  { phone_e164: "+13105550101", first_name: "Ana" },
  { phone_e164: "+13105550102", first_name: "Ben" },
  { phone_e164: "+13105550103", first_name: "Cy" },
  { phone_e164: "+13105550104", first_name: "Di" },
];
const uniqueViolation = Object.assign(new Error("duplicate key"), { code: "23505" });
const plan = (o: Record<string, unknown> = {}) => ({ id: "plan-1", ref: "ref-1", code: "4821", state: "RESEARCHING", venue_order_id: null, ...o });

beforeEach(() => {
  vi.resetAllMocks();
  Object.assign(env, { DEMO_TEAM: TEAM, DEMO_CODE: "4821", OPERATOR_KEY: "operator-key-0123456789", MESSAGING_MODE: "mock" });
  m.users.upsertUserByPhone.mockImplementation(async (u: { first_name: string }) => ({ id: `user-${u.first_name}` }));
  m.plans.insertPlan.mockResolvedValue(plan({ id: "plan-new", ref: "ref-new", state: "COLLECTING" }));
  m.researchRuns.insertResearchRun.mockImplementation(async (r: { category: string }) => ({ id: `run-${r.category}` }));
  m.transition.mockResolvedValue({ id: "plan-new", version: 1, from_state: "COLLECTING" });
  m.plans.listActivePlans.mockResolvedValue([]);
  m.participants.listMembers.mockResolvedValue([]);
  m.emit.mockResolvedValue(1);
  m.cancelVenue.mockResolvedValue({});
  m.cancelResearch.mockResolvedValue(undefined);
});

describe("laToday", () => {
  it("is the LA calendar date, not the UTC one", () => {
    expect(laToday(new Date("2026-10-18T02:00:00Z"))).toBe("2026-10-17");
    expect(laToday(new Date("2026-10-17T20:00:00Z"))).toBe("2026-10-17");
  });
});

describe("seedDemo", () => {
  it("seeds the plan, one member per fixture lane, cached runs and the recompute job", async () => {
    const r = await seedDemo();
    expect(r).toEqual({ planId: "plan-new", planRef: "ref-new", code: "4821" });

    expect(m.plans.insertPlan).toHaveBeenCalledWith(expect.objectContaining({ code: "4821", organizer_id: "user-Ana", title: "Dinner + show", party_target: 4 }));
    expect(m.users.upsertUserByPhone).toHaveBeenCalledTimes(3); // 3 seeded lanes; the 4th team phone stays free to join live
    expect(m.participants.upsertParticipant.mock.calls.map((c) => c[1])).toEqual(["user-Ana", "user-Ben", "user-Cy"]);
    expect(m.privateConstraints.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ plan_id: "plan-new", user_id: "user-Ana", target_pp_cents: 4500, hard_max_pp_cents: 6000, source: "form", confidence: "high" }),
    );
    expect(m.setStage.mock.calls.map((c) => c.slice(1))).toEqual([["user-Ana", "PREFS_DONE"], ["user-Ben", "PREFS_DONE"], ["user-Cy", "PREFS_DONE"]]);

    expect(m.researchRuns.insertResearchRun.mock.calls.map((c) => c[0].idempotency_key)).toEqual(["seed:plan-new:dinner", "seed:plan-new:show"]);
    expect(m.researchRuns.insertResearchRun.mock.calls[0]![0]).toMatchObject({ kind: "scout", status: "completed", source: "cached" });
    expect(m.researchRuns.insertResearchRun.mock.calls[0]![0]).not.toHaveProperty("creao_run_id");
    expect(m.options.upsertOptions).toHaveBeenCalledWith("plan-new", "run-dinner", expect.any(Array));
    expect(m.options.upsertOptions.mock.calls[0]![2].length).toBeGreaterThanOrEqual(6);

    expect(m.transition).toHaveBeenCalledWith("plan-new", "COLLECTING", "RESEARCHING");
    expect(m.enqueue).toHaveBeenCalledWith("recompute", "recompute:plan-new:seed", expect.any(Date), {}, { planId: "plan-new" });
  });

  it("needs a team, and explains a taken code", async () => {
    Object.assign(env, { DEMO_TEAM: [] });
    await expect(seedDemo()).rejects.toThrow(/DEMO_TEAM/);
    Object.assign(env, { DEMO_TEAM: TEAM });
    m.plans.insertPlan.mockRejectedValue(uniqueViolation);
    await expect(seedDemo()).rejects.toThrow(/run reset first/);
  });
});

describe("resetDemo", () => {
  it("reverses holds, cancels silently, frees the code, reseeds and announces", async () => {
    m.plans.listActivePlans.mockResolvedValue([plan({ id: "old-1", venue_order_id: "ord-1" }), plan({ id: "old-2" })]);
    m.participants.listMembers.mockResolvedValue([{ user_id: "u1" }]);

    expect(await resetDemo()).toEqual({ ok: true, plan_id: "plan-new" });

    expect(m.cancelVenue).toHaveBeenCalledOnce();
    expect(m.cancelVenue).toHaveBeenCalledWith("ord-1", "reset");
    expect(m.transition).toHaveBeenCalledWith("old-1", ["COLLECTING", "RESEARCHING"], "CANCELLED");
    expect(m.transition).toHaveBeenCalledWith("old-2", ["COLLECTING", "RESEARCHING"], "CANCELLED");
    expect(m.cancelResearch).toHaveBeenCalledWith("old-1");
    expect(m.clearAwaiting).toHaveBeenCalledWith("u1");
    expect(m.plans.renameCode).toHaveBeenCalledWith("4821", expect.stringMatching(/^R[0-9a-f]{3}$/));
    expect(m.plans.renameCode.mock.invocationCallOrder[0]).toBeLessThan(m.plans.insertPlan.mock.invocationCallOrder[0]!);
    expect(m.emit).toHaveBeenLastCalledWith({ type: "system", level: "info", msg: "reset" });
  });

  it("still resets when the venue or CREAO cancel fails, and says so", async () => {
    m.plans.listActivePlans.mockResolvedValue([plan({ venue_order_id: "ord-1" })]);
    m.cancelVenue.mockRejectedValue(new Error("venue down"));
    m.cancelResearch.mockRejectedValue(new Error("creao down"));
    await expect(resetDemo()).resolves.toMatchObject({ ok: true });
    const warns = m.emit.mock.calls.filter(([e]) => e.level === "warn").map(([e]) => e.msg);
    expect(warns).toEqual(["reset: venue cancel failed", "reset: research cancel failed"]);
    expect(m.transition).toHaveBeenCalledWith("plan-1", expect.anything(), "CANCELLED");
  });

  it("retries a spare-code collision and shares one run between concurrent calls", async () => {
    m.plans.renameCode.mockRejectedValueOnce(uniqueViolation).mockResolvedValue(true);
    const [a, b] = await Promise.all([resetDemo(), resetDemo()]);
    expect(a).toBe(b);
    expect(m.plans.renameCode).toHaveBeenCalledTimes(2);
    expect(m.plans.insertPlan).toHaveBeenCalledOnce();
    await resetDemo(); // a later reset runs again
    expect(m.plans.insertPlan).toHaveBeenCalledTimes(2);
  });

  it("fails loudly when no spare code can be found, without wedging later resets", async () => {
    m.plans.renameCode.mockRejectedValue(uniqueViolation);
    await expect(resetDemo()).rejects.toThrow(/join code/);
    m.plans.renameCode.mockResolvedValue(true);
    await expect(resetDemo()).resolves.toMatchObject({ ok: true });
  });
});

describe("replayDemo", () => {
  const fast = { pauseMs: 0, pollMs: 1, readyTimeoutMs: 50 };

  it("waits for VOTING, then routes each scripted text as that team member", async () => {
    m.plans.getPlan.mockResolvedValueOnce(plan({ state: "RESEARCHING" })).mockResolvedValue(plan({ state: "VOTING" }));
    m.users.findUserByPhone.mockImplementation(async (phone: string) => ({ id: `u-${phone}`, photon_user_id: phone === TEAM[0]!.phone_e164 ? "pho_usr_ana" : null }));
    m.dmRoutes.getDmRoute.mockImplementation(async (id: string) => (id.endsWith("0101") ? { userId: id, spaceId: "spc_ana", agentUserId: "agent_1" } : null));

    expect(await replayDemo(fast)).toEqual({ ok: true, steps: 2 });

    expect(m.plans.getPlan).toHaveBeenCalledTimes(2);
    const events = m.route.mock.calls.map(([e]) => e);
    expect(events.map((e) => e.text)).toEqual(["1 2", "2"]);
    expect(events.map((e) => e.from_handle)).toEqual(TEAM.slice(0, 2).map((t) => t.phone_e164));
    expect(events[0]).toMatchObject({ event_id: "replay:plan-new:0", message_id: "replay_msg:plan-new:0", from_user_id: "pho_usr_ana", space_id: "spc_ana", agent_user_id: "agent_1" });
    expect(new Set(events.map((e) => e.event_id)).size).toBe(2);
  });

  it("a scripted lane with no DEMO_TEAM member fails BEFORE resetting, so the live plan is never retired", async () => {
    Object.assign(env, { DEMO_TEAM: TEAM.slice(0, 1) });
    m.plans.listActivePlans.mockResolvedValue([plan({ state: "VOTING" })]);
    await expect(replayDemo(fast)).rejects.toThrow(/script lane 2 has no DEMO_TEAM member/);
    expect(m.plans.listActivePlans).not.toHaveBeenCalled();
    expect(m.transition).not.toHaveBeenCalled();
    expect(m.plans.insertPlan).not.toHaveBeenCalled();
  });

  it("aborts when the plan never reaches VOTING", async () => {
    m.plans.getPlan.mockResolvedValue(plan({ state: "CANCELLED" }));
    await expect(replayDemo(fast)).rejects.toThrow(ReplayError);
    m.plans.getPlan.mockResolvedValue(plan({ state: "RESEARCHING" }));
    await expect(replayDemo(fast)).rejects.toThrow(/not VOTING/);
    expect(m.route).not.toHaveBeenCalled();
  });

  it("in photon mode requires every scripted lane to have texted the agent first", async () => {
    Object.assign(env, { MESSAGING_MODE: "photon" });
    m.users.findUserByPhone.mockResolvedValue({ id: "u", photon_user_id: null });
    m.dmRoutes.getDmRoute.mockResolvedValue(null);
    await expect(replayDemo(fast)).rejects.toThrow(/has not texted/);
    expect(m.route).not.toHaveBeenCalled();
    expect(m.plans.insertPlan).not.toHaveBeenCalled(); // validated before the reset
  });
});

describe("/ops routes", () => {
  const app = new Hono();
  mountOps(app);
  const call = (path: string, o: { key?: string | null; body?: unknown } = {}) =>
    app.request(path, {
      method: "POST",
      headers: { "content-type": "application/json", ...(o.key === null ? {} : { authorization: `Bearer ${o.key ?? env.OPERATOR_KEY}` }) },
      body: o.body === undefined ? undefined : JSON.stringify(o.body),
    });
  const paths = ["/ops/reset", "/ops/replay", "/ops/tap-test", "/ops/live-scout", "/ops/release-seats"];

  it("rejects missing and wrong keys with 401 before doing anything", async () => {
    for (const p of paths) {
      expect((await call(p, { key: null })).status).toBe(401);
      expect((await call(p, { key: "wrong-key-0123456789" })).status).toBe(401);
    }
    expect(m.plans.listActivePlans).not.toHaveBeenCalled();
    expect(m.releaseAllExceptTeam).not.toHaveBeenCalled();
    expect(m.startLiveScoutDemo).not.toHaveBeenCalled();
  });

  it("answers 503 when OPERATOR_KEY is unset", async () => {
    Object.assign(env, { OPERATOR_KEY: undefined });
    for (const p of paths) expect((await call(p, { key: "anything-0123456789" })).status).toBe(503);
  });

  it("POST /ops/reset", async () => {
    const res = await call("/ops/reset");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, plan_id: "plan-new" });
  });

  it("POST /ops/tap-test validates the body, needs an order, and returns the verdict", async () => {
    expect((await call("/ops/tap-test", { body: { kind: "bogus" } })).status).toBe(400);
    expect((await call("/ops/tap-test", { body: { kind: "tamper", extra: 1 } })).status).toBe(400);
    expect((await call("/ops/tap-test")).status).toBe(400);

    m.plans.latestPlanWithOrder.mockResolvedValue(null);
    const none = await call("/ops/tap-test", { body: { kind: "tamper" } });
    expect(none.status).toBe(409);
    expect(await none.json()).toMatchObject({ ok: false });

    m.plans.latestPlanWithOrder.mockResolvedValue(plan({ venue_order_id: "ord-9" }));
    m.runTapTest.mockResolvedValue({ result: "rejected" });
    const ok = await call("/ops/tap-test", { body: { kind: "wrong_tag" } });
    expect(m.runTapTest).toHaveBeenCalledWith("wrong_tag", "ord-9", expect.objectContaining({ cancel: m.cancelVenue }));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ ok: true, result: "rejected" });
    expect(m.cancelVenue).not.toHaveBeenCalled(); // tap tests never cancel the order (PLAN §3.2)
  });

  it("POST /ops/live-scout maps debounce to 429", async () => {
    m.startLiveScoutDemo.mockResolvedValueOnce({ ok: true, research_run_id: "r1" });
    const ok = await call("/ops/live-scout");
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ ok: true, research_run_id: "r1" });
    m.startLiveScoutDemo.mockResolvedValueOnce({ ok: false, reason: "debounced" });
    const slow = await call("/ops/live-scout");
    expect(slow.status).toBe(429);
    expect(await slow.json()).toEqual({ ok: false, reason: "debounced" });
  });

  it("POST /ops/release-seats reports the count", async () => {
    m.releaseAllExceptTeam.mockResolvedValue(7);
    expect(await (await call("/ops/release-seats")).json()).toEqual({ ok: true, released: 7 });
  });

  it("POST /ops/replay maps a not-ready plan to 409", async () => {
    m.plans.getPlan.mockResolvedValue(plan({ state: "CANCELLED" }));
    m.users.findUserByPhone.mockResolvedValue(null);
    m.dmRoutes.getDmRoute.mockResolvedValue(null);
    const res = await call("/ops/replay");
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ ok: false });
  });
});
