import { describe, expect, it, vi } from "vitest";
import type { ConciergeInput, ResearchBrief } from "@tab/shared";
import { CREAO_BASE, CreaoError, CreaoPlanner, webhookUrlFor, type CreaoConfig } from "../src/creao/client";

const REF = "3f1c2b8e-6a0d-4c1f-9e2a-7b5d4c3a2f10";
const KEY = "capi_test_not_a_secret";
const CFG: CreaoConfig = {
  apiKey: KEY,
  scoutAppId: "app_scout",
  conciergeAppId: "app_conc",
  publicBaseUrl: "https://tab-agent.fly.dev/",
  hookSecret: "s".repeat(32),
};
const BRIEF: ResearchBrief = {
  category: "dinner",
  area: "Westwood",
  date: "2026-10-17",
  time_window: { start: "18:30", end: "23:00" },
  party_size: 4,
  dietary_tags: ["vegetarian"],
  vibe: ["lively"],
  price_tiers: ["<$25", "$25-50", "$50+"],
  count_per_tier: 4,
};

type Call = { url: string; init: RequestInit };
function fakeFetch(...responses: (Response | Error)[]) {
  const calls: Call[] = [];
  const f = vi.fn(async (url: string | URL | Request, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    const r = responses.shift();
    if (!r) throw new Error("unexpected fetch");
    if (r instanceof Error) throw r;
    return r;
  });
  return { f: f as unknown as typeof fetch, calls };
}
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const hdr = (c: Call, k: string) => new Headers(c.init.headers).get(k);

describe("webhookUrlFor", () => {
  it("builds the public hook URL and omits it for private/missing bases", () => {
    expect(webhookUrlFor("https://tab-agent.fly.dev/", "abc")).toBe("https://tab-agent.fly.dev/creao/hook/abc");
    expect(webhookUrlFor("http://localhost:8080", "abc")).toBeUndefined();
    expect(webhookUrlFor("http://192.168.1.4:8080", "abc")).toBeUndefined();
    expect(webhookUrlFor(undefined, "abc")).toBeUndefined();
    expect(webhookUrlFor("https://x.dev", undefined)).toBeUndefined();
  });
});

