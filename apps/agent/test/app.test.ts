import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { createApp, OWNER_REGISTERS, type Register } from "../src/app";
import { registerA } from "../src/plan/register";
import { registerB } from "../src/agentApi/register";
import { registerC } from "../src/venueClient/register";
import { jobKeys, type Jobs } from "../src/dueJobs";
import { env } from "../src/env";

const fakeJobs = (): Jobs => ({ register: vi.fn(), enqueue: vi.fn(async () => true) });

const preflight = (app: Hono, path: string, headers = "authorization,content-type") =>
  app.request(path, {
    method: "OPTIONS",
    headers: { Origin: env.WEB_ORIGIN, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": headers },
  });

describe("createApp: owner register functions", () => {
  it("wires exactly registerA, registerB, registerC, in that order", () => {
    expect(OWNER_REGISTERS).toEqual([registerA, registerB, registerC]);
  });

  it("calls each register once with the app and the jobs facade; owner routes and kinds land on the app", async () => {
    const jobs = fakeJobs();
    const seen: unknown[] = [];
    const ownerRoutes: Register = (app, j) => {
      seen.push(j);
      app.get("/owner/ping", (c) => c.json({ ok: true }));
      j.register("owner_kind", async () => {});
    };
    const app = createApp({ registers: [ownerRoutes], jobs });
    expect(seen).toEqual([jobs]);
    expect(jobs.register).toHaveBeenCalledWith("owner_kind", expect.any(Function));
    expect(await (await app.request("/owner/ping")).json()).toEqual({ ok: true });
  });

  it("default registers boot in mock mode: healthz, events and the dev simulator (mounted by registerA) respond", async () => {
    const app = createApp({ jobs: fakeJobs() });
    expect((await app.request("/healthz")).status).toBe(200);
    expect((await app.request("/events/snapshot")).status).toBe(401); // console key required
    const bad = await app.request("/dev/inbound", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect(bad.status).toBe(400); // mounted, and validates its body
  });

  it("an unknown route is a plain 404, and a throwing handler is a 500 with no detail", async () => {
    const boom: Register = (app) => app.get("/boom", () => { throw new Error("secret detail"); });
    const app = createApp({ registers: [boom], jobs: fakeJobs() });
    expect((await app.request("/nope")).status).toBe(404);
    const res = await app.request("/boom");
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain("secret detail");
  });
});

describe("CORS (PLAN §11, standard-names Endpoints)", () => {
  const app = createApp({ registers: [], jobs: fakeJobs() });

  it("/ops/* preflight allows POST with Authorization and Content-Type from WEB_ORIGIN only", async () => {
    const res = await preflight(app, "/ops/reset");
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe(env.WEB_ORIGIN);
    expect(res.headers.get("access-control-allow-methods")).toBe("GET,POST");
    expect(res.headers.get("access-control-allow-headers")).toBe("Authorization,Content-Type");

    const evil = await app.request("/ops/reset", {
      method: "OPTIONS",
      headers: { Origin: "https://evil.example", "Access-Control-Request-Method": "POST" },
    });
    expect(evil.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("browser routes (/join, /plans, /events, /events/snapshot) allow GET and POST from WEB_ORIGIN", async () => {
    for (const path of ["/join", "/plans", "/events", "/events/snapshot"]) {
      const res = await preflight(app, path, "content-type");
      expect(res.status, path).toBe(204);
      expect(res.headers.get("access-control-allow-origin"), path).toBe(env.WEB_ORIGIN);
      expect(res.headers.get("access-control-allow-methods"), path).toBe("GET,POST");
    }
  });

  it("server-to-server routes get no CORS headers", async () => {
    for (const path of ["/agent/ping", "/venue/hook", "/creao/hook/x"]) {
      const res = await preflight(app, path);
      expect(res.headers.get("access-control-allow-origin"), path).toBeNull();
    }
  });
});

describe("jobKeys (cross-owner due_jobs dedupe keys)", () => {
  const planId = "3f1c2b8e-6a0d-4c1f-9e2a-7b5d4c3a2f10";
  it("match standard-names exactly", () => {
    expect(jobKeys.recomputeOptions(planId)).toBe(`recompute:${planId}:options`);
    expect(jobKeys.voiceNudge(planId, 2)).toBe(`voice:${planId}:2`);
    expect(jobKeys.checkResearchReady(planId, "rr_1")).toBe(`${planId}:rr_1`);
  });
});
