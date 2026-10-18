// Chat-first start (ux-flow §8.2-8.4): start-by-chat, the plan-draft parser, area sanitization, looksLikeName and the
// membership name step, with every collaborator that would touch the DB or Photon mocked.
import { COPY, type InboundEvent } from "@tab/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MemberContext, PlanRow, UserRow } from "../repo/types";

const m = vi.hoisted(() => {
  const tx = { tx: true };
  return {
    tx,
    sql: Object.assign(vi.fn(async () => [] as unknown[]), { begin: vi.fn(async (cb: (t: unknown) => Promise<unknown>) => cb(tx)) }),
    emit: vi.fn(async () => 1),
    enqueue: vi.fn(async () => true),
    startResearch: vi.fn(async () => {}),
    cancelResearch: vi.fn(async () => {}),
    confirmFormBudget: vi.fn(async () => false),
    fanout: vi.fn(async () => 1),
    notify: vi.fn(async () => "sent"),
    startPlanTyping: vi.fn(),
    stopPlanTyping: vi.fn(),
    getParticipant: vi.fn(),
    listMembers: vi.fn(async (): Promise<unknown[]> => []),
    updateStage: vi.fn(),
    getPlan: vi.fn(),
    getPlanByCode: vi.fn(),
    getUser: vi.fn(async () => ({ first_name: "Leo" })),
    setFirstName: vi.fn(async () => true),
    sendStatus: vi.fn(async () => {}),
    cancel: vi.fn(async () => {}),
    transition: vi.fn(),
    createPlanRecord: vi.fn(),
    converseReply: vi.fn(async () => false),
    parsePlanDraft: vi.fn(),
  };
});
vi.mock("../db", () => ({ sql: m.sql }));
vi.mock("../events", () => ({ emit: m.emit }));
vi.mock("../dueJobs", async (orig) => ({ ...(await orig<typeof import("../dueJobs")>()), enqueue: m.enqueue }));
vi.mock("../creao/research", () => ({ startResearch: m.startResearch, cancelResearch: m.cancelResearch }));
vi.mock("../delegates/budget", () => ({ confirmFormBudget: m.confirmFormBudget }));
vi.mock("../delegates/free", () => ({ converseReply: m.converseReply }));
vi.mock("../notify/fanout", () => ({ fanout: m.fanout }));
vi.mock("../notify/notify", () => ({
  notify: m.notify,
  replyKey: (id: string, n: number) => `reply:${id}:${n}`,
  tplKey: (p: string, u: string, t: string, v: number) => `tpl:${p}:${u}:${t}:${v}`,
}));
vi.mock("../notify/presence", () => ({ startPlanTyping: m.startPlanTyping, stopPlanTyping: m.stopPlanTyping }));
vi.mock("../repo/participants", () => ({ getParticipant: m.getParticipant, listMembers: m.listMembers, updateStage: m.updateStage }));
vi.mock("../repo/plans", () => ({ getPlan: m.getPlan, getPlanByCode: m.getPlanByCode }));
vi.mock("../repo/users", () => ({ getUser: m.getUser, setFirstName: m.setFirstName }));
vi.mock("../router/handlers", () => ({ sendStatus: m.sendStatus }));
vi.mock("../join/createPlanRecord", () => ({ createPlanRecord: m.createPlanRecord }));
vi.mock("../ports", () => ({ ports: { llm: { parsePlanDraft: m.parsePlanDraft } } }));
vi.mock("../jobs/ladder", () => ({}));
vi.mock("./commit", () => ({}));
vi.mock("./cancel", () => ({ cancel: m.cancel }));
vi.mock("./machine", async (orig) => ({ ...(await orig<typeof import("./machine")>()), transition: m.transition }));

import { clearAwaiting, getAwaiting } from "../delegates/awaiting";
import { addDays, parsePlanDraftText, todayLA, weekdayOf, type PlanDraftInput, type PlanDraftParse } from "../delegates/planDraft";
import { render } from "../notify/render";
import { looksLikeName } from "../router/commands";
import { onGo, onJoinText, onNameText } from "./membership";
import { endTime, handleStartText, resetStartDrafts, sanitizeArea, validDraftFields } from "./startByChat";

// Thursday, Oct 22 2026, noon in Los Angeles.
const NOW = new Date("2026-10-22T19:00:00Z");
const TODAY = "2026-10-22";

