import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Bundle, Itinerary } from "@tab/shared";

const m = vi.hoisted(() => ({
  getPlan: vi.fn(), getBundle: vi.fn(), listMembers: vi.fn(),
  insertResearchRun: vi.fn(), setCreaoRunId: vi.fn(), finishRun: vi.fn(), getResearchRun: vi.fn(), listRunsForPlan: vi.fn(), mergeRunResult: vi.fn(),
  startConcierge: vi.fn(), downloadArtifact: vi.fn(),
  enqueue: vi.fn(), emit: vi.fn(), notify: vi.fn(), createNotionPage: vi.fn(),
}));
vi.mock("../src/repo/plans", () => ({ getPlan: m.getPlan }));
vi.mock("../src/repo/bundles", () => ({ getBundle: m.getBundle }));
vi.mock("../src/repo/participants", () => ({ listMembers: m.listMembers }));
vi.mock("../src/repo/researchRuns", () => ({
  insertResearchRun: m.insertResearchRun, setCreaoRunId: m.setCreaoRunId, finishRun: m.finishRun,
  getResearchRun: m.getResearchRun, listRunsForPlan: m.listRunsForPlan, mergeRunResult: m.mergeRunResult,
}));
vi.mock("../src/ports", () => ({ ports: { planner: { startConcierge: m.startConcierge, downloadArtifact: m.downloadArtifact } } }));
vi.mock("../src/dueJobs", async (orig) => ({ ...(await orig<typeof import("../src/dueJobs")>()), enqueue: m.enqueue }));
vi.mock("../src/events", () => ({ emit: m.emit }));
vi.mock("../src/notify/notify", () => ({
  notify: m.notify,
  tplKey: (p: string, u: string, t: string, v: number) => `tpl:${p}:${u}:${t}:${v}`,
}));
vi.mock("../src/creao/notionFallback", () => ({ createNotionPage: m.createNotionPage }));
vi.mock("../src/creao/research", () => ({}));

import { bookedStopErrors, buildConciergeInput, conciergeFallback, deliverItinerary, onConciergeCompleted, startConciergeFor } from "../src/creao/concierge";
import { env } from "../src/env";

const REF = "11111111-1111-4111-8111-111111111111";
const plan = { id: "p1", ref: REF, area: "Westwood", event_date: "2026-10-17", version: 3, chosen_bundle_id: "bnd_1" };
const opt = (name: string, address: string, pitch: string) => ({ data: { name, address, pitch } });
const bundle = {
  id: "bnd_1", dinner: opt("Pho Place", "1 Main St, LA", "Great pho"), show: opt("Comedy Night", "2 Sunset Blvd, LA", "Laughs"),
  dinner_time: "18:30", show_start: "20:30",
} as unknown as Bundle;
const members = [{ user_id: "u1" }, { user_id: "u2" }, { user_id: "u3" }];
const base = (env.PUBLIC_BASE_URL ?? `http://localhost:${env.PORT}`).replace(/\/+$/, "");

beforeEach(() => {
  vi.resetAllMocks();
  m.getPlan.mockResolvedValue(plan);
  m.getBundle.mockResolvedValue(bundle);
  m.listMembers.mockResolvedValue(members);
  m.insertResearchRun.mockResolvedValue({ id: "r1", plan_id: "p1", status: "pending", creao_run_id: null });
  m.startConcierge.mockResolvedValue({ runId: "cr1" });
  m.emit.mockResolvedValue(1);
  m.notify.mockResolvedValue("sent");
  m.createNotionPage.mockResolvedValue(null);
  m.listRunsForPlan.mockResolvedValue([{ id: "r1", result: null }]);
  m.finishRun.mockResolvedValue(true);
});

describe("buildConciergeInput", () => {
  it("carries only the chosen bundle and counts, no person data", () => {
    expect(buildConciergeInput(plan as never, bundle, 3)).toEqual({
      plan_ref: REF,
      itinerary: {
        date: "2026-10-17", area: "Westwood", party_size: 3,
        dinner: { name: "Pho Place", address: "1 Main St, LA", time: "18:30" },
        show: { name: "Comedy Night", address: "2 Sunset Blvd, LA", time: "20:30" },
      },
    });
  });
});

