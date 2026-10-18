// POST /ops/release-untexted (ux-flow §6, §7.1). The other ops routes are covered by test/ops.test.ts.
import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ releaseUntexted: vi.fn(), releaseAllExceptTeam: vi.fn() }));
vi.mock("../join/seats", () => ({ releaseUntexted: m.releaseUntexted, releaseAllExceptTeam: m.releaseAllExceptTeam }));
vi.mock("./reset", () => ({ replayDemo: vi.fn(), resetDemo: vi.fn(), ReplayError: class extends Error {} }));
vi.mock("../creao/liveDemo", () => ({ startLiveScoutDemo: vi.fn() }));
vi.mock("../venueClient/tapTest", () => ({ runTapTest: vi.fn() }));
vi.mock("../repo/plans", () => ({ latestPlanWithOrder: vi.fn() }));
vi.mock("../ports", () => ({ ports: {} }));

const { env } = await import("../env");
const { mountOps } = await import("./routes");

const KEY = "operator-key-0123456789";
const app = new Hono();
mountOps(app);
const call = (auth?: string) => app.request("/ops/release-untexted", { method: "POST", headers: auth ? { Authorization: auth } : {} });

beforeEach(() => {
  vi.resetAllMocks();
  Object.assign(env, { OPERATOR_KEY: KEY });
});

describe("POST /ops/release-untexted", () => {
  it("releases untexted seats with the 15-minute default and reports the count; never touches texted seats", async () => {
    m.releaseUntexted.mockResolvedValue(3);
    const res = await call(`Bearer ${KEY}`);
    expect([res.status, await res.json()]).toEqual([200, { ok: true, released: 3 }]);
    expect(m.releaseUntexted).toHaveBeenCalledWith();
    expect(m.releaseAllExceptTeam).not.toHaveBeenCalled();
  });

  it("401 without the operator key, 503 when ops are disabled; nothing released", async () => {
    expect((await call()).status).toBe(401);
    expect((await call("Bearer wrong-key-0123456789")).status).toBe(401);
    Object.assign(env, { OPERATOR_KEY: undefined });
    expect((await call(`Bearer ${KEY}`)).status).toBe(503);
    expect(m.releaseUntexted).not.toHaveBeenCalled();
  });
});