const user = (o: Partial<UserRow> = {}): UserRow => ({
  id: "u1", phone_e164: "+13105550100", first_name: "", photon_user_id: "pu1", payer_ref: "p", created_at: new Date(0), ...o,
});
const plan = (o: Partial<PlanRow> = {}): PlanRow => ({
  id: "p1", ref: "r1", code: "4821", organizer_id: "u1", state: "COLLECTING", version: 1, title: "Dinner + show", area: "Santa Monica",
  event_date: "2026-10-24", time_start: "19:00", time_end: "23:00", party_target: 4, chosen_bundle_id: null, venue_order_id: null,
  deadlines: {}, created_at: new Date(0), updated_at: new Date(0), ...o,
});
let seq = 0;
const ev = (text: string): InboundEvent =>
  ({
    event_id: `ev${++seq}`, seq, message_id: `msg${seq}`, platform: "imessage", from_handle: "+13105550100", from_user_id: "pu1",
    agent_user_id: "ag1", space_id: "sp1", space_kind: "direct", content_type: "text", text, parent_message_id: null,
    received_at: NOW.toISOString(),
  }) as InboundEvent;
const sent = () => m.notify.mock.calls.map((c) => (c as unknown[])[1]);
const draftInput = (text: string, o: Partial<PlanDraftInput> = {}): PlanDraftInput => ({
  text, today: TODAY, weekday: "Thursday", known: {}, last_question: null, ...o,
});
const parse = (o: Partial<PlanDraftParse>): PlanDraftParse => ({
  first_name: null, area: null, date: null, time_start: null, party_size: null, confidence: "high", ...o,
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  for (const fn of Object.values(m)) if (typeof fn === "function" && "mockClear" in fn) fn.mockClear();
  m.parsePlanDraft.mockReset().mockImplementation(async (i: PlanDraftInput) => parsePlanDraftText(i));
  m.converseReply.mockReset().mockResolvedValue(false);
  m.setFirstName.mockReset().mockResolvedValue(true);
  m.createPlanRecord.mockReset().mockImplementation(async (_u: UserRow, f: { title: string; area: string; date: string; time_start: string; time_end: string; party_target: number }) => ({
    plan: plan({ title: f.title, area: f.area, event_date: f.date, time_start: f.time_start, time_end: f.time_end, party_target: f.party_target }),
    join_url: "https://tab-web-ten.vercel.app/j/4821",
  }));
  resetStartDrafts();
  clearAwaiting("u1");
});
afterEach(() => vi.useRealTimers());

describe("looksLikeName", () => {
  it.each([
    ["leo", "Leo"], ["it's Sam!", "Sam"], ["It’s sam.", "Sam"], ["I'm Maya", "Maya"], ["call me DeShawn", "DeShawn"],
    ["mary-jane", "Mary-Jane"], ["josé", "José"], ["Leo Chen", "Leo"], ["hi, i'm priya", "Priya"], ["  leo  ", "Leo"],
  ])("%j → %s", (text, name) => {
    expect(looksLikeName(text)).toBe(name);
  });

  it.each([
    "40 max", "no idea", "maybe sixty", "around forty", "$50", "fifty", "like 40", "idk", "whatever works", "I'm in", "hey",
    "yes", "status", "a b c", "", "budget is tight", "not sure", "one hundred", "40k", "superlongnamethatkeepsgoing",
  ])("%j → null", (text) => {
    expect(looksLikeName(text)).toBeNull();
  });
});

describe("LA calendar helpers", () => {
  it("today, weekday and day math in Los Angeles", () => {
    expect(todayLA(new Date("2026-10-23T06:30:00Z"))).toBe("2026-10-22"); // 11:30 PM PDT is still the 22nd
    expect(weekdayOf("2026-10-24")).toBe("Saturday");
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-11-01", 30)).toBe("2026-12-01"); // across the DST change
  });

  it("endTime is start + 4 h, capped at 23:59", () => {
    expect(endTime("19:00")).toBe("23:00");
    expect(endTime("19:45")).toBe("23:45");
    expect(endTime("21:30")).toBe("23:59");
  });
});

