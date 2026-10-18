import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PlanRow, UserRow } from "../repo/types";

const m = vi.hoisted(() => ({
  getPlanByCode: vi.fn(),
  getPlan: vi.fn(),
  currentPlanForUser: vi.fn(),
  upsertUserByPhone: vi.fn(),
  findUserByPhone: vi.fn(),
  getUser: vi.fn(),
  lastInboundAt: vi.fn(),
  upsertParticipant: vi.fn(),
  getParticipant: vi.fn(),
  countByStage: vi.fn(),
  getActiveAssignment: vi.fn(),
  upsert: vi.fn(),
  ensureSeat: vi.fn(),
  createPlanRecord: vi.fn(),
  emit: vi.fn(),
}));

vi.mock("../repo/plans", () => ({ getPlanByCode: m.getPlanByCode, getPlan: m.getPlan, currentPlanForUser: m.currentPlanForUser }));
vi.mock("../repo/users", () => ({
  upsertUserByPhone: m.upsertUserByPhone,
  findUserByPhone: m.findUserByPhone,
  getUser: m.getUser,
  lastInboundAt: m.lastInboundAt,
  payerRefSecret: () => "test-payer-ref-secret-0123456789",
}));
vi.mock("../repo/participants", () => ({ upsertParticipant: m.upsertParticipant, getParticipant: m.getParticipant, countByStage: m.countByStage }));
vi.mock("../repo/assignments", () => ({ getActiveAssignment: m.getActiveAssignment }));
vi.mock("../repo/privateConstraints", () => ({ upsert: m.upsert }));
vi.mock("../events", () => ({ emit: m.emit }));
vi.mock("./createPlanRecord", () => ({ createPlanRecord: m.createPlanRecord }));
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
  return { CapacityError, ensureSeat: m.ensureSeat, START_SEAT_SCOPE: "start", joinSeatScope: (id: string) => `join:${id}` };
});

const { mountJoin } = await import("./routes");
const { CapacityError } = await import("./seats");
const { issueStatusToken, verifyStatusToken } = await import("./statusToken");
const { CreatePlanResponse, JoinResponse, PlanPreview, StartResponse, StatusResponse } = await import("./schemas");
const { env } = await import("../env");

const app = new Hono();
mountJoin(app);
let ipN = 0;
const nextIp = () => `10.0.${Math.floor(++ipN / 250)}.${ipN % 250}`;
const post = (path: string, body: unknown, ip = nextIp()) =>
  app.request(path, { method: "POST", headers: { "content-type": "application/json", "fly-client-ip": ip }, body: JSON.stringify(body) });
const get = (path: string, ip = nextIp()) => app.request(path, { headers: { "fly-client-ip": ip } });

const PLAN_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const ORG_ID = "33333333-3333-4333-8333-333333333333";
const origin = new URL(env.WEB_ORIGIN).origin;

const plan = {
  id: PLAN_ID, code: "4821", state: "COLLECTING", title: "Dinner + show", area: "Santa Monica", event_date: "2026-10-24",
  time_start: "19:00", time_end: "23:00", party_target: 4, organizer_id: ORG_ID, created_at: new Date("2026-10-18T10:00:00Z"),
} as PlanRow;
const user = { id: USER_ID, first_name: "", phone_e164: "+14155550111" } as UserRow;
const organizer = { id: ORG_ID, first_name: "Maya", phone_e164: "+14155550100" } as UserRow;
const goodJoin = { code: "4821", phone_e164: "+14155550111", consent: true };

beforeEach(() => {
  vi.resetAllMocks();
  m.getPlanByCode.mockResolvedValue(plan);
  m.getPlan.mockResolvedValue(plan);
  m.upsertUserByPhone.mockResolvedValue(user);
  m.findUserByPhone.mockResolvedValue(null);
  m.getUser.mockImplementation(async (id: string) => (id === ORG_ID ? organizer : id === USER_ID ? user : null));
  m.ensureSeat.mockResolvedValue({ assignmentId: "asg_1", assignedPhoneNumber: "+13105550001" });
  m.upsertParticipant.mockResolvedValue({ row: { lane: 2, stage: "INVITED" }, created: true });
  m.getParticipant.mockResolvedValue(null);
  m.countByStage.mockResolvedValue({ JOINED: 1, INVITED: 1 });
  m.lastInboundAt.mockResolvedValue(null);
  m.getActiveAssignment.mockResolvedValue({ assigned_number: "+13105550001" });
});

