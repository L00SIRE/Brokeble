import { beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import type { Itinerary } from "@tab/shared";

const m = vi.hoisted(() => ({
  findActiveRun: vi.fn(),
  mergeRunResult: vi.fn(),
  listRunsForPlan: vi.fn(),
  upsertOptions: vi.fn(),
  getPlanByRef: vi.fn(),
  emit: vi.fn(),
  enqueue: vi.fn(),
  deliverItinerary: vi.fn(),
}));
vi.mock("../src/repo/researchRuns", () => ({ findActiveRun: m.findActiveRun, mergeRunResult: m.mergeRunResult, listRunsForPlan: m.listRunsForPlan }));
vi.mock("../src/repo/options", () => ({ upsertOptions: m.upsertOptions }));
vi.mock("../src/repo/plans", () => ({ getPlanByRef: m.getPlanByRef }));
vi.mock("../src/events", () => ({ emit: m.emit }));
vi.mock("../src/dueJobs", async (orig) => ({ ...(await orig<typeof import("../src/dueJobs")>()), enqueue: m.enqueue }));
vi.mock("../src/creao/concierge", () => ({ deliverItinerary: m.deliverItinerary }));
vi.mock("../src/decide/compose", () => ({ normArea: (a: string) => a.toLowerCase().trim().replace(/\s+/g, " ") }));

import { env } from "../src/env";
import {
  BODY_LIMIT_BYTES, MAX_PROGRESS_PER_RUN, TEST_PLAN_REF, mountAgentApi, sanitizeScoutPitch, stripControl, validateSubmission,
} from "../src/agentApi/routes";
import { escapeHtml, mountHostedPages, renderItineraryHtml } from "../src/agentApi/pages";

const TOKEN = "t".repeat(40);
const REF = "11111111-1111-4111-8111-111111111111";
const PLAN = { id: "plan-1", ref: REF, area: "Downtown LA", version: 1 };
const run = (o: object = {}) => ({ id: "run-1", plan_id: "plan-1", kind: "scout", category: "dinner", creao_run_id: "cr-1", ...o });
const active = (o: object = {}) => ({ run: run(o), plan: PLAN });

const app = new Hono();
mountAgentApi(app);
mountHostedPages(app);

const call = (path: string, body?: unknown, o: { token?: string | null; raw?: string } = {}) =>
  app.request(path, {
    method: body === undefined && o.raw === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", ...(o.token === null ? {} : { authorization: `Bearer ${o.token ?? TOKEN}` }) },
    body: o.raw ?? (body === undefined ? undefined : JSON.stringify(body)),
  });

const dinner = (i: number, o: object = {}) => ({
  category: "dinner", name: `Place ${i}`, address: `${i} Main St, Los Angeles, CA`, area: "downtown la", url: "https://example.com/p",
  price_tier: "$25-50", est_low_pp_usd: 20, est_high_pp_usd: 40, price_evidence_url: "https://example.com/menu",
  dietary_fit: [], pitch: "Great tacos", opens: "11:00", closes: "23:00", hours_evidence_url: "https://example.com/hours", ...o,
});
const submission = (o: object = {}, n = 6) => ({ plan_ref: REF, category: "dinner", options: Array.from({ length: n }, (_, i) => dinner(i)), ...o });

const itinerary = (o: Partial<Itinerary> = {}): Itinerary => ({
  plan_ref: REF, title: "Dinner at <Taco> -> Show", date: "2026-10-17",
  stops: [
    { kind: "dinner", name: "Taco <b>Place</b>", address: "1 Main St", time: "18:30", notes: 'Order the "special"' },
    { kind: "show", name: "Comedy & Co", address: "2 Main St", time: "20:30", notes: "" },
  ],
  logistics: { getting_there: "Walk 5 min", parking: "Lot B", doors: "8:00 PM", dress_code: "Casual", know_before: ["ID required <script>"] },
  ics: "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n", notion_url: "https://notion.so/x", ...o,
});

beforeEach(() => {
  vi.clearAllMocks();
  env.TAB_AGENT_TOKEN = TOKEN;
  env.AGENT_API_ALLOW_TEST_REF = false;
  env.PUBLIC_BASE_URL = "https://tab.example";
  m.findActiveRun.mockResolvedValue(active());
  m.enqueue.mockResolvedValue(true);
});

describe("auth", () => {
  it("ping needs the bearer token", async () => {
    expect((await call("/agent/ping")).status).toBe(200);
    expect((await call("/agent/ping", undefined, { token: "wrong" })).status).toBe(401);
    expect((await call("/agent/ping", undefined, { token: null })).status).toBe(401);
  });
  it("is closed when TAB_AGENT_TOKEN is unset", async () => {
    env.TAB_AGENT_TOKEN = undefined;
    expect((await call("/agent/ping", undefined, { token: "" })).status).toBe(401);
  });
  it("every POST route rejects a bad token before touching the db", async () => {
    for (const p of ["progress", "options/validate", "options", "itinerary"]) {
      expect((await call(`/agent/${p}`, {}, { token: "nope" })).status).toBe(401);
    }
    expect(m.findActiveRun).not.toHaveBeenCalled();
  });
  it("rejects bodies over the limit with 413", async () => {
    const res = await call("/agent/progress", { pad: "x".repeat(BODY_LIMIT_BYTES + 10) });
    expect(res.status).toBe(413);
  });
});

describe("progress", () => {
  const body = { plan_ref: REF, run_kind: "scout", category: "dinner", step: "searching\u0007 menus\n" };
  it("emits creao.progress with control characters stripped", async () => {
    const res = await call("/agent/progress", body);
    expect(res.status).toBe(202);
    expect(m.findActiveRun).toHaveBeenCalledWith(REF, ["scout", "scout_live_demo"], "dinner", 20);
    expect(m.emit).toHaveBeenCalledWith({ type: "creao.progress", run_id: "cr-1", kind: "scout", category: "dinner", step: "searching menus" });
  });
  it("403 without an active run, 400 on a bad body", async () => {
    m.findActiveRun.mockResolvedValue(null);
    expect((await call("/agent/progress", body)).status).toBe(403);
    expect((await call("/agent/progress", { ...body, step: "" })).status).toBe(400);
    expect((await call("/agent/progress", { ...body, step: "\u0001\u0002" })).status).toBe(400);
    expect((await call("/agent/progress", undefined, { raw: "not json" })).status).toBe(400);
  });
  it("concierge progress ignores the category and queries concierge runs", async () => {
    m.findActiveRun.mockResolvedValue(active({ kind: "concierge", category: null }));
    await call("/agent/progress", { plan_ref: REF, run_kind: "concierge", category: null, step: "x" });
    expect(m.findActiveRun).toHaveBeenCalledWith(REF, ["concierge"], null, 20);
  });
  it("429s past the per-run cap", async () => {
    m.findActiveRun.mockResolvedValue(active({ id: "run-cap" }));
    for (let i = 0; i < MAX_PROGRESS_PER_RUN; i++) expect((await call("/agent/progress", body)).status).toBe(202);
    expect((await call("/agent/progress", body)).status).toBe(429);
    expect(m.emit).toHaveBeenCalledTimes(MAX_PROGRESS_PER_RUN);
  });
});

describe("test ref", () => {
  const body = { plan_ref: TEST_PLAN_REF, run_kind: "scout", category: "dinner", step: "hi" };
  it("is refused unless AGENT_API_ALLOW_TEST_REF is on", async () => {
    m.findActiveRun.mockResolvedValue(null);
    expect((await call("/agent/progress", body)).status).toBe(403);
  });
  it("succeeds without persisting anything when on", async () => {
    env.AGENT_API_ALLOW_TEST_REF = true;
    expect((await call("/agent/progress", body)).status).toBe(202);
    const res = await call("/agent/options", submission({ plan_ref: TEST_PLAN_REF }));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: true, accepted: 6 });
    const it = await call("/agent/itinerary", itinerary({ plan_ref: TEST_PLAN_REF }));
    expect(it.status).toBe(201);
    expect(m.emit).not.toHaveBeenCalled();
    expect(m.upsertOptions).not.toHaveBeenCalled();
    expect(m.deliverItinerary).not.toHaveBeenCalled();
    expect(m.findActiveRun).not.toHaveBeenCalled();
  });
  it("still validates normally", async () => {
    env.AGENT_API_ALLOW_TEST_REF = true;
    const res = await call("/agent/options/validate", submission({ plan_ref: TEST_PLAN_REF, options: [] }));
    expect(((await res.json()) as { ok: boolean }).ok).toBe(false);
  });
});

