import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { env } from "../src/env";
import { hookDeps, mountCreaoHook } from "../src/creao/hook";

const SECRET = "h".repeat(32);
const orig = { ...hookDeps };
let seen: Set<string>;
let reconciled: string[];

function app() {
  const a = new Hono();
  mountCreaoHook(a);
  return a;
}
const post = (path: string, body: string, headers: Record<string, string> = {}) =>
  app().request(path, { method: "POST", body, headers: { "content-type": "application/json", ...headers } });

beforeEach(() => {
  (env as { CREAO_HOOK_SECRET?: string }).CREAO_HOOK_SECRET = SECRET;
  seen = new Set();
  reconciled = [];
  hookDeps.dedupe = async (id) => (seen.has(id) ? false : (seen.add(id), true));
  hookDeps.schedule = (f) => f();
  hookDeps.reconcile = async (id) => void reconciled.push(id);
});
afterEach(() => {
  Object.assign(hookDeps, orig);
  (env as { CREAO_HOOK_SECRET?: string }).CREAO_HOOK_SECRET = undefined;
});

describe("POST /creao/hook/:secret", () => {
  it("404s on a wrong or unset secret without touching the dedupe store", async () => {
    const dedupe = vi.fn(hookDeps.dedupe);
    hookDeps.dedupe = dedupe;
    expect((await post("/creao/hook/wrong", JSON.stringify({ runId: "r1" }))).status).toBe(404);
    (env as { CREAO_HOOK_SECRET?: string }).CREAO_HOOK_SECRET = undefined;
    expect((await post(`/creao/hook/${SECRET}`, JSON.stringify({ runId: "r1" }))).status).toBe(404);
    expect(dedupe).not.toHaveBeenCalled();
  });

  it("acks and reconciles a fresh delivery once, deduping on X-Creao-Delivery-Id across retries", async () => {
    const h = { "x-creao-delivery-id": "6a1b2c3d-0000-4000-8000-000000000001" };
    const body = JSON.stringify({ runId: "run_1", status: "completed", result: { text: "ignored" } });
    for (let i = 0; i < 3; i++) {
      const res = await post(`/creao/hook/${SECRET}`, body, h);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
    }
    expect(reconciled).toEqual(["run_1"]);
    expect([...seen]).toEqual([h["x-creao-delivery-id"]]);
  });

  it("falls back to runId as the dedupe key", async () => {
    await post(`/creao/hook/${SECRET}`, JSON.stringify({ runId: "run_2" }));
    await post(`/creao/hook/${SECRET}`, JSON.stringify({ runId: "run_2" }));
    expect(reconciled).toEqual(["run_2"]);
    expect([...seen]).toEqual(["run_2"]);
  });

  it("acks malformed bodies and missing/invalid runIds without reconciling", async () => {
    for (const b of ["not json", "null", "{}", JSON.stringify({ runId: 42 }), JSON.stringify({ runId: "a b/../c" })]) {
      expect((await post(`/creao/hook/${SECRET}`, b)).status).toBe(200);
    }
    expect(reconciled).toEqual([]);
  });

  it("still reconciles when the dedupe store fails, and swallows reconcile errors", async () => {
    hookDeps.dedupe = async () => {
      throw new Error("db down");
    };
    hookDeps.reconcile = vi.fn(async () => {
      throw new Error("boom");
    });
    const res = await post(`/creao/hook/${SECRET}`, JSON.stringify({ runId: "run_3" }));
    expect(res.status).toBe(200);
    await Promise.resolve();
    expect(hookDeps.reconcile).toHaveBeenCalledWith("run_3");
  });

  it("responds before reconcile runs (scheduled, not awaited)", async () => {
    const queued: (() => void)[] = [];
    hookDeps.schedule = (f) => void queued.push(f);
    expect((await post(`/creao/hook/${SECRET}`, JSON.stringify({ runId: "run_4" }))).status).toBe(200);
    expect(reconciled).toEqual([]);
    queued.forEach((f) => f());
    expect(reconciled).toEqual(["run_4"]);
  });
});