describe("POST /start", () => {
  const body = { phone_e164: "+14155550111", consent: true };

  it("200: blank-name upsert, seat scope 'start', a verifiable organizer token with no plan, and the hand-off fields", async () => {
    const res = await post("/start", body);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const out = StartResponse.parse(await res.json());
    expect(m.upsertUserByPhone).toHaveBeenCalledWith({ phone_e164: "+14155550111", first_name: "" });
    expect(m.ensureSeat).toHaveBeenCalledWith(user, "start");
    expect(out.assigned_number).toBe("+13105550001");
    expect(out.sms_body).toBe("Hey SquadTab! Help me plan a night out.");
    expect(out.sms_href).toBe("sms:+13105550001&body=Hey%20SquadTab!%20Help%20me%20plan%20a%20night%20out.");
    expect(verifyStatusToken(out.status_token)).toMatchObject({ u: USER_ID, p: null, r: "organizer" });
    expect(out.handoff_url).toBe(`${origin}/t/${out.status_token}`);
    expect(out.handoff_qr_svg).toContain("<svg");
  });

  it("answers identically (keys and sms_body) for a number already organizing an active plan", async () => {
    const fresh = (await (await post("/start", body)).json()) as Record<string, unknown>;
    m.findUserByPhone.mockResolvedValue(organizer);
    m.upsertUserByPhone.mockResolvedValue(organizer);
    m.currentPlanForUser.mockResolvedValue(plan);
    m.getParticipant.mockResolvedValue({ stage: "PREFS_DONE" });
    const inPlan = (await (await post("/start", { ...body, phone_e164: "+14155550100" })).json()) as Record<string, unknown>;
    expect(Object.keys(inPlan).sort()).toEqual(Object.keys(fresh).sort());
    expect(inPlan.sms_body).toBe(fresh.sms_body);
    StartResponse.parse(inPlan); // strict: no extra keys such as state or plan
    expect(JSON.stringify(inPlan)).not.toMatch(/4821|Santa Monica|Dinner|PREFS_DONE/);
    expect(m.currentPlanForUser).not.toHaveBeenCalled();
  });

  it("503 capacity when no seat is available", async () => {
    m.ensureSeat.mockRejectedValue(new CapacityError());
    const res = await post("/start", body);
    expect([res.status, await res.json()]).toEqual([503, { error: "capacity" }]);
  });

  it("422 without consent, with a bad phone or with unknown keys", async () => {
    for (const bad of [{ phone_e164: "+14155550111" }, { ...body, phone_e164: "310-555-0123" }, { ...body, first_name: "Ana" }]) {
      expect((await post("/start", bad)).status).toBe(422);
    }
    expect(m.upsertUserByPhone).not.toHaveBeenCalled();
  });

  it("422 for any number that is not a 10-digit US number, so junk input never spends a Photon seat", async () => {
    // Too short (z.e164 alone accepts it), area or exchange code starting 0/1, too long, and non-US.
    for (const phone_e164 of ["+1310555", "+10105550123", "+13101550123", "+131055501234", "+447700900123"]) {
      const res = await post("/start", { ...body, phone_e164 });
      expect(res.status).toBe(422);
      expect(((await res.json()) as { issues: { path: string }[] }).issues[0]!.path).toBe("phone_e164");
    }
    for (const phone_e164 of ["+1310555", "+447700900123"]) {
      expect((await post("/join", { ...goodJoin, phone_e164 })).status).toBe(422);
    }
    expect(m.upsertUserByPhone).not.toHaveBeenCalled();
    expect(m.ensureSeat).not.toHaveBeenCalled();
  });

  it("429 on the 6th call per minute from one IP; another IP is unaffected", async () => {
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) codes.push((await post("/start", body, "5.5.5.5")).status);
    expect(codes).toEqual([200, 200, 200, 200, 200, 429]);
    expect((await post("/start", body, "5.5.5.6")).status).toBe(200);
  });
});