describe("validateSubmission", () => {
  const ctx = { planArea: "Downtown LA", runCategory: "dinner" as const };
  it("accepts a good submission and sanitizes pitches", () => {
    const r = validateSubmission(submission({ options: Array.from({ length: 6 }, (_, i) => dinner(i, { pitch: "Tacos https://evil.example/x now" })) }), ctx);
    expect(r.result).toEqual({ ok: true, errors: [] });
    expect(r.submission!.options[0]!.pitch).toBe("Tacos now");
  });
  it("reports zod errors with dotted paths", () => {
    const r = validateSubmission(submission({ options: Array.from({ length: 6 }, (_, i) => dinner(i, i === 3 ? { est_high_pp_usd: 5 } : {})) }), ctx);
    expect(r.result.ok).toBe(false);
    expect(r.result.errors.map((e) => e.path)).toContain("options.3.est_high_pp_usd");
    expect(r.submission).toBeNull();
  });
  it("rejects a wrong area, mixed category, run mismatch, duplicates, non-http urls and url-only pitches", () => {
    const { opens: _o, closes: _c, hours_evidence_url: _h, ...base } = dinner(1);
    const show = { ...base, category: "show", show_start: "20:00", show_end_est: "22:00", showtime_evidence_url: "https://e.com/s" };
    const opts = [
      dinner(0, { area: "Santa Monica" }),
      show,
      dinner(2),
      dinner(2, { name: "PLACE 2" }),
      dinner(4, { url: "ftp://example.com/x" }),
      dinner(5, { pitch: "https://only.example" }),
    ];
    const r = validateSubmission(submission({ options: opts }), { planArea: "Downtown LA", runCategory: "show" });
    const paths = r.result.errors.map((e) => e.path);
    expect(paths).toEqual(expect.arrayContaining(["category", "options.0.area", "options.1.category", "options.3.name", "options.4.url", "options.5.pitch"]));
  });
  it("skips area and run checks when unknown (test ref)", () => {
    const opts = Array.from({ length: 6 }, (_, i) => dinner(i, { area: "Anywhere" }));
    expect(validateSubmission(submission({ options: opts }), { planArea: null, runCategory: null }).result.ok).toBe(true);
  });
});

