import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PlanRow, UserRow } from "../repo/types";
import type { StatusTokenClaims } from "./statusToken";

const m = vi.hoisted(() => ({
  getUser: vi.fn(),
  lastInboundAt: vi.fn(),
  getActiveAssignment: vi.fn(),
  getPlan: vi.fn(),
  currentPlanForUser: vi.fn(),
  getParticipant: vi.fn(),
  countByStage: vi.fn(),
}));
vi.mock("../repo/users", () => ({ getUser: m.getUser, lastInboundAt: m.lastInboundAt }));
vi.mock("../repo/assignments", () => ({ getActiveAssignment: m.getActiveAssignment }));
vi.mock("../repo/plans", () => ({ getPlan: m.getPlan, currentPlanForUser: m.currentPlanForUser }));
vi.mock("../repo/participants", () => ({ getParticipant: m.getParticipant, countByStage: m.countByStage }));

const { getStatus, joinSmsBody } = await import("./status");
const { StatusResponse } = await import("./schemas");
const { env } = await import("../env");

const U = "22222222-2222-4222-8222-222222222222";
const OTHER = "44444444-4444-4444-8444-444444444444";
const P = "11111111-1111-4111-8111-111111111111";
const IAT = 1_790_000_000;
const before = new Date((IAT - 30) * 1000);
const after = new Date((IAT + 30) * 1000);

const user = { id: U, first_name: "Leo", phone_e164: "+14155550123" } as UserRow;
const plan = { id: P, code: "4821", state: "COLLECTING", title: "Dinner + show", area: "Santa Monica", event_date: "2026-10-24", time_start: "19:00", party_target: 4, organizer_id: U } as PlanRow;
const org = (p: string | null = null): StatusTokenClaims => ({ u: U, p, r: "organizer", iat: IAT });
const guest = (p: string = P): StatusTokenClaims => ({ u: U, p, r: "guest", iat: IAT });

async function status(c: StatusTokenClaims) {
  const out = await getStatus(c);
  return out && StatusResponse.parse(out); // strict: pins the exact key set on every phase
}

beforeEach(() => {
  vi.resetAllMocks();
  m.getUser.mockResolvedValue(user);
  m.lastInboundAt.mockResolvedValue(after);
  m.getActiveAssignment.mockResolvedValue({ assigned_number: "+13105550001" });
  m.getPlan.mockResolvedValue(plan);
  m.currentPlanForUser.mockResolvedValue(null);
  m.getParticipant.mockResolvedValue(null);
  m.countByStage.mockResolvedValue({ JOINED: 1, INVITED: 2 });
});

describe("proof-of-possession gate", () => {
  it.each([
    ["never texted", null],
    ["texted before the token was issued", before],
  ])("%s: waiting, with name, plan and steps all null even for an active organizer", async (_label, last) => {
    m.lastInboundAt.mockResolvedValue(last);
    m.currentPlanForUser.mockResolvedValue(plan);
    m.getParticipant.mockResolvedValue({ stage: "PREFS_DONE" });
    const out = await status(org());
    expect(out).toEqual({
      phase: "waiting", role: "organizer", phone_last4: "0123", assigned_number: "+13105550001",
      sms_body: "Hey SquadTab! Help me plan a night out.", first_name: null, plan: null, steps: null,
    });
    expect(m.currentPlanForUser).not.toHaveBeenCalled();
    expect(m.getParticipant).not.toHaveBeenCalled();
    expect(Object.keys(out!)).not.toContain("members");
  });

  it("a text exactly at iat passes the gate", async () => {
    m.lastInboundAt.mockResolvedValue(new Date(IAT * 1000));
    expect((await status(org()))!.phase).toBe("texted");
  });

  it("waiting sms_body follows the token: POST /plans organizer, guest (short and long title)", async () => {
    m.lastInboundAt.mockResolvedValue(null);
    expect((await status(org(P)))!.sms_body).toBe("Hey SquadTab! Let's get planning.");
    expect((await status(guest()))!.sms_body).toBe("I'm in for Dinner + show!");
    m.getPlan.mockResolvedValue({ ...plan, title: "z".repeat(41) });
    expect((await status(guest()))!.sms_body).toBe("I'm in!");
    expect(joinSmsBody("x".repeat(40))).toBe(`I'm in for ${"x".repeat(40)}!`);
  });

  it("waiting sms_body for a guest already JOINED (token minted after their last text) is the in-plan body", async () => {
    m.lastInboundAt.mockResolvedValue(before);
    m.getParticipant.mockResolvedValue({ stage: "BUDGET_LOCKED" });
    const out = await status(guest());
    expect(out).toMatchObject({ phase: "waiting", sms_body: "Hey SquadTab, where are we at?", first_name: null, plan: null, steps: null });
    expect(m.getParticipant).toHaveBeenCalledWith(P, U);
    for (const stage of ["INVITED", "DECLINED", "RELEASED"]) {
      m.getParticipant.mockResolvedValue({ stage });
      expect((await status(guest()))!.sms_body).toBe("I'm in for Dinner + show!");
    }
  });

  it("assigned_number is null once the seat was released", async () => {
    m.lastInboundAt.mockResolvedValue(null);
    m.getActiveAssignment.mockResolvedValue(null);
    expect((await status(org()))!.assigned_number).toBeNull();
  });
});