describe("CreaoPlanner", () => {
  it("startScout POSTs /runs with appId, P6 inputs, webhook and idempotency key", async () => {
    const { f, calls } = fakeFetch(json(202, { id: "run_1", status: "pending", appId: "app_scout", appName: "Tab Scout" }));
    const r = await new CreaoPlanner({ fetch: f, config: CFG }).startScout(REF, BRIEF, 1);
    expect(r).toEqual({ runId: "run_1" });
    expect(calls[0]!.url).toBe(`${CREAO_BASE}/runs`);
    expect(calls[0]!.init.method).toBe("POST");
    expect(hdr(calls[0]!, "authorization")).toBe(`Bearer ${KEY}`);
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({
      appId: "app_scout",
      inputs: { plan_ref: REF, category: "dinner", brief: JSON.stringify(BRIEF) },
      webhookUrl: `https://tab-agent.fly.dev/creao/hook/${"s".repeat(32)}`,
      idempotencyKey: `scout-${REF}-dinner-a1`,
    });
  });

  it("startScout rejects a brief with extra fields before any network call (P6)", async () => {
    const { f, calls } = fakeFetch();
    const bad = { ...BRIEF, budget: 4000 } as unknown as ResearchBrief;
    await expect(new CreaoPlanner({ fetch: f, config: CFG }).startScout(REF, bad, 1)).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  it("retries a 5xx/network start once with the same idempotency key; never retries 4xx", async () => {
    const a = fakeFetch(json(503, { error: "UNAVAILABLE" }), json(202, { id: "run_2" }));
    expect(await new CreaoPlanner({ fetch: a.f, config: CFG }).startScout(REF, BRIEF, 2)).toEqual({ runId: "run_2" });
    expect(a.calls.map((c) => JSON.parse(c.init.body as string).idempotencyKey)).toEqual([`scout-${REF}-dinner-a2`, `scout-${REF}-dinner-a2`]);

    const n = fakeFetch(new TypeError("fetch failed"), json(202, { id: "run_3" }));
    expect(await new CreaoPlanner({ fetch: n.f, config: CFG }).startScout(REF, BRIEF, 1)).toEqual({ runId: "run_3" });

    const p = fakeFetch(json(402, { error: "INSUFFICIENT_CREDITS" }));
    const err = await new CreaoPlanner({ fetch: p.f, config: CFG }).startScout(REF, BRIEF, 1).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CreaoError);
    expect((err as CreaoError).status).toBe(402);
    expect((err as CreaoError).detail).toContain("INSUFFICIENT_CREDITS");
    expect(p.calls).toHaveLength(1);
  });

  it("startConcierge uses the concierge app, itinerary input and key", async () => {
    const input: ConciergeInput = {
      plan_ref: REF,
      itinerary: {
        date: "2026-10-17",
        area: "Westwood",
        party_size: 4,
        dinner: { name: "Sushi", address: "1 Main St", time: "18:30" },
        show: { name: "Comedy", address: "2 Main St", time: "21:00" },
      },
    };
    const { f, calls } = fakeFetch(json(202, { id: "run_c" }));
    expect(await new CreaoPlanner({ fetch: f, config: CFG }).startConcierge(input)).toEqual({ runId: "run_c" });
    const body = JSON.parse(calls[0]!.init.body as string);
    expect(body.appId).toBe("app_conc");
    expect(body.inputs).toEqual({ plan_ref: REF, itinerary: JSON.stringify(input.itinerary) });
    expect(body.idempotencyKey).toBe(`concierge-${REF}-a1`);
  });

  it("omits webhookUrl without a public base and fails clearly without config", async () => {
    const { f, calls } = fakeFetch(json(202, { id: "r" }));
    await new CreaoPlanner({ fetch: f, config: { ...CFG, publicBaseUrl: "http://localhost:8080" } }).startScout(REF, BRIEF, 1);
    expect(JSON.parse(calls[0]!.init.body as string)).not.toHaveProperty("webhookUrl");
    await expect(new CreaoPlanner({ fetch: f, config: { ...CFG, apiKey: undefined } }).startScout(REF, BRIEF, 1)).rejects.toBeInstanceOf(CreaoError);
    await expect(new CreaoPlanner({ fetch: f, config: { ...CFG, scoutAppId: undefined } }).startScout(REF, BRIEF, 1)).rejects.toBeInstanceOf(CreaoError);
  });

  it("getRun parses a completed run, normalizes id, and reads an unknown shape as running", async () => {
    const run = { runId: "run/1", status: "completed", threadId: "t1", result: { text: "```json{}```", artifacts: [] }, extra: 1 };
    const { f, calls } = fakeFetch(json(200, run), json(200, { status: "weird" }));
    const pl = new CreaoPlanner({ fetch: f, config: CFG });
    const got = await pl.getRun("run/1");
    expect(calls[0]!.url).toBe(`${CREAO_BASE}/runs/run%2F1`);
    expect(calls[0]!.init.method).toBe("GET");
    expect(got).toMatchObject({ id: "run/1", status: "completed", threadId: "t1", result: { text: "```json{}```" } });
    expect(await pl.getRun("run_x")).toEqual({ id: "run_x", status: "running" });
  });

  it("getRun surfaces HTTP errors as CreaoError", async () => {
    const { f } = fakeFetch(json(404, { error: "RUN_NOT_FOUND" }));
    await expect(new CreaoPlanner({ fetch: f, config: CFG }).getRun("nope")).rejects.toMatchObject({ status: 404 });
  });

  it("cancel POSTs and tolerates an empty body", async () => {
    const { f, calls } = fakeFetch(new Response(null, { status: 200 }));
    await new CreaoPlanner({ fetch: f, config: CFG }).cancel("run_1");
    expect(calls[0]!.url).toBe(`${CREAO_BASE}/runs/run_1/cancel`);
    expect(calls[0]!.init.method).toBe("POST");
  });

  it("downloadArtifact follows the redirect manually and never forwards the key", async () => {
    const redirect = new Response(null, { status: 302, headers: { location: "https://storage.example/obj?sig=1" } });
    const { f, calls } = fakeFetch(redirect, new Response(new Uint8Array([1, 2, 3]), { status: 200 }));
    const bytes = await new CreaoPlanner({ fetch: f, config: CFG }).downloadArtifact("run_1", "art/1 x");
    expect(Array.from(bytes)).toEqual([1, 2, 3]);
    expect(calls[0]!.url).toBe(`${CREAO_BASE}/runs/run_1/artifacts/download?artifactId=art%2F1%20x`);
    expect(calls[0]!.init.redirect).toBe("manual");
    expect(hdr(calls[0]!, "authorization")).toBe(`Bearer ${KEY}`);
    expect(calls[1]!.url).toBe("https://storage.example/obj?sig=1");
    expect(calls[1]!.init.headers).toBeUndefined();
  });

  it("downloadArtifact rejects non-redirects and non-https targets", async () => {
    const a = fakeFetch(json(404, { error: "ARTIFACT_NOT_FOUND" }));
    await expect(new CreaoPlanner({ fetch: a.f, config: CFG }).downloadArtifact("r", "a")).rejects.toMatchObject({ status: 404 });
    const b = fakeFetch(new Response(null, { status: 307, headers: { location: "http://insecure.example/x" } }));
    await expect(new CreaoPlanner({ fetch: b.f, config: CFG }).downloadArtifact("r", "a")).rejects.toBeInstanceOf(CreaoError);
  });
});