describe("helpers", () => {
  it("stripControl and sanitizeScoutPitch", () => {
    expect(stripControl("a\u0000b\u007fc\nd")).toBe("abcd");
    expect(sanitizeScoutPitch("Visit www.x.com or http://y.com/a?b=1 today\n!")).toBe("Visit or today !");
    expect(sanitizeScoutPitch("x".repeat(300))).toHaveLength(140);
  });
});

describe("POST /agent/options/validate and /agent/options", () => {
  it("validate returns 200 with the result and requires an active run", async () => {
    const ok = await call("/agent/options/validate", submission());
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ ok: true, errors: [] });
    const bad = await call("/agent/options/validate", submission({ options: [] }));
    expect(bad.status).toBe(200);
    expect(((await bad.json()) as { ok: boolean }).ok).toBe(false);
    m.findActiveRun.mockResolvedValue(null);
    expect((await call("/agent/options/validate", submission())).status).toBe(403);
  });
  it("a malformed plan_ref gets validation errors, not a db lookup", async () => {
    const res = await call("/agent/options/validate", submission({ plan_ref: "nope" }));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { errors: { path: string }[] }).errors[0]!.path).toBe("plan_ref");
    expect(m.findActiveRun).not.toHaveBeenCalled();
  });
  it("invalid submit is 422 and persists nothing", async () => {
    const res = await call("/agent/options", submission({ options: [] }));
    expect(res.status).toBe(422);
    expect(m.upsertOptions).not.toHaveBeenCalled();
    expect((await call("/agent/options", undefined, { raw: "{" })).status).toBe(422);
  });
  it("valid submit upserts options and enqueues check_research_ready", async () => {
    m.upsertOptions.mockResolvedValue(6);
    const res = await call("/agent/options", submission());
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: true, accepted: 6 });
    expect(m.upsertOptions).toHaveBeenCalledWith("plan-1", "run-1", expect.any(Array));
    expect(m.enqueue).toHaveBeenCalledWith("check_research_ready", "plan-1:run-1", expect.any(Date), { research_run_id: "run-1" }, { planId: "plan-1" });
  });
  it("a scout_live_demo run keeps options in the run result only", async () => {
    m.findActiveRun.mockResolvedValue(active({ kind: "scout_live_demo" }));
    const res = await call("/agent/options", submission());
    expect(res.status).toBe(201);
    expect(m.mergeRunResult).toHaveBeenCalledWith("run-1", { submission: expect.objectContaining({ plan_ref: REF }) });
    expect(m.upsertOptions).not.toHaveBeenCalled();
    expect(m.enqueue).not.toHaveBeenCalled();
  });
});