describe("startConciergeFor", () => {
  it("records the run, starts CREAO, and schedules poll + 10 min timeout", async () => {
    await startConciergeFor("p1");
    expect(m.getBundle).toHaveBeenCalledWith("p1", 3, "bnd_1");
    expect(m.insertResearchRun).toHaveBeenCalledWith(
      expect.objectContaining({ plan_id: "p1", kind: "concierge", category: null, idempotency_key: `concierge-${REF}-a1` }),
    );
    expect(m.startConcierge).toHaveBeenCalledWith(expect.objectContaining({ plan_ref: REF }));
    expect(m.setCreaoRunId).toHaveBeenCalledWith("r1", "cr1", null);
    expect(m.enqueue.mock.calls.map((c) => [c[0], c[1]])).toEqual([["creao_poll", "r1:1"], ["creao_timeout", "r1"]]);
    expect((m.enqueue.mock.calls[1]![2] as Date).getTime() - Date.now()).toBeGreaterThan(9 * 60_000);
  });
  it("never starts a second run (cap 1 per plan), but re-arms the jobs of a started, unfinished one", async () => {
    const startedAt = new Date(Date.now() - 60_000);
    m.insertResearchRun.mockResolvedValue({ id: "r1", status: "running", creao_run_id: "cr1", started_at: startedAt });
    await startConciergeFor("p1");
    expect(m.startConcierge).not.toHaveBeenCalled();
    expect(m.enqueue.mock.calls.map((c) => [c[0], c[1]])).toEqual([["creao_poll", "r1:1"], ["creao_timeout", "r1"]]);
    expect((m.enqueue.mock.calls[1]![2] as Date).getTime()).toBe(startedAt.getTime() + 10 * 60_000);
  });
  it("is a no-op for a finished run", async () => {
    m.insertResearchRun.mockResolvedValue({ id: "r1", status: "completed", creao_run_id: "cr1", started_at: new Date() });
    await startConciergeFor("p1");
    m.insertResearchRun.mockResolvedValue({ id: "r1", status: "failed", creao_run_id: null, started_at: new Date() });
    await startConciergeFor("p1");
    expect(m.startConcierge).not.toHaveBeenCalled();
    expect(m.enqueue).not.toHaveBeenCalled();
  });
  it("falls back to code when CREAO fails, tells the console, and never throws", async () => {
    m.startConcierge.mockRejectedValue(new Error("402"));
    await expect(startConciergeFor("p1")).resolves.toBeUndefined();
    expect(m.finishRun).toHaveBeenCalledWith("r1", "failed");
    expect(m.mergeRunResult).toHaveBeenCalledWith("r1", { itinerary: expect.objectContaining({ plan_ref: REF }) });
    expect(m.enqueue).not.toHaveBeenCalled();
    expect(m.emit).toHaveBeenCalledWith({
      type: "creao.run", run_id: "r1", kind: "concierge", category: null, status: "failed", elapsed_ms: 0, source: "cached", share_url: null,
    });
  });
  it("does nothing without a chosen bundle", async () => {
    m.getBundle.mockResolvedValue(null);
    await startConciergeFor("p1");
    expect(m.insertResearchRun).not.toHaveBeenCalled();
  });
});

describe("conciergeFallback", () => {
  it("builds a schema-valid itinerary with ICS and the Notion url, then notifies everyone", async () => {
    m.createNotionPage.mockResolvedValue("https://www.notion.so/abc");
    await conciergeFallback("p1");
    const it = (m.mergeRunResult.mock.calls[0]![1] as { itinerary: Itinerary }).itinerary;
    expect(it.title).toBe("Dinner at Pho Place → Show at Comedy Night");
    expect(it.notion_url).toBe("https://www.notion.so/abc");
    expect(it.stops.map((s) => s.time)).toEqual(["18:30", "20:30"]);
    expect(it.ics).toContain("DTSTART:20261018T013000Z");
    expect(m.notify).toHaveBeenCalledTimes(3);
  });
  it("never overwrites a CLI-submitted itinerary", async () => {
    m.listRunsForPlan.mockResolvedValue([{ id: "r1", result: { itinerary: {} } }]);
    await conciergeFallback("p1");
    expect(m.mergeRunResult).not.toHaveBeenCalled();
    expect(m.notify).not.toHaveBeenCalled();
  });
});

describe("deliverItinerary", () => {
  it("stores the itinerary, then notifies each participant keyed by plan version", async () => {
    const it = { plan_ref: REF } as Itinerary;
    await deliverItinerary("p1", "r1", it);
    expect(m.mergeRunResult).toHaveBeenCalledWith("r1", { itinerary: it });
    expect(m.mergeRunResult.mock.invocationCallOrder[0]).toBeLessThan(m.notify.mock.invocationCallOrder[0]!);
    expect(m.notify).toHaveBeenCalledWith(
      "u2", "T_ITINERARY",
      { itinerary_url: `${base}/p/${REF}/itinerary`, ics_url: `${base}/p/${REF}/plan.ics` },
      { planId: "p1", key: "tpl:p1:u2:T_ITINERARY:3" },
    );
  });
  it("keeps notifying the rest when one notify fails", async () => {
    m.notify.mockRejectedValueOnce(new Error("db"));
    await deliverItinerary("p1", "r1", { plan_ref: REF } as Itinerary);
    expect(m.notify).toHaveBeenCalledTimes(3);
  });
});