describe("parsePlanDraftText (deterministic parser)", () => {
  it("extracts nothing from the pre-filled opener", () => {
    expect(parsePlanDraftText(draftInput("Hey SquadTab! Help me plan a night out."))).toEqual(parse({ confidence: "low" }));
  });

  it.each<[string, Partial<PlanDraftParse>, Partial<PlanDraftInput>?]>([
    ["maya! santa monica saturday, prob 4 of us", { first_name: "Maya", area: "Santa Monica", date: "2026-10-24", party_size: 4 }],
    ["maya, santa monica saturday, 4 of us", { first_name: "Maya", area: "Santa Monica", date: "2026-10-24", party_size: 4 }],
    ["santa monica tonight, 4 of us", { area: "Santa Monica", date: TODAY, party_size: 4 }],
    ["dinner in Koreatown tomorrow at 8, 5 of us", { area: "Koreatown", date: "2026-10-23", time_start: "20:00", party_size: 5 }],
    ["I'm Sam, Westwood / Sawtelle tonight, me and 3 friends", { first_name: "Sam", area: "Westwood / Sawtelle", date: TODAY, party_size: 4 }],
    ["party of 6 in Silver Lake friday 7:30pm", { area: "Silver Lake", date: "2026-10-23", time_start: "19:30", party_size: 6 }],
    ["next thursday, Pasadena, six people", { area: "Pasadena", date: "2026-10-29", party_size: 6 }],
    ["Koreatown", { area: "Koreatown" }, { last_question: "area" }],
    ["4", { party_size: 4 }, { last_question: "count" }],
    ["like five of us", { party_size: 5 }, { last_question: "count" }],
    ["maya", { first_name: "Maya" }, { last_question: "hello" }],
    ["santa monica", { area: "Santa Monica" }, { last_question: "hello" }],
  ])("%j", (text, expected, o) => {
    expect(parsePlanDraftText(draftInput(text, o))).toEqual(parse(expected));
  });

  it.each(["I'm in for Dinner + show!", "thanks!", "what is this?", "lol ok", "4"])("%j extracts nothing without context", (text) => {
    expect(parsePlanDraftText(draftInput(text)).confidence).toBe("low");
  });
});

describe("sanitizeArea (the CREAO barrier, P6)", () => {
  it.each([
    ["Koreatown", "Koreatown"], ["westwood / sawtelle", "Westwood / Sawtelle"], ["Westwood / Sawtelle", "Westwood / Sawtelle"],
    ["  santa   monica ", "Santa Monica"], ["Santa Monica, CA", "Santa Monica, CA"], ["Silver Lake.", "Silver Lake"], ["DTLA", "DTLA"],
  ])("accepts %j as %j", (raw, area) => {
    expect(sanitizeArea(raw)).toBe(area);
  });

  it.each([
    "santa monica, $60 each", "310-555-0123", "4111 1111 1111 1111", "santa monica 60 bucks", "maya@example.com", "x", "",
    "90401", "santa monica under budget", "a".repeat(61), "<script>", "Venice‮",
  ])("rejects %j", (raw) => {
    expect(sanitizeArea(raw)).toBeNull();
  });

  it("rejects the person's own first name read as a place", () => {
    expect(sanitizeArea("Maya", ["Maya"])).toBeNull();
    expect(sanitizeArea("maya", ["", "Maya"])).toBeNull();
  });

  it("validDraftFields drops every out-of-range value", () => {
    expect(
      validDraftFields(parse({ first_name: "40 max", area: "$60", date: "2027-01-01", time_start: "8pm", party_size: 12 }), TODAY, []),
    ).toEqual({});
    expect(validDraftFields(parse({ date: "2026-10-21", time_start: "03:00", party_size: 1 }), TODAY, [])).toEqual({});
    // 30 days ahead is the last valid date; "7:30" is a morning time, so it is dropped (dinner + show starts 10:00-23:00).
    expect(validDraftFields(parse({ first_name: "maya", area: "venice", date: "2026-11-21", time_start: "7:30", party_size: 8 }), TODAY, [])).toEqual({
      first_name: "Maya", area: "Venice", date: "2026-11-21", party: 8,
    });
    expect(validDraftFields(parse({ time_start: "19:30", party_size: 2 }), TODAY, [])).toEqual({ time_start: "19:30", party: 2 });
  });
});