describe("POST /agent/itinerary", () => {
  beforeEach(() => m.findActiveRun.mockResolvedValue(active({ kind: "concierge", category: null })));
  it("delivers a valid itinerary and returns the hosted urls", async () => {
    const res = await call("/agent/itinerary", itinerary());
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: true, itinerary_url: `https://tab.example/p/${REF}/itinerary`, ics_url: `https://tab.example/p/${REF}/plan.ics` });
    expect(m.deliverItinerary).toHaveBeenCalledWith("plan-1", "run-1", expect.objectContaining({ plan_ref: REF }));
    expect(m.findActiveRun).toHaveBeenCalledWith(REF, ["concierge"], null, 20);
  });
  it("422 when the ics has no VEVENT or no END:VCALENDAR, or the schema fails", async () => {
    expect((await call("/agent/itinerary", itinerary({ ics: "BEGIN:VCALENDAR\r\nEND:VCALENDAR" }))).status).toBe(422);
    expect((await call("/agent/itinerary", itinerary({ ics: "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nEND:VEVENT" }))).status).toBe(422);
    expect((await call("/agent/itinerary", { ...itinerary(), title: undefined })).status).toBe(422);
    expect(m.deliverItinerary).not.toHaveBeenCalled();
  });
  it("403 without an active concierge run", async () => {
    m.findActiveRun.mockResolvedValue(null);
    expect((await call("/agent/itinerary", itinerary())).status).toBe(403);
  });
});

describe("hosted pages", () => {
  const stored = (it: Itinerary) => [{ id: "r0", result: null }, { id: "r1", result: { itinerary: it } }];
  it("escapes every field and never allows script", () => {
    const html = renderItineraryHtml(itinerary({ notion_url: "javascript:alert(1)" }));
    expect(html).not.toContain("<b>");
    expect(html).not.toContain("<script>");
    expect(html).toContain("Taco &lt;b&gt;Place&lt;/b&gt;");
    expect(html).toContain("Order the &quot;special&quot;");
    expect(html).not.toContain("javascript:");
    expect(html).toContain('href="plan.ics"');
  });
  it("links Notion only for http(s)", () => {
    expect(renderItineraryHtml(itinerary())).toContain('href="https://notion.so/x"');
  });
  it("escapeHtml covers & < > \" '", () => {
    expect(escapeHtml(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&#39;");
  });
  it("serves the newest itinerary page and the ics with hardened headers", async () => {
    m.getPlanByRef.mockResolvedValue(PLAN);
    m.listRunsForPlan.mockResolvedValue(stored(itinerary()));
    const page = await app.request(`/p/${REF}/itinerary`);
    expect(page.status).toBe(200);
    expect(page.headers.get("content-type")).toContain("text/html");
    expect(page.headers.get("cache-control")).toBe("no-store");
    expect(page.headers.get("x-robots-tag")).toContain("noindex");
    expect(page.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(await page.text()).toContain("Comedy &amp; Co");
    const ics = await app.request(`/p/${REF}/plan.ics`);
    expect(ics.status).toBe(200);
    expect(ics.headers.get("content-type")).toBe("text/calendar; charset=utf-8");
    expect(ics.headers.get("content-disposition")).toBe('attachment; filename="tab-plan.ics"');
    expect(await ics.text()).toContain("BEGIN:VEVENT");
  });
  it("404s for unknown, malformed or itinerary-less refs", async () => {
    m.getPlanByRef.mockResolvedValue(null);
    expect((await app.request(`/p/${REF}/itinerary`)).status).toBe(404);
    expect((await app.request(`/p/not-a-uuid/plan.ics`)).status).toBe(404);
    m.getPlanByRef.mockResolvedValue(PLAN);
    m.listRunsForPlan.mockResolvedValue([{ id: "r0", result: null }]);
    expect((await app.request(`/p/${REF}/itinerary`)).status).toBe(404);
    expect((await app.request(`/p/${REF}/plan.ics`)).status).toBe(404);
  });
});