describe("phases after the owner texted", () => {
  it("organizer token, no plan yet: texted", async () => {
    const out = await status(org());
    expect(out).toMatchObject({ phase: "texted", role: "organizer", first_name: "Leo", plan: null, steps: null, sms_body: "Hey SquadTab! Help me plan a night out." });
  });

  it("organizer token, own active plan (found by currentPlanForUser): plan_ready with card, join_url and own steps", async () => {
    m.currentPlanForUser.mockResolvedValue(plan);
    m.getParticipant.mockResolvedValue({ stage: "BUDGET_LOCKED" });
    m.getUser.mockImplementation(async () => user);
    const out = await status(org());
    expect(out).toEqual({
      phase: "plan_ready", role: "organizer", phone_last4: "0123", assigned_number: "+13105550001",
      sms_body: "Hey SquadTab, where are we at?", first_name: "Leo",
      plan: {
        code: "4821", title: "Dinner + show", date_label: "Sat, Oct 24", time_label: "7:00 PM", area: "Santa Monica",
        organizer_first_name: "Leo", joined: 1, party_target: 4, status: "open", join_url: `${new URL(env.WEB_ORIGIN).origin}/j/4821`,
      },
      steps: { budget: true, prefs: false },
    });
  });

  it("organizer token with p (POST /plans): uses getPlan, plan_ready even while the organizer is still INVITED", async () => {
    m.getParticipant.mockResolvedValue({ stage: "INVITED" });
    const out = await status(org(P));
    expect(out!.phase).toBe("plan_ready");
    expect(m.getPlan).toHaveBeenCalledWith(P);
    expect(m.currentPlanForUser).not.toHaveBeenCalled();
  });

  it("organizer token whose current plan someone else organizes: guest phases", async () => {
    m.currentPlanForUser.mockResolvedValue({ ...plan, organizer_id: OTHER });
    m.getParticipant.mockResolvedValue({ stage: "PREFS_DONE" });
    expect(await status(org())).toMatchObject({ phase: "joined", role: "guest", steps: { budget: true, prefs: true } });
  });

  it("guest: waiting while INVITED, joined from JOINED on; steps tick from the own stage only", async () => {
    m.getUser.mockResolvedValue({ ...user, first_name: "" });
    m.getParticipant.mockResolvedValue({ stage: "INVITED" });
    expect(await status(guest())).toMatchObject({ phase: "waiting", role: "guest", first_name: null, steps: { budget: false, prefs: false } });
    m.getParticipant.mockResolvedValue({ stage: "JOINED" });
    expect(await status(guest())).toMatchObject({ phase: "joined", steps: { budget: false, prefs: false } });
    m.getParticipant.mockResolvedValue({ stage: "VOTED" });
    expect(await status(guest())).toMatchObject({ phase: "joined", steps: { budget: true, prefs: true } });
  });

  it("guest who declined: closed", async () => {
    m.getParticipant.mockResolvedValue({ stage: "DECLINED" });
    expect((await status(guest()))!.phase).toBe("closed");
  });

  it.each(["ORDERING", "CONFIRMED", "CANCELLED"])("plan in %s: closed for organizer and guest", async (state) => {
    m.getPlan.mockResolvedValue({ ...plan, state });
    m.getParticipant.mockResolvedValue({ stage: "VOTED" });
    expect((await status(org(P)))!.phase).toBe("closed");
    expect((await status(guest()))!.phase).toBe("closed");
  });

  it("guest token whose plan vanished: closed", async () => {
    m.getPlan.mockResolvedValue(null);
    expect(await status(guest())).toMatchObject({ phase: "closed", plan: null, steps: null });
  });

  it("never exposes member names: only the organizer's first name and counts", async () => {
    m.currentPlanForUser.mockResolvedValue({ ...plan, organizer_id: OTHER });
    m.getUser.mockImplementation(async (id: string) => (id === U ? user : { id: OTHER, first_name: "Maya", phone_e164: "+14155550100" }));
    m.getParticipant.mockResolvedValue({ stage: "JOINED" });
    const out = await status(org());
    expect(out!.plan!.organizer_first_name).toBe("Maya");
    expect(JSON.stringify(out)).not.toMatch(/members|_cents|budget_usd|hard_max|\+1415/);
  });
});

describe("unknown users", () => {
  it("returns null (401) for a missing or forgotten user", async () => {
    m.getUser.mockResolvedValue(null);
    expect(await getStatus(org())).toBeNull();
    m.getUser.mockResolvedValue({ ...user, phone_e164: `forgotten:${U}` });
    expect(await getStatus(org())).toBeNull();
  });
});