describe("handleStartText (plan creation by chat)", () => {
  it("opener → T_START_HELLO with no link; then the plan is created, organizer JOINED, link + budget ask", async () => {
    await handleStartText(user(), ev("Hey SquadTab! Help me plan a night out."));
    expect(sent()).toEqual(["T_START_HELLO"]);
    expect(COPY.T_START_HELLO).not.toMatch(/https?:|\/j\//);
    expect(m.createPlanRecord).not.toHaveBeenCalled();

    m.notify.mockClear();
    const e = ev("maya, santa monica saturday, 4 of us");
    await handleStartText(user(), e);
    expect(m.setFirstName).toHaveBeenCalledWith("u1", "Maya");
    expect(m.createPlanRecord).toHaveBeenCalledWith(
      expect.objectContaining({ id: "u1", first_name: "Maya" }),
      { title: "Dinner + show", area: "Santa Monica", date: "2026-10-24", time_start: "17:30", time_end: "23:00", party_target: 4 },
      { organizerStage: "JOINED" },
    );
    expect(sent()).toEqual(["T_PLAN_READY", "T_BUDGET_ASK"]);
    const [ready, budget] = m.notify.mock.calls as unknown as [string, string, Record<string, unknown>, { key: string; planId: string }][];
    expect(ready[2]).toEqual({
      greeting: "You're set, Maya", title: "Dinner + show", date: "Sat, Oct 24", time: "5:30 PM", area: "Santa Monica", n: 4,
      url: "https://tab-web-ten.vercel.app/j/4821",
    });
    expect(ready[3]).toEqual({ key: `reply:${e.message_id}:1`, planId: "p1" });
    expect(budget[3]).toEqual({ key: `reply:${e.message_id}:2`, planId: "p1" });
    // Never threaded (shared lines reject parentMessageId).
    for (const c of m.notify.mock.calls) expect((c as unknown[])[3]).not.toHaveProperty("replyTo");
    const text = render("T_PLAN_READY", ready[2] as never);
    expect(text).toBe(
      "You're set, Maya: Dinner + show, Sat, Oct 24 from 5:30 PM in Santa Monica, 4 of you. Send this link to your group chat and I'll take it from there:\nhttps://tab-web-ten.vercel.app/j/4821",
    );
    expect(text.split("\n").at(-1)).toBe("https://tab-web-ten.vercel.app/j/4821");
  });

  it("a first message with everything creates the plan at once", async () => {
    await handleStartText(user({ first_name: "Ana" }), ev("Koreatown tomorrow at 8, 5 of us"));
    expect(m.createPlanRecord).toHaveBeenCalledWith(
      expect.anything(),
      { title: "Dinner + show", area: "Koreatown", date: "2026-10-23", time_start: "20:00", time_end: "23:59", party_target: 5 },
      { organizerStage: "JOINED" },
    );
    expect((m.notify.mock.calls[0] as unknown[])[2]).toMatchObject({ greeting: "You're set, Ana" });
    expect(m.setFirstName).not.toHaveBeenCalled();
  });

  it("missing area → T_START_ASK_AREA, every time, until a place arrives", async () => {
    await handleStartText(user(), ev("Hey SquadTab! Help me plan a night out."));
    await handleStartText(user(), ev("tomorrow, 4 of us"));
    await handleStartText(user(), ev("hmm"));
    expect(sent()).toEqual(["T_START_HELLO", "T_START_ASK_AREA", "T_START_ASK_AREA"]);
    await handleStartText(user(), ev("Venice"));
    expect(m.createPlanRecord).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ area: "Venice", date: "2026-10-23", party_target: 4 }), expect.anything());
  });

  it("area and count missing → T_START_ASK_BOTH", async () => {
    await handleStartText(user(), ev("Hey SquadTab! Help me plan a night out."));
    await handleStartText(user(), ev("tonight!"));
    expect(sent()).toEqual(["T_START_HELLO", "T_START_ASK_BOTH"]);
  });

  it("missing count → one ask, then the default of 4", async () => {
    await handleStartText(user(), ev("santa monica tonight"));
    expect(sent()).toEqual(["T_START_ASK_COUNT"]);
    await handleStartText(user(), ev("idk yet lol"));
    expect(m.createPlanRecord).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ area: "Santa Monica", date: TODAY, party_target: 4 }), expect.anything());
    expect((m.notify.mock.calls.at(-2) as unknown[])[2]).toMatchObject({ greeting: "You're set", n: 4 });
  });

  it("a bare number answers the count question", async () => {
    await handleStartText(user(), ev("santa monica tonight"));
    await handleStartText(user(), ev("6"));
    expect(m.createPlanRecord).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ party_target: 6 }), expect.anything());
  });

  it.each(["santa monica, $60 each", "310-555-0123", "4111 1111 1111 1111"])("a model area of %j is rejected → T_START_ASK_AREA", async (area) => {
    m.parsePlanDraft.mockResolvedValue(parse({ area, party_size: 4 }));
    await handleStartText(user(), ev("whatever"));
    expect(sent()).toEqual(["T_START_ASK_AREA"]);
    expect(m.createPlanRecord).not.toHaveBeenCalled();
  });

  it.each(["Westwood / Sawtelle", "Koreatown"])("a model area of %j is accepted", async (area) => {
    m.parsePlanDraft.mockResolvedValue(parse({ area, party_size: 4 }));
    await handleStartText(user(), ev("whatever"));
    expect(m.createPlanRecord).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ area }), expect.anything());
  });

  it("a budget in the text never reaches the plan (P1/P6): only the area, date and count do", async () => {
    await handleStartText(user(), ev("santa monica tonight, 4 of us, $60 each max"));
    const [, fields] = m.createPlanRecord.mock.calls[0] as unknown as [UserRow, Record<string, unknown>];
    expect(fields).toEqual({ title: "Dinner + show", area: "Santa Monica", date: TODAY, time_start: "17:30", time_end: "23:00", party_target: 4 });
    expect(JSON.stringify(m.notify.mock.calls)).not.toMatch(/60/);
  });

  it("no time given: the demo window 17:30–23:00; a time given: start + 4 h", async () => {
    m.parsePlanDraft.mockResolvedValue(parse({ area: "Santa Monica", party_size: 4, time_start: "20:00" }));
    await handleStartText(user(), ev("santa monica at 8, 4 of us"));
    expect(m.createPlanRecord).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ time_start: "20:00", time_end: "23:59" }), expect.anything());
  });

  it("the parser sees only this person's own text, own draft and the last question (P2)", async () => {
    await handleStartText(user(), ev("santa monica tonight"));
    await handleStartText(user(), ev("5"));
    expect(m.parsePlanDraft.mock.calls[1]![0]).toEqual({
      text: "5", today: TODAY, weekday: "Thursday", known: { area: "Santa Monica", date: TODAY }, last_question: "count",
    });
  });

  it("off-topic text after a question: the private delegate's reply if it has one, else the plain re-ask", async () => {
    await handleStartText(user(), ev("Hey SquadTab! Help me plan a night out."));
    m.converseReply.mockResolvedValueOnce(true);
    await handleStartText(user(), ev("wait what is this"));
    expect(m.converseReply).toHaveBeenCalledWith(expect.objectContaining({ id: "u1" }), null, expect.objectContaining({ text: "wait what is this" }));
    expect(sent()).toEqual(["T_START_HELLO"]);
    await handleStartText(user(), ev("wait what is this"));
    expect(sent()).toEqual(["T_START_HELLO", "T_START_ASK_BOTH"]);
  });

  it("an out-of-range date from the model falls back to today", async () => {
    m.parsePlanDraft.mockResolvedValue(parse({ area: "Venice", date: "2027-03-01", party_size: 3 }));
    await handleStartText(user(), ev("venice in march, 3 of us"));
    expect(m.createPlanRecord).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ date: TODAY, party_target: 3 }), expect.anything());
  });

  it("a stale draft (6 h later) starts over", async () => {
    await handleStartText(user(), ev("santa monica tonight"));
    vi.setSystemTime(new Date(NOW.getTime() + 7 * 60 * 60 * 1000));
    await handleStartText(user(), ev("hmm"));
    expect(sent()).toEqual(["T_START_ASK_COUNT", "T_START_HELLO"]);
  });

  it("a create failure keeps the draft and propagates (the consumer retries the inbound)", async () => {
    m.createPlanRecord.mockRejectedValueOnce(new Error("db down"));
    await expect(handleStartText(user(), ev("santa monica tonight, 4 of us"))).rejects.toThrow("db down");
    await handleStartText(user(), ev("ok"));
    expect(m.createPlanRecord).toHaveBeenCalledTimes(2);
    expect(sent()).toEqual(["T_PLAN_READY", "T_BUDGET_ASK"]);
  });
});