describe("onConciergeCompleted", () => {
  const row = { id: "r1", plan_id: "p1" } as never;
  const good = (): Itinerary => ({
    plan_ref: REF, title: "T", date: "2026-10-17",
    stops: [
      { kind: "dinner", name: "Pho Place", address: "1 Main St, LA", time: "18:30", notes: "" },
      { kind: "show", name: "Comedy Night", address: "2 Sunset Blvd, LA", time: "20:30", notes: "" },
    ],
    logistics: { getting_there: "a", parking: "b", doors: "c", dress_code: "d", know_before: [] },
    ics: "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n", notion_url: null,
  });
  const enc = (v: unknown) => new TextEncoder().encode(typeof v === "string" ? v : JSON.stringify(v));
  const run = { id: "cr1", status: "completed", result: { artifacts: [{ id: "a1", title: "itinerary.json", type: "json", url: "https://x.test/a" }] } } as never;

  it("does nothing when the CLI already delivered", async () => {
    m.getResearchRun.mockResolvedValue({ id: "r1", result: { itinerary: good() } });
    await onConciergeCompleted(row, run);
    expect(m.downloadArtifact).not.toHaveBeenCalled();
    expect(m.mergeRunResult).not.toHaveBeenCalled();
  });
  it("delivers a valid itinerary.json artifact", async () => {
    m.getResearchRun.mockResolvedValue({ id: "r1", result: null });
    m.downloadArtifact.mockResolvedValue(enc(good()));
    await onConciergeCompleted(row, run);
    expect(m.downloadArtifact).toHaveBeenCalledWith("cr1", "a1");
    expect(m.mergeRunResult).toHaveBeenCalledWith("r1", { itinerary: good() });
  });
  it("finds the artifact by file name when its title is a display name", async () => {
    m.getResearchRun.mockResolvedValue({ id: "r1", result: null });
    m.downloadArtifact.mockResolvedValue(enc(good()));
    const titled = { id: "cr1", status: "completed", result: { artifacts: [{ id: "ws/t/files/itinerary.json", title: "Pho + Comedy (party of 3)", type: "application/json", url: "" }] } };
    await onConciergeCompleted(row, titled as never);
    expect(m.downloadArtifact).toHaveBeenCalledWith("cr1", "ws/t/files/itinerary.json");
    expect(m.mergeRunResult).toHaveBeenCalledWith("r1", { itinerary: good() });
  });
  it.each([
    ["substituted venues", { ...good(), stops: [{ kind: "dinner", name: "Shamshiri Grill", address: "x st", time: "18:30", notes: "" }, { kind: "show", name: "Geffen Playhouse", address: "y st", time: "20:15", notes: "" }] }],
    ["invalid JSON", "nope"],
    ["another plan's itinerary", { ...good(), plan_ref: "22222222-2222-4222-8222-222222222222" }],
    ["a schema violation", { ...good(), title: 5 }],
  ])("uses the code fallback for %s", async (_n, payload) => {
    m.getResearchRun.mockResolvedValue({ id: "r1", result: null });
    m.downloadArtifact.mockResolvedValue(enc(payload));
    await onConciergeCompleted(row, run);
    const it = (m.mergeRunResult.mock.calls[0]![1] as { itinerary: Itinerary }).itinerary;
    expect(it.logistics.getting_there).toBe("See each venue's website for directions.");
  });
  it("uses the code fallback when there is no artifact", async () => {
    m.getResearchRun.mockResolvedValue({ id: "r1", result: null });
    await onConciergeCompleted(row, { id: "cr1", status: "completed" } as never);
    expect(m.downloadArtifact).not.toHaveBeenCalled();
    expect(m.mergeRunResult).toHaveBeenCalledTimes(1);
  });
});

describe("bookedStopErrors", () => {
  const stop = (kind: "dinner" | "show", name: string, time: string) => ({ kind, name, address: "1 Main St", time, notes: "" });
  it("accepts the booked venues, tolerating case, punctuation and a branch suffix", () => {
    expect(bookedStopErrors({ stops: [stop("dinner", "PHO PLACE", "18:15"), stop("show", "Comedy Night — Main Room", "20:30")] }, bundle)).toEqual([]);
    expect(bookedStopErrors({ stops: [stop("dinner", "Pho Place", "18:30"), stop("show", "comedy night", "20:30")] }, bundle)).toEqual([]);
  });
  it("rejects substituted venues, a missing kind and a moved show start", () => {
    expect(bookedStopErrors({ stops: [stop("dinner", "Shamshiri Grill", "18:30"), stop("show", "Comedy Night", "20:30")] }, bundle).map((e) => e.path)).toEqual(["stops.0.name"]);
    expect(bookedStopErrors({ stops: [stop("dinner", "Pho Place", "18:30")] }, bundle).map((e) => e.path)).toEqual(["stops"]);
    expect(bookedStopErrors({ stops: [stop("dinner", "Pho Place", "18:30"), stop("show", "Comedy Night", "20:15")] }, bundle).map((e) => e.path)).toEqual(["stops.1.time"]);
    expect(bookedStopErrors({ stops: [stop("dinner", "Pho", "18:30"), stop("show", "Comedy Night", "20:30")] }, bundle).map((e) => e.path)).toEqual(["stops.0.name"]);
  });
});
