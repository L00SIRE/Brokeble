import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PlanRow, UserRow } from "../repo/types";

const m = vi.hoisted(() => ({
  getPlanByCode: vi.fn(),
  insertPlan: vi.fn(),
  upsertUserByPhone: vi.fn(),
  upsertParticipant: vi.fn(),
  upsert: vi.fn(),
  ensureSeat: vi.fn(),
  emit: vi.fn(),
  enqueue: vi.fn(),
}));

vi.mock("../repo/plans", () => ({ getPlanByCode: m.getPlanByCode, insertPlan: m.insertPlan }));
vi.mock("../repo/users", () => ({ upsertUserByPhone: m.upsertUserByPhone }));
vi.mock("../repo/participants", () => ({ upsertParticipant: m.upsertParticipant }));
vi.mock("../repo/privateConstraints", () => ({ upsert: m.upsert }));
vi.mock("../events", () => ({ emit: m.emit }));
vi.mock("../dueJobs", () => ({ jobs: { enqueue: m.enqueue } }));
// The real module drags in every job handler; the key shapes are pinned by test/skeleton.keys.test.ts.
vi.mock("../jobs/kinds", () => ({ A_JOB_KINDS: { orgJoinStatus: "org_join_status" }, aJobKeys: { orgJoinStatus: (id: string) => `orgjoin:${id}` } }));
vi.mock("../delegates/budget", () => ({
  // Same acceptance rules as delegates/budget.ts (A plan T6), so the route's contract is exercised, not the stub.
  acceptBudget: (p: { target_pp_cents: number; hard_max_pp_cents: number | null; confidence: string }) =>
    p.confidence === "high" &&
    p.target_pp_cents >= 500 &&
    p.target_pp_cents <= 100000 &&
    (p.hard_max_pp_cents === null || (p.hard_max_pp_cents >= p.target_pp_cents && p.hard_max_pp_cents <= 100000)),
}));
vi.mock("./seats", () => {
  class CapacityError extends Error {}
  return { CapacityError, ensureSeat: m.ensureSeat };
});

const { mountJoin } = await import("./routes");
const { CapacityError } = await import("./seats");
const { env } = await import("../env");

const app = new Hono();
mountJoin(app);
let ipN = 0;
const post = (path: string, body: unknown, ip = `10.0.0.${++ipN}`) =>
  app.request(path, { method: "POST", headers: { "content-type": "application/json", "fly-client-ip": ip }, body: JSON.stringify(body) });

const plan = { id: "plan-1", code: "4821", state: "COLLECTING" } as PlanRow;
const user = { id: "user-1", first_name: "Ana", phone_e164: "+14155550111" } as UserRow;
const goodJoin = { code: "4821", phone_e164: "+14155550111", first_name: "Ana", consent: true };

beforeEach(() => {
  vi.resetAllMocks();
  m.getPlanByCode.mockResolvedValue(plan);
  m.upsertUserByPhone.mockResolvedValue(user);
  m.ensureSeat.mockResolvedValue({ assignmentId: "asg_1", assignedPhoneNumber: "+13105550001" });
  m.upsertParticipant.mockResolvedValue({ row: { lane: 2, stage: "INVITED" }, created: true });
  m.enqueue.mockResolvedValue(true);
});

