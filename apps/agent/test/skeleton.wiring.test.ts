// Interface-skeleton guard: registerA/registerB mount every route and due_jobs kind from the A/B plans, with no
// collisions, so builders implement handlers without touching the register files.
import { describe, expect, it, vi } from "vitest";
import { createApp, type Register } from "../src/app";
import type { Jobs } from "../src/dueJobs";
import { registerA } from "../src/plan/register";
import { registerB } from "../src/agentApi/register";
import { A_JOB_KINDS } from "../src/jobs/kinds";
import { B_JOB_KINDS } from "../src/creao/jobs";

const routeList = (app: ReturnType<typeof createApp>) => app.routes.filter((r) => r.method !== "ALL").map((r) => `${r.method} ${r.path}`);
const fakeJobs = (): Jobs => ({ register: vi.fn(), enqueue: vi.fn(async () => true) });
const FOUNDATION = new Set(routeList(createApp({ registers: [], jobs: fakeJobs() })));

/** The routes and kinds one register function adds on top of the foundation app. */
function build(register: Register) {
  const jobs = fakeJobs();
  const app = createApp({ registers: [register], jobs });
  const routes = routeList(app).filter((r) => !FOUNDATION.has(r));
  const kinds = vi.mocked(jobs.register).mock.calls.map(([kind]) => kind);
  return { app, routes, kinds };
}

const A_ROUTES = [
  "POST /join",
  "POST /plans",
  "POST /venue/hook",
  "POST /ops/reset",
  "POST /ops/replay",
  "POST /ops/tap-test",
  "POST /ops/live-scout",
  "POST /ops/release-seats",
];
const B_ROUTES = [
  "GET /agent/ping",
  "POST /agent/progress",
  "POST /agent/options/validate",
  "POST /agent/options",
  "POST /agent/itinerary",
  "POST /creao/hook/:secret",
  "GET /p/:planRef/itinerary",
  "GET /p/:planRef/plan.ics",
];

describe("registerA", () => {
  it("mounts every A route and the dev simulator (mock mode)", () => {
    const { routes } = build(registerA);
    expect(routes).toEqual(expect.arrayContaining([...A_ROUTES, "POST /dev/inbound"]));
  });

  it("registers exactly A's due_jobs kinds", () => {
    expect(build(registerA).kinds.sort()).toEqual(Object.values(A_JOB_KINDS).sort());
  });

  it("A routes are mounted (not 404) without any handler being implemented first", async () => {
    const { app } = build(registerA);
    for (const r of A_ROUTES) {
      const [method, path] = r.split(" ") as [string, string];
      expect((await app.request(path, { method })).status, r).not.toBe(404);
    }
  });
});

describe("registerB", () => {
  it("mounts every B route; voice stays unmounted unless VOICE_ENABLED", () => {
    const { routes } = build(registerB);
    expect(routes).toEqual(expect.arrayContaining(B_ROUTES));
    expect(routes).not.toContain("POST /voice/hook");
  });

  it("registers exactly B's due_jobs kinds (voice_nudge only when VOICE_ENABLED)", () => {
    expect(build(registerB).kinds.sort()).toEqual(Object.values(B_JOB_KINDS).sort());
  });
});

describe("A + B together", () => {
  it("no route or due_jobs kind is claimed twice", () => {
    const a = build(registerA);
    const b = build(registerB);
    const routes = [...a.routes, ...b.routes];
    const kinds = [...a.kinds, ...b.kinds];
    expect(new Set(routes).size).toBe(routes.length);
    expect(new Set(kinds).size).toBe(kinds.length);
  });
});