describe("POST /join", () => {
  it("200: first_name optional, seat scope join:<planId>, guest token, human sms_body, preview, lane emitted", async () => {
    const res = await post("/join", goodJoin);
    expect(res.status).toBe(200);
    const out = JoinResponse.parse(await res.json());
    expect(m.upsertUserByPhone).toHaveBeenCalledWith({ phone_e164: "+14155550111", first_name: "" });
    expect(m.ensureSeat).toHaveBeenCalledWith(user, `join:${PLAN_ID}`);
    expect(out).toMatchObject({
      assigned_number: "+13105550001",
      sms_body: "I'm in for Dinner + show!",
      join_text: "I'm in for Dinner + show!",
      sms_href: `sms:+13105550001&body=${encodeURIComponent("I'm in for Dinner + show!")}`,
      already_joined: false,
      plan: { code: "4821", title: "Dinner + show", date_label: "Sat, Oct 24", time_label: "7:00 PM", area: "Santa Monica", organizer_first_name: "Maya", joined: 1, party_target: 4, status: "open" },
    });
    expect(verifyStatusToken(out.status_token)).toMatchObject({ u: USER_ID, p: PLAN_ID, r: "guest" });
    expect(out.handoff_url).toBe(`${origin}/t/${out.status_token}`);
    expect(m.emit).toHaveBeenCalledWith({ type: "lane", plan_id: PLAN_ID, lane: 2, first_name: "", stage: "INVITED", amount_cents: null, cybs_id_short: null });
    expect(m.upsert).not.toHaveBeenCalled();
  });

  it("passes a typed first name through (older clients)", async () => {
    await post("/join", { ...goodJoin, first_name: " Ana " });
    expect(m.upsertUserByPhone).toHaveBeenCalledWith({ phone_e164: "+14155550111", first_name: "Ana" });
  });

  it("sms_body falls back to \"I'm in!\" for a title over 40 characters", async () => {
    m.getPlanByCode.mockResolvedValue({ ...plan, title: "x".repeat(41) });
    const out = (await (await post("/join", goodJoin)).json()) as { sms_body: string; join_text: string };
    expect([out.sms_body, out.join_text]).toEqual(["I'm in!", "I'm in!"]);
    m.getPlanByCode.mockResolvedValue({ ...plan, title: "y".repeat(40) });
    expect(((await (await post("/join", goodJoin)).json()) as { sms_body: string }).sms_body).toBe(`I'm in for ${"y".repeat(40)}!`);
  });

  it("already_joined for a participant at JOINED or later; no lane re-emit", async () => {
    m.findUserByPhone.mockResolvedValue(user);
    m.getParticipant.mockResolvedValue({ stage: "JOINED" });
    m.upsertParticipant.mockResolvedValue({ row: { lane: 2, stage: "JOINED" }, created: false });
    const out = (await (await post("/join", goodJoin)).json()) as { already_joined: boolean; sms_body: string };
    expect(out.already_joined).toBe(true);
    expect(out.sms_body).toBe("Hey SquadTab, where are we at?");
    expect(m.emit).not.toHaveBeenCalled();
  });

  it("already_joined is false for a DECLINED participant", async () => {
    m.upsertParticipant.mockResolvedValue({ row: { lane: 2, stage: "DECLINED" }, created: false });
    expect(((await (await post("/join", goodJoin)).json()) as { already_joined: boolean }).already_joined).toBe(false);
  });


  describe("409 in_other_plan (texts route to the most recent active plan, so one live seat at a time)", () => {
    const OTHER_ID = "55555555-5555-4555-8555-555555555555";
    const other = (minutes: number, state = "COLLECTING") =>
      ({ ...plan, id: OTHER_ID, code: "9216", state, created_at: new Date(plan.created_at.getTime() + minutes * 60_000) }) as PlanRow;
    const seatIn = (otherStage: string, thisStage: string | null = null) =>
      m.getParticipant.mockImplementation(async (planId: string) => (planId === OTHER_ID ? { stage: otherStage } : thisStage && { stage: thisStage }));

    beforeEach(() => m.findUserByPhone.mockResolvedValue(user));

    it.each([
      ["JOINED in an older plan", -5, "JOINED"],
      ["PREFS_DONE in a newer plan", 5, "PREFS_DONE"],
      ["INVITED in a newer plan (their join text would land there)", 5, "INVITED"],
    ])("%s → 409 before any write", async (_label, minutes, stage) => {
      m.currentPlanForUser.mockResolvedValue(other(minutes));
      seatIn(stage);
      const res = await post("/join", goodJoin);
      expect([res.status, await res.json()]).toEqual([409, { error: "in_other_plan" }]);
      expect(m.currentPlanForUser).toHaveBeenCalledWith(USER_ID);
      expect(m.upsertUserByPhone).not.toHaveBeenCalled();
      expect(m.ensureSeat).not.toHaveBeenCalled();
      expect(m.upsertParticipant).not.toHaveBeenCalled();
    });

    it("also for an active plan past joining (ORDERING still captures their texts)", async () => {
      m.currentPlanForUser.mockResolvedValue(other(-5, "ORDERING"));
      seatIn("VOTED");
      expect((await post("/join", goodJoin)).status).toBe(409);
    });

    it.each([
      ["DECLINED in the other plan", -5, "DECLINED"],
      ["RELEASED in the other plan", 5, "RELEASED"],
      ["a stale INVITED row in an older plan", -5, "INVITED"],
    ])("%s → 200", async (_label, minutes, stage) => {
      m.currentPlanForUser.mockResolvedValue(other(minutes));
      seatIn(stage);
      expect((await post("/join", goodJoin)).status).toBe(200);
    });

    it("200 when their current plan is this one (re-tapping the same invite)", async () => {
      m.currentPlanForUser.mockResolvedValue(plan);
      m.getParticipant.mockResolvedValue({ stage: "JOINED" });
      m.upsertParticipant.mockResolvedValue({ row: { lane: 2, stage: "JOINED" }, created: false });
      const res = await post("/join", goodJoin);
      expect(res.status).toBe(200);
      expect(((await res.json()) as { already_joined: boolean }).already_joined).toBe(true);
    });

    it("an unknown number is never looked up", async () => {
      m.findUserByPhone.mockResolvedValue(null);
      expect((await post("/join", goodJoin)).status).toBe(200);
      expect(m.currentPlanForUser).not.toHaveBeenCalled();
    });
  });

  it("a full plan still answers 200 to someone already in it", async () => {
    m.countByStage.mockResolvedValue({ PREFS_DONE: 8 });
    m.findUserByPhone.mockResolvedValue(user);
    m.getParticipant.mockResolvedValue({ stage: "PREFS_DONE" });
    m.upsertParticipant.mockResolvedValue({ row: { lane: 3, stage: "PREFS_DONE" }, created: false });
    const res = await post("/join", goodJoin);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { plan: { status: string } }).plan.status).toBe("full");
  });

  it("stores a form budget as cents with source 'form', confidence 'high'", async () => {
    const res = await post("/join", { ...goodJoin, budget_usd: { target: 45.5, hard_max: 60 } });
    expect(res.status).toBe(200);
    expect(m.upsert).toHaveBeenCalledWith({ plan_id: PLAN_ID, user_id: USER_ID, target_pp_cents: 4550, hard_max_pp_cents: 6000, source: "form", confidence: "high" });
  });

  it("allows a target with no hard max (null)", async () => {
    await post("/join", { ...goodJoin, budget_usd: { target: 40 } });
    expect(m.upsert).toHaveBeenCalledWith(expect.objectContaining({ target_pp_cents: 4000, hard_max_pp_cents: null }));
  });

  it("409 plan_full for a 9th confirmed member (the venue caps party_size at 8); no seat, user or row is created", async () => {
    m.countByStage.mockResolvedValue({ JOINED: 2, PREFS_DONE: 4, VOTED: 2, DECLINED: 3, RELEASED: 1 });
    const res = await post("/join", goodJoin);
    expect([res.status, await res.json()]).toEqual([409, { error: "plan_full" }]);
    for (const f of [m.ensureSeat, m.upsertUserByPhone, m.upsertParticipant, m.upsert]) expect(f).not.toHaveBeenCalled();
  });

  it("a full plan still lets an existing member re-submit; declined/released lanes don't count", async () => {
    m.countByStage.mockResolvedValue({ PREFS_DONE: 8 });
    m.findUserByPhone.mockResolvedValue({ ...user, photon_user_id: null });
    m.getParticipant.mockResolvedValue({ lane: 3, stage: "INVITED" });
    expect((await post("/join", goodJoin)).status).toBe(200);
    m.getParticipant.mockResolvedValue(null);
    m.countByStage.mockResolvedValue({ PREFS_DONE: 7, DECLINED: 4 });
    expect((await post("/join", goodJoin)).status).toBe(200);
  });

  it("form-only (INVITED) rows don't count toward the cap: 8 made-up phones can't lock the plan against real joiners", async () => {
    m.countByStage.mockResolvedValue({ INVITED: 8, JOINED: 2 });
    expect((await post("/join", goodJoin)).status).toBe(200);
    m.countByStage.mockResolvedValue({ INVITED: 3, JOINED: 1, BUDGET_LOCKED: 2, PREFS_DONE: 5 });
    const res = await post("/join", goodJoin);
    expect([res.status, await res.json()]).toEqual([409, { error: "plan_full" }]);
  });

  it("a form budget never overwrites a budget the member already confirmed by text (lane past INVITED)", async () => {
    m.upsertParticipant.mockResolvedValue({ row: { lane: 2, stage: "BUDGET_LOCKED" }, created: false });
    expect((await post("/join", { ...goodJoin, budget_usd: { target: 20 } })).status).toBe(200);
    expect(m.upsert).not.toHaveBeenCalled();
    m.upsertParticipant.mockResolvedValue({ row: { lane: 2, stage: "INVITED" }, created: false });
    expect((await post("/join", { ...goodJoin, budget_usd: { target: 20 } })).status).toBe(200);
    expect(m.upsert).toHaveBeenCalledOnce();
  });

  it("a user who has texted us keeps their name; an unconfirmed one can fix a typo", async () => {
    m.findUserByPhone.mockResolvedValue({ ...user, first_name: "Ana", photon_user_id: "pu1" });
    await post("/join", { ...goodJoin, first_name: "Mallory" });
    expect(m.upsertUserByPhone).not.toHaveBeenCalled();
    expect(m.ensureSeat).toHaveBeenCalledWith(expect.objectContaining({ first_name: "Ana" }), `join:${PLAN_ID}`);
    m.findUserByPhone.mockResolvedValue({ ...user, photon_user_id: null });
    await post("/join", { ...goodJoin, first_name: "Anna" });
    expect(m.upsertUserByPhone).toHaveBeenCalledWith({ phone_e164: "+14155550111", first_name: "Anna" });
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

  it("422 invalid with issues for a bad E.164, missing consent, a short code, a 41-char name and unknown keys", async () => {
    for (const bad of [{ ...goodJoin, phone_e164: "415-555-0111" }, { ...goodJoin, consent: false }, { ...goodJoin, code: "12" }, { ...goodJoin, first_name: "a".repeat(41) }, { ...goodJoin, extra: 1 }]) {
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
  const body = { title: "Dinner and a show", area: "Santa Monica", date: "2026-10-17", time_start: "18:30", time_end: "22:30", party_target: 4, organizer: { phone_e164: "+14155550100", first_name: "Maya" } };

  beforeEach(() => {
    m.upsertUserByPhone.mockResolvedValue(organizer);
    m.createPlanRecord.mockResolvedValue({ plan: { ...plan, code: "5150" }, join_url: `${origin}/j/5150` });
  });

  it("200: seats the organizer (scope 'start') before creating the plan at INVITED; hand-off fields plus the legacy qr_svg", async () => {
    const res = await post("/plans", body);
    expect(res.status).toBe(200);
    const out = CreatePlanResponse.parse(await res.json());
    expect(m.ensureSeat).toHaveBeenCalledWith(organizer, "start");
    expect(m.ensureSeat.mock.invocationCallOrder[0]).toBeLessThan(m.createPlanRecord.mock.invocationCallOrder[0]!);
    expect(m.createPlanRecord).toHaveBeenCalledWith(
      organizer,
      { title: "Dinner and a show", area: "Santa Monica", date: "2026-10-17", time_start: "18:30", time_end: "22:30", party_target: 4 },
      { organizerStage: "INVITED" },
    );
    expect(out).toMatchObject({ code: "5150", join_url: `${origin}/j/5150`, assigned_number: "+13105550001", sms_body: "Hey SquadTab! Let's get planning." });
    expect(out.sms_href).toBe(`sms:+13105550001&body=${encodeURIComponent("Hey SquadTab! Let's get planning.")}`);
    expect(out.qr_svg).toContain("<svg");
    expect(out.handoff_qr_svg).toContain("<svg");
    expect(verifyStatusToken(out.status_token)).toMatchObject({ u: ORG_ID, p: PLAN_ID, r: "organizer" });
  });

  it("accepts a blank or missing organizer first name (the fallback form sends '')", async () => {
    for (const first of [{ first_name: "" }, {}]) {
      expect((await post("/plans", { ...body, organizer: { phone_e164: "+14155550100", ...first } })).status).toBe(200);
    }
    expect(m.upsertUserByPhone).toHaveBeenLastCalledWith({ phone_e164: "+14155550100", first_name: "" });
  });

  it("an organizer who has texted us keeps their name; an unconfirmed one can fix a typo", async () => {
    const texted = { ...organizer, photon_user_id: "pu1" } as UserRow;
    m.findUserByPhone.mockResolvedValue(texted);
    expect((await post("/plans", { ...body, organizer: { phone_e164: "+14155550100", first_name: "Mallory" } })).status).toBe(200);
    expect(m.upsertUserByPhone).not.toHaveBeenCalled();
    expect(m.ensureSeat).toHaveBeenCalledWith(texted, "start");
    m.findUserByPhone.mockResolvedValue({ ...organizer, photon_user_id: null });
    await post("/plans", { ...body, organizer: { phone_e164: "+14155550100", first_name: "Mayah" } });
    expect(m.upsertUserByPhone).toHaveBeenCalledWith({ phone_e164: "+14155550100", first_name: "Mayah" });
  });

  it("503 capacity with no plan created", async () => {
    m.ensureSeat.mockRejectedValue(new CapacityError());
    const res = await post("/plans", body);
    expect([res.status, await res.json()]).toEqual([503, { error: "capacity" }]);
    expect(m.createPlanRecord).not.toHaveBeenCalled();
  });

  it("422 for party_target outside 2..8, a bad organizer phone, or a bad time", async () => {
    for (const bad of [{ ...body, party_target: 9 }, { ...body, party_target: 1 }, { ...body, organizer: { ...body.organizer, phone_e164: "123" } }, { ...body, time_start: "6pm" }]) {
      expect((await post("/plans", bad)).status).toBe(422);
    }
    expect(m.createPlanRecord).not.toHaveBeenCalled();
  });

  it("429 on the 6th request from one IP", async () => {
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) codes.push((await post("/plans", body, "6.6.6.6")).status);
    expect(codes).toEqual([200, 200, 200, 200, 200, 429]);
  });
});

describe("GET /plans/:code", () => {
  it("200: exactly the whitelisted keys, cacheable for 15 s; never budgets or member names", async () => {
    const res = await get("/plans/4821");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=15");
    const out = (await res.json()) as Record<string, unknown>;
    expect(Object.keys(out).sort()).toEqual(["area", "code", "date_label", "joined", "organizer_first_name", "party_target", "status", "time_label", "title"]);
    expect(PlanPreview.parse(out)).toEqual({ code: "4821", title: "Dinner + show", date_label: "Sat, Oct 24", time_label: "7:00 PM", area: "Santa Monica", organizer_first_name: "Maya", joined: 1, party_target: 4, status: "open" });
    expect(m.getPlanByCode).toHaveBeenCalledWith("4821");
  });

  it("organizer_first_name is null when the organizer has no name yet", async () => {
    m.getUser.mockResolvedValue({ ...organizer, first_name: "" });
    expect(((await (await get("/plans/4821")).json()) as { organizer_first_name: unknown }).organizer_first_name).toBeNull();
  });

  it("status closed past VOTING, full at 8 members who texted; form-only INVITED rows never fill it", async () => {
    m.getPlanByCode.mockResolvedValue({ ...plan, state: "ORDERING" });
    expect(((await (await get("/plans/4821")).json()) as { status: string }).status).toBe("closed");
    m.getPlanByCode.mockResolvedValue(plan);
    m.countByStage.mockResolvedValue({ INVITED: 2, PREFS_DONE: 6 });
    expect(((await (await get("/plans/4821")).json()) as { status: string }).status).toBe("open");
    m.countByStage.mockResolvedValue({ INVITED: 8 });
    expect(((await (await get("/plans/4821")).json()) as { status: string }).status).toBe("open");
    m.countByStage.mockResolvedValue({ INVITED: 2, PREFS_DONE: 6, HELD: 2 });
    expect(((await (await get("/plans/4821")).json()) as { status: string }).status).toBe("full");
  });

  it("404 for an unknown code, a malformed code (no lookup) and the SHOWCASE row", async () => {
    m.getPlanByCode.mockResolvedValue(null);
    expect([(await get("/plans/0000")).status]).toEqual([404]);
    m.getPlanByCode.mockClear();
    const bad = await get("/plans/12ab");
    expect([bad.status, await bad.json()]).toEqual([404, { error: "not_found" }]);
    expect(m.getPlanByCode).not.toHaveBeenCalled();
    m.getPlanByCode.mockResolvedValue({ ...plan, state: "SHOWCASE" });
    expect((await get("/plans/4821")).status).toBe(404);
  });

  it("429 on the 61st request per minute from one IP", async () => {
    const codes: number[] = [];
    for (let i = 0; i < 61; i++) codes.push((await get("/plans/4821", "4.4.4.4")).status);
    expect(codes.slice(0, 60).every((s) => s === 200)).toBe(true);
    expect(codes[60]).toBe(429);
  });
});

describe("GET /status", () => {
  const tokenFor = (r: "organizer" | "guest" = "organizer", p: string | null = null, u = ORG_ID) => issueStatusToken({ u, p, r });

  it("gate: an organizer of an active plan who has not texted since the token gets waiting with nothing else", async () => {
    m.currentPlanForUser.mockResolvedValue(plan);
    m.getParticipant.mockResolvedValue({ stage: "PREFS_DONE" });
    m.lastInboundAt.mockResolvedValue(new Date(Date.now() - 60 * 60_000)); // texted an hour ago, before this token
    const res = await get(`/status?t=${encodeURIComponent(tokenFor())}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const out = StatusResponse.parse(await res.json());
    expect(out).toEqual({
      phase: "waiting", role: "organizer", phone_last4: "0100", assigned_number: "+13105550001",
      sms_body: "Hey SquadTab! Help me plan a night out.", first_name: null, plan: null, steps: null,
    });
    expect(m.currentPlanForUser).not.toHaveBeenCalled();
  });

  it("after the owner texts: plan_ready with the plan card and join_url, counts only", async () => {
    m.currentPlanForUser.mockResolvedValue(plan);
    m.getParticipant.mockResolvedValue({ stage: "JOINED" });
    m.lastInboundAt.mockResolvedValue(new Date(Date.now() + 5_000));
    const out = StatusResponse.parse(await (await get(`/status?t=${encodeURIComponent(tokenFor())}`)).json());
    expect(out.phase).toBe("plan_ready");
    expect(out.first_name).toBe("Maya");
    expect(out.plan).toMatchObject({ code: "4821", joined: 1, join_url: `${origin}/j/4821` });
    expect(JSON.stringify(out)).not.toMatch(/members|_cents|budget_usd|hard_max/);
  });

  it("401 for a missing, tampered or foreign-key token", async () => {
    expect((await get("/status")).status).toBe(401);
    const t = tokenFor();
    const tampered = `${t.slice(0, -2)}${t.endsWith("AA") ? "BB" : "AA"}`;
    expect((await get(`/status?t=${encodeURIComponent(tampered)}`)).status).toBe(401);
    expect(await (await get(`/status?t=nope`)).json()).toEqual({ error: "unauthorized" });
  });

  it("401 when the token's user no longer exists or was forgotten", async () => {
    m.getUser.mockResolvedValue(null);
    expect((await get(`/status?t=${encodeURIComponent(tokenFor())}`)).status).toBe(401);
    m.getUser.mockResolvedValue({ ...organizer, phone_e164: `forgotten:${ORG_ID}` });
    expect((await get(`/status?t=${encodeURIComponent(tokenFor())}`)).status).toBe(401);
  });

  it("per-token limit: 429 at call 41 within a minute; a second token from the same IP is unaffected", async () => {
    // Fresh user ids: earlier tests used ORG_ID tokens minted in the same second, which share one (u, iat) bucket.
    m.getUser.mockResolvedValue(organizer);
    const t1 = tokenFor("organizer", null, "55555555-5555-4555-8555-555555555555");
    const t2 = tokenFor("guest", PLAN_ID, "66666666-6666-4666-8666-666666666666");
    const codes: number[] = [];
    for (let i = 0; i < 41; i++) codes.push((await get(`/status?t=${encodeURIComponent(t1)}`, "3.3.3.3")).status);
    expect(codes.slice(0, 40).every((s) => s === 200)).toBe(true);
    expect(codes[40]).toBe(429);
    expect((await get(`/status?t=${encodeURIComponent(t2)}`, "3.3.3.3")).status).toBe(200);
  });
});