describe("membership name step", () => {
  const e = (text: string) => ev(text);

  it("blank name: INVITED → JOINED, T_JOIN_WELCOME_NAME, the 'name' flag, and no budget ask yet", async () => {
    m.getPlanByCode.mockResolvedValue(plan({ organizer_id: "org" }));
    m.getParticipant.mockResolvedValue({ plan_id: "p1", user_id: "u1", lane: 2, stage: "INVITED" });
    m.updateStage.mockResolvedValue({ plan_id: "p1", user_id: "u1", lane: 2, stage: "JOINED" });
    const msg = e("I'm in for Dinner + show!");
    await onJoinText(user(), "4821", msg);
    expect(m.updateStage).toHaveBeenCalledWith("p1", "u1", "JOINED", m.tx);
    expect(sent()).toEqual(["T_JOIN_WELCOME_NAME"]);
    expect(m.notify).toHaveBeenCalledWith("u1", "T_JOIN_WELCOME_NAME", { title: "Dinner + show", date: "Sat, Oct 24" }, { key: `reply:${msg.message_id}:1`, planId: "p1" });
    expect(m.confirmFormBudget).not.toHaveBeenCalled();
    expect(getAwaiting("u1")).toBe("name");
  });

  it("named member: the existing welcome + budget ask, no flag", async () => {
    m.getPlanByCode.mockResolvedValue(plan({ organizer_id: "org" }));
    m.getParticipant.mockResolvedValue({ plan_id: "p1", user_id: "u1", lane: 2, stage: "INVITED" });
    await onJoinText(user({ first_name: "Ana" }), "4821", e("hey"));
    expect(sent()).toEqual(["T_JOIN_WELCOME", "T_BUDGET_ASK"]);
    expect(getAwaiting("u1")).toBeNull();
  });

  it("onNameText: stores the name, re-emits the lane with it, then T_BUDGET_ASK_NAMED", async () => {
    m.updateStage.mockResolvedValue({ plan_id: "p1", user_id: "u1", lane: 2, stage: "JOINED" });
    m.getUser.mockResolvedValueOnce({ first_name: "Leo" });
    const ctx: MemberContext = { user: user(), plan: plan(), participant: { plan_id: "p1", user_id: "u1", lane: 2, stage: "JOINED", joined_at: new Date(0) } };
    const msg = e("leo");
    await onNameText(ctx, "Leo", msg);
    expect(m.setFirstName).toHaveBeenCalledWith("u1", "Leo");
    expect(m.emit).toHaveBeenCalledWith(expect.objectContaining({ type: "lane", lane: 2, first_name: "Leo", stage: "JOINED" }), m.tx);
    expect(m.notify).toHaveBeenCalledWith("u1", "T_BUDGET_ASK_NAMED", { name: "Leo" }, { key: `reply:${msg.message_id}:1`, planId: "p1" });
    expect(render("T_BUDGET_ASK_NAMED", { name: "Leo" })).toMatch(/^Nice to meet you, Leo\. Next: what's the most/);
  });

  it("onNameText with a budget from the join form confirms it instead of asking", async () => {
    m.confirmFormBudget.mockResolvedValueOnce(true);
    const ctx: MemberContext = { user: user(), plan: plan(), participant: { plan_id: "p1", user_id: "u1", lane: 2, stage: "JOINED", joined_at: new Date(0) } };
    await onNameText(ctx, "Leo", e("leo"));
    expect(m.confirmFormBudget).toHaveBeenCalledWith(expect.objectContaining({ user: expect.objectContaining({ first_name: "Leo" }) }), expect.anything());
    expect(sent()).toEqual([]);
  });

  it("organizer GO works on a chat-created plan (the organizer is a counted participant)", async () => {
    const p = plan({ organizer_id: "u1" });
    m.getPlan.mockResolvedValue(p);
    m.listMembers.mockResolvedValue([{ user_id: "u1" }, { user_id: "u2" }, { user_id: "u3" }]);
    m.transition.mockResolvedValue({ version: 2 });
    const ctx: MemberContext = { user: user({ first_name: "Maya" }), plan: p, participant: { plan_id: "p1", user_id: "u1", lane: 1, stage: "PREFS_DONE", joined_at: new Date(0) } };
    await onGo(ctx, e("go"));
    expect(m.transition).toHaveBeenCalledWith("p1", "COLLECTING", "RESEARCHING", expect.anything());
    expect(m.startResearch).toHaveBeenCalledWith("p1");
  });
});
