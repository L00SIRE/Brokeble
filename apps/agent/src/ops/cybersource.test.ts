// GET /ops/cybersource: operator-gated pass-through of the venue's live Cybersource lookup for the latest order.
import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ latestPlanWithOrder: vi.fn(), fetchCybsLookup: vi.fn() }));
vi.mock("../join/seats", () => ({ releaseUntexted: vi.fn(), releaseAllExceptTeam: vi.fn() }));
vi.mock("./reset", () => ({ replayDemo: vi.fn(), resetDemo: vi.fn(), ReplayError: class extends Error {} }));
vi.mock("../creao/liveDemo", () => ({ startLiveScoutDemo: vi.fn() }));
vi.mock("../venueClient/tapTest", () => ({ runTapTest: vi.fn() }));
vi.mock("../venueClient/cybsLookup", () => ({ fetchCybsLookup: m.fetchCybsLookup }));
vi.mock("../repo/plans", () => ({ latestPlanWithOrder: m.latestPlanWithOrder }));
vi.mock("../ports", () => ({ ports: {} }));

const { env } = await import("../env");
const { mountOps } = await import("./routes");

const KEY = "operator-key-0123456789";
const app = new Hono();
mountOps(app);
const call = (auth?: string) => app.request("/ops/cybersource", { headers: auth ? { Authorization: auth } : {} });

beforeEach(() => {
  vi.resetAllMocks();
  Object.assign(env, { OPERATOR_KEY: KEY, VENUE_MODE: "live" });
});

describe("GET /ops/cybersource", () => {
  it("401 without the operator key and never calls the venue", async () => {
    expect((await call()).status).toBe(401);
    expect((await call("Bearer wrong-key-0123456789")).status).toBe(401);
    expect(m.fetchCybsLookup).not.toHaveBeenCalled();
  });
  it("passes the venue lookup through for the latest order", async () => {
    m.latestPlanWithOrder.mockResolvedValue({ venue_order_id: "ord_abcdefghij" });
    m.fetchCybsLookup.mockResolvedValue({ order_id: "ord_abcdefghij", fetched_at: "t", source: { id: "testrest", label: "x" }, environment: "apitest.cybersource.com", rows: [] });
    const res = await call(`Bearer ${KEY}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, available: true, order_id: "ord_abcdefghij" });
    expect(m.fetchCybsLookup).toHaveBeenCalledWith("ord_abcdefghij");
  });
  it("degrades (200, available:false) with no order, a simulated venue, or a venue failure", async () => {
    m.latestPlanWithOrder.mockResolvedValue(null);
    expect(await (await call(`Bearer ${KEY}`)).json()).toEqual({ ok: true, available: false, reason: "no_order" });
    m.latestPlanWithOrder.mockResolvedValue({ venue_order_id: "ord_abcdefghij" });
    m.fetchCybsLookup.mockRejectedValue(new Error("venue down"));
    expect(await (await call(`Bearer ${KEY}`)).json()).toEqual({ ok: true, available: false, reason: "venue_unreachable" });
    Object.assign(env, { VENUE_MODE: "mock" });
    expect(await (await call(`Bearer ${KEY}`)).json()).toEqual({ ok: true, available: false, reason: "venue_simulated" });
  });
});