describe("POST /join", () => {
  it("200: returns the seat, the sms deep link and join text; emits lane for a new participant", async () => {
    const res = await post("/join", goodJoin);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      assigned_number: "+13105550001",
      sms_href: "sms:+13105550001&body=JOIN%204821",
      join_text: "JOIN 4821",
    });
    expect(m.emit).toHaveBeenCalledWith({ type: "lane", plan_id: "plan-1", lane: 2, first_name: "Ana", stage: "INVITED", amount_cents: null, cybs_id_short: null });
    expect(m.upsert).not.toHaveBeenCalled();
  });

  it("does not re-emit lane when the participant already existed", async () => {
    m.upsertParticipant.mockResolvedValue({ row: { lane: 2, stage: "JOINED" }, created: false });
    expect((await post("/join", goodJoin)).status).toBe(200);
    expect(m.emit).not.toHaveBeenCalled();
  });

  it("stores a form budget as cents with source 'form', confidence 'high'", async () => {
    const res = await post("/join", { ...goodJoin, budget_usd: { target: 45.5, hard_max: 60 } });
    expect(res.status).toBe(200);
    expect(m.upsert).toHaveBeenCalledWith({ plan_id: "plan-1", user_id: "user-1", target_pp_cents: 4550, hard_max_pp_cents: 6000, source: "form", confidence: "high" });
  });

  it("allows a target with no hard max (null)", async () => {
    await post("/join", { ...goodJoin, budget_usd: { target: 40 } });
    expect(m.upsert).toHaveBeenCalledWith(expect.objectContaining({ target_pp_cents: 4000, hard_max_pp_cents: null }));
  });

  it("404 not_found for an unknown code", async () => {
    m.getPlanByCode.mockResolvedValue(null);
    const res = await post("/join", goodJoin);
    expect([res.status, await res.json()]).toEqual([404, { error: "not_found" }]);
    expect(m.upsertUserByPhone).not.toHaveBeenCalled();
  });

  it.each(["ORDERING", "APPROVING", "CONFIRMED", "CANCELLED", "SHOWCASE"])("409 plan_closed in %s", async (state) => {
    m.getPlanByCode.mockResolvedValue({ ...plan, state });
    const res = await post("/join", goodJoin);
    expect([res.status, await res.json()]).toEqual([409, { error: "plan_closed" }]);
  });

  it.each(["RESEARCHING", "VOTING"])("joins in %s", async (state) => {
    m.getPlanByCode.mockResolvedValue({ ...plan, state });
    expect((await post("/join", goodJoin)).status).toBe(200);
  });

  it("422 invalid with issues for a bad E.164, missing consent, a short code and unknown keys", async () => {
    for (const bad of [{ ...goodJoin, phone_e164: "415-555-0111" }, { ...goodJoin, consent: false }, { ...goodJoin, code: "12" }, { ...goodJoin, extra: 1 }]) {
      const res = await post("/join", bad);
      const body = (await res.json()) as { error: string; issues: unknown[] };
      expect([res.status, body.error]).toEqual([422, "invalid"]);
      expect(body.issues.length).toBeGreaterThan(0);
    }
    expect(m.getPlanByCode).not.toHaveBeenCalled();
  });

  it("422 invalid for non-JSON bodies", async () => {
    const res = await app.request("/join", { method: "POST", body: "nope", headers: { "fly-client-ip": "9.9.9.9" } });
    expect(res.status).toBe(422);
  });

  it("422 for an out-of-range budget, before any write, without echoing the amount", async () => {
    for (const budget_usd of [{ target: 2 }, { target: 50, hard_max: 40 }]) {
      const res = await post("/join", { ...goodJoin, budget_usd });
      expect(res.status).toBe(422);
      expect(await res.json()).toEqual({ error: "invalid", issues: [{ path: "budget_usd", message: "budget out of range" }] });
    }
    expect(m.upsertUserByPhone).not.toHaveBeenCalled();
    expect(m.upsert).not.toHaveBeenCalled();
  });

  it("503 capacity when no seat is available, and no participant is created", async () => {
    m.ensureSeat.mockRejectedValue(new CapacityError());
    const res = await post("/join", goodJoin);
    expect([res.status, await res.json()]).toEqual([503, { error: "capacity" }]);
    expect(m.upsertParticipant).not.toHaveBeenCalled();
  });

  it("429 rate_limited on the 11th request from one IP; other IPs are unaffected", async () => {
    const results: number[] = [];
    for (let i = 0; i < 11; i++) results.push((await post("/join", goodJoin, "7.7.7.7")).status);
    expect(results).toEqual([...Array(10).fill(200), 429]);
    const limited = await post("/join", goodJoin, "7.7.7.7");
    expect(await limited.json()).toEqual({ error: "rate_limited" });
    expect((await post("/join", goodJoin, "8.8.8.8")).status).toBe(200);
  });
});

describe("POST /plans", () => {
  const body = { title: "Dinner and a show", area: "Santa Monica", date: "2026-10-17", time_start: "18:30", time_end: "22:30", party_target: 4, organizer: { phone_e164: "+14155550111", first_name: "Ana" } };
  const echoPlan = async (p: Record<string, unknown>) => ({ id: "plan-9", ...p });

  it("200: inserts a plan with a 4-digit code, schedules org_join_status and returns the join url + QR svg", async () => {
    m.insertPlan.mockImplementation(echoPlan);
    const res = await post("/plans", body);
    expect(res.status).toBe(200);
    const out = (await res.json()) as { code: string; join_url: string; qr_svg: string };
    expect(out.code).toMatch(/^\d{4}$/);
    expect(out.code).not.toBe(env.DEMO_CODE);
    expect(out.join_url).toBe(`${new URL(env.WEB_ORIGIN).origin}/j/${out.code}`);
    expect(out.qr_svg).toContain("<svg");
    expect(m.insertPlan).toHaveBeenCalledWith(expect.objectContaining({ title: "Dinner and a show", event_date: "2026-10-17", organizer_id: "user-1", party_target: 4 }));
    expect(m.enqueue).toHaveBeenCalledWith("org_join_status", "orgjoin:plan-9", expect.any(Date), {}, { planId: "plan-9" });
  });

  it("retries code collisions (23505) then succeeds; gives up after 10", async () => {
    const dup = Object.assign(new Error("dup"), { code: "23505" });
    m.insertPlan.mockRejectedValueOnce(dup).mockRejectedValueOnce(dup).mockImplementation(echoPlan);
    expect((await post("/plans", body)).status).toBe(200);
    expect(m.insertPlan).toHaveBeenCalledTimes(3);

    m.insertPlan.mockReset().mockRejectedValue(dup);
    expect((await post("/plans", body)).status).toBe(500);
    expect(m.insertPlan).toHaveBeenCalledTimes(10);
  });

  it("still returns the plan when the org_join_status enqueue fails", async () => {
    m.insertPlan.mockImplementation(echoPlan);
    m.enqueue.mockRejectedValue(new Error("db down"));
    expect((await post("/plans", body)).status).toBe(200);
  });

  it("422 for party_target outside 2..8, a bad organizer phone, or a bad time", async () => {
    for (const bad of [{ ...body, party_target: 9 }, { ...body, party_target: 1 }, { ...body, organizer: { ...body.organizer, phone_e164: "123" } }, { ...body, time_start: "6pm" }]) {
      expect((await post("/plans", bad)).status).toBe(422);
    }
    expect(m.insertPlan).not.toHaveBeenCalled();
  });

  it("429 on the 6th request from one IP", async () => {
    m.insertPlan.mockImplementation(echoPlan);
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) codes.push((await post("/plans", body, "6.6.6.6")).status);
    expect(codes).toEqual([200, 200, 200, 200, 200, 429]);
  });
});
