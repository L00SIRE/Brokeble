import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InboundEvent } from "@tab/shared";

const m = vi.hoisted(() => {
  const f = () => vi.fn();
  return {
    getAwaiting: f(), clearAwaiting: f(),
    applyTier: f(), handleBudgetText: f(), handleBallotText: f(), handleFreeText: f(), handlePrefsText: f(),
    emit: f(), answer: f(),
    notifyRaw: f(), markReadSafe: f(), typingOn: f(),
    handleDigitsBallot: f(), upsertDmRoute: f(),
    findPendingHoldGate: f(), getHoldGate: f(),
    getParticipant: f(), currentPlanForUser: f(), newestInvitedPlanForUser: f(),
    findUserByPhone: f(), findUserByPhotonId: f(), setPhotonUserId: f(),
    getPayLink: f(), handleCommand: f(), reply: f(),
    mentionsOthersBudget: f(), otherFirstNames: f(), sendOnlyYours: f(), recentConfirmedPlan: f(),
    converseReply: f(),
    onJoinText: f(), onNameText: f(), handleStartText: f(), hasStartDraft: f(), joinWouldOverfill: f(),
  };
});

vi.mock("../src/delegates/awaiting", () => ({ getAwaiting: m.getAwaiting, clearAwaiting: m.clearAwaiting }));
vi.mock("../src/delegates/budget", () => ({ applyTier: m.applyTier, handleBudgetText: m.handleBudgetText }));
vi.mock("../src/delegates/ballot", () => ({ handleBallotText: m.handleBallotText }));
vi.mock("../src/delegates/free", () => ({
  converseReply: m.converseReply, handleFreeText: m.handleFreeText, mentionsOthersBudget: m.mentionsOthersBudget, otherFirstNames: m.otherFirstNames, sendOnlyYours: m.sendOnlyYours,
}));
vi.mock("../src/delegates/prefs", () => ({ handlePrefsText: m.handlePrefsText }));
vi.mock("../src/events", () => ({ emit: m.emit }));
vi.mock("../src/money/holdGate", () => ({ answer: m.answer }));
vi.mock("../src/notify/notify", () => ({ notifyRaw: m.notifyRaw, replyKey: (id: string, n: number) => `reply:${id}:${n}` }));
vi.mock("../src/notify/presence", () => ({ markReadSafe: m.markReadSafe, typingOn: m.typingOn }));
vi.mock("../src/notify/render", () => ({ usd2: (c: number) => `$${(c / 100).toFixed(2)}` }));
vi.mock("../src/plan/ballots", () => ({ handleDigitsBallot: m.handleDigitsBallot }));
vi.mock("../src/plan/machine", () => {
  const order = ["INVITED", "JOINED", "BUDGET_LOCKED", "PREFS_DONE", "VOTED", "GATED", "LINK_SENT", "HELD", "CAPTURED"];
  return {
    TERMINAL_STAGES: ["RELEASED", "DECLINED"],
    stageAtLeast: (s: string, min: string) => order.includes(s) && order.indexOf(s) >= order.indexOf(min),
  };
});
vi.mock("../src/repo/dmRoutes", () => ({ upsertDmRoute: m.upsertDmRoute }));
vi.mock("../src/repo/holdGates", () => ({ findPendingHoldGate: m.findPendingHoldGate, getHoldGate: m.getHoldGate }));
vi.mock("../src/repo/participants", () => ({
  getParticipant: m.getParticipant, newestInvitedPlanForUser: m.newestInvitedPlanForUser,
}));
vi.mock("../src/repo/plans", () => ({ currentPlanForUser: m.currentPlanForUser, recentConfirmedPlan: m.recentConfirmedPlan }));
vi.mock("../src/repo/users", () => ({ findUserByPhone: m.findUserByPhone, findUserByPhotonId: m.findUserByPhotonId, setPhotonUserId: m.setPhotonUserId }));
vi.mock("../src/repo/payLinks", () => ({ getPayLink: m.getPayLink }));
vi.mock("../src/router/handlers", () => ({ handleCommand: m.handleCommand, reply: m.reply }));
vi.mock("../src/plan/membership", () => ({ onJoinText: m.onJoinText, onNameText: m.onNameText }));
vi.mock("../src/plan/startByChat", () => ({ handleStartText: m.handleStartText, hasStartDraft: m.hasStartDraft }));
vi.mock("../src/join/capacity", () => ({ joinWouldOverfill: m.joinWouldOverfill }));

import { isPrefillText, isStartPrefill, parseCommand } from "../src/router/commands";
import { isQuestion, route } from "../src/router/route";

const user = { id: "u1", first_name: "Ana", phone_e164: "+13105550001", photon_user_id: "pu1", payer_ref: "x" };
const plan = (o: Record<string, unknown> = {}) => ({ id: "p1", code: "4821", title: "Dinner + show", state: "COLLECTING", version: 1, ...o });
const ev = (text: string | null): InboundEvent =>
  ({
    event_id: "ev1", seq: 1, message_id: "msg1", platform: "imessage", from_handle: "+13105550001", from_user_id: "pu1",
    agent_user_id: "ag1", space_id: "sp1", space_kind: "direct", content_type: text === null ? "attachment" : "text", text,
    parent_message_id: null, received_at: "2026-10-17T20:00:00Z",
  }) as InboundEvent;
const lane = (stage: string, planOverrides: Record<string, unknown> = {}) => {
  m.currentPlanForUser.mockResolvedValue(plan(planOverrides));
  m.getParticipant.mockResolvedValue({ stage, lane: 2 });
};

beforeEach(() => {
  for (const fn of Object.values(m)) fn.mockReset();
  m.findUserByPhotonId.mockResolvedValue(user);
  m.recentConfirmedPlan.mockResolvedValue(null);
  m.newestInvitedPlanForUser.mockResolvedValue(null);
  m.otherFirstNames.mockResolvedValue(["Sam"]);
  m.mentionsOthersBudget.mockReturnValue(false);
  m.joinWouldOverfill.mockResolvedValue(false);
  m.hasStartDraft.mockReturnValue(false);
  lane("PREFS_DONE");
});

describe("route", () => {
  it("text-less events are marked read and go no further", async () => {
    await route(ev(null));
    expect(m.markReadSafe).toHaveBeenCalledOnce();
    expect(m.currentPlanForUser).not.toHaveBeenCalled();
    expect(m.handleFreeText).not.toHaveBeenCalled();
  });

  it("intercepts a card number before markRead, typing, commands or any delegate", async () => {
    await route(ev("my card 4111 1111 1111 1111"));
    expect(m.reply).toHaveBeenCalledWith(user, "T_CARD_INTERCEPT", {}, expect.anything(), "p1");
    expect(m.emit).toHaveBeenCalledWith({ type: "system", level: "info", msg: "card number intercepted (lane 2)" });
    for (const f of [m.markReadSafe, m.typingOn, m.handleCommand, m.handleFreeText, m.handleBudgetText, m.handlePrefsText, m.handleBallotText]) {
      expect(f).not.toHaveBeenCalled();
    }
    expect(JSON.stringify([m.emit.mock.calls, m.reply.mock.calls.map((c) => c.slice(0, 3))])).not.toContain("4111");
  });

  it("intercepts a card from an unknown sender without a user row", async () => {
    m.findUserByPhotonId.mockResolvedValue(null);
    m.findUserByPhone.mockResolvedValue(null);
    await route(ev("4111111111111111"));
    expect(m.notifyRaw).toHaveBeenCalledWith(expect.objectContaining({ spaceId: "sp1" }), "T_NOT_IN_PLAN", {}, "reply:msg1:1");
    expect(m.markReadSafe).not.toHaveBeenCalled();
  });

  it("unknown sender: marks read, replies T_NOT_IN_PLAN", async () => {
    m.findUserByPhotonId.mockResolvedValue(null);
    m.findUserByPhone.mockResolvedValue(null);
    await route(ev("hello"));
    expect(m.upsertDmRoute).not.toHaveBeenCalled();
    expect(m.markReadSafe).toHaveBeenCalled();
    expect(m.notifyRaw).toHaveBeenCalledWith({ userId: "pu1", spaceId: "sp1", agentUserId: "ag1" }, "T_NOT_IN_PLAN", {}, "reply:msg1:1");
  });

  it("falls back to phone lookup and records the Photon id", async () => {
    m.findUserByPhotonId.mockResolvedValue(null);
    m.findUserByPhone.mockResolvedValue({ ...user, photon_user_id: null });
    await route(ev("help"));
    expect(m.setPhotonUserId).toHaveBeenCalledWith("u1", "pu1");
    expect(m.upsertDmRoute).toHaveBeenCalledWith({ user_id: "u1", space_id: "sp1", agent_user_id: "ag1", agent_number: null });
    expect(m.handleCommand).toHaveBeenCalledWith(expect.objectContaining({ photon_user_id: "pu1" }), expect.anything(), { kind: "help" }, expect.anything());
  });

  it("commands win over awaiting flags and stage handlers", async () => {
    m.getAwaiting.mockReturnValue("budget");
    await route(ev("status"));
    expect(m.handleCommand).toHaveBeenCalledWith(user, expect.objectContaining({ plan: expect.anything() }), { kind: "status" }, expect.anything());
    expect(m.handleBudgetText).not.toHaveBeenCalled();
  });

  it("passes a null context when the user has declined", async () => {
    lane("DECLINED");
    await route(ev("status"));
    expect(m.handleCommand).toHaveBeenCalledWith(user, null, { kind: "status" }, expect.anything());
  });

  it("awaiting holdgate: yes/no go to holdGate.answer", async () => {
    m.getAwaiting.mockReturnValue("holdgate");
    await route(ev("Yes"));
    expect(m.answer).toHaveBeenCalledWith(expect.anything(), true, expect.anything());
    await route(ev("nope"));
    expect(m.answer).toHaveBeenLastCalledWith(expect.anything(), false, expect.anything());
  });

  it("awaiting holdgate: anything else repeats the question for a pending gate", async () => {
    m.getAwaiting.mockReturnValue("holdgate");
    m.getHoldGate.mockResolvedValue({ status: "pending" });
    m.getPayLink.mockResolvedValue({ amount_cents: 4500 });
    await route(ev("hmm what"));
    expect(m.reply).toHaveBeenCalledWith(user, "T_HOLD_GATE", { amount: "$45.00" }, expect.anything(), "p1");
    expect(m.handleFreeText).not.toHaveBeenCalled();
  });

  it("stale holdgate flag clears and falls through to the stage handler", async () => {
    m.getAwaiting.mockReturnValue("holdgate");
    m.getHoldGate.mockResolvedValue(null);
    await route(ev("hmm what"));
    expect(m.clearAwaiting).toHaveBeenCalledWith("u1");
    expect(m.handleFreeText).toHaveBeenCalled();
  });

  it("after a restart a pending hold gate row stands in for the lost flag", async () => {
    lane("GATED", { state: "APPROVING" });
    m.findPendingHoldGate.mockResolvedValue({ plan_id: "p1" });
    await route(ev("y"));
    expect(m.answer).toHaveBeenCalledWith(expect.anything(), true, expect.anything());
  });

  it("awaiting tiers: 1-4 applies a tier, other text re-parses as a budget", async () => {
    m.getAwaiting.mockReturnValue("tiers");
    await route(ev("3"));
    expect(m.applyTier).toHaveBeenCalledWith(expect.anything(), 3, expect.anything());
    await route(ev("about forty"));
    expect(m.handleBudgetText).toHaveBeenCalledOnce();
  });

  it("awaiting tiers: a question goes to the budget parser with the delegate as the fallback for an unclear parse", async () => {
    lane("LINK_SENT", { state: "APPROVING" });
    m.getAwaiting.mockReturnValue("tiers");
    m.converseReply.mockResolvedValue(true);
    await route(ev("wait what does that mean"));
    expect(m.handleBudgetText).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.any(Function));
    expect(m.converseReply).not.toHaveBeenCalled(); // only once the parse is unclear
    const unclear = m.handleBudgetText.mock.calls[0]![2] as () => Promise<boolean>;
    expect(await unclear()).toBe(true);
    expect(m.converseReply).toHaveBeenCalledWith(user, expect.objectContaining({ plan: expect.objectContaining({ id: "p1" }) }), expect.anything());
    expect(m.clearAwaiting).not.toHaveBeenCalled();
    m.handleBudgetText.mockClear();
    await route(ev("my max is 15 now")); // not a question: unclear → tiers menu as before
    expect(m.handleBudgetText).toHaveBeenCalledWith(expect.anything(), expect.anything(), undefined);
  });

  it("awaiting tiers: yes/no drops the menu and re-reads the flag, so a pending hold gate gets its answer", async () => {
    lane("GATED", { state: "APPROVING" });
    m.getAwaiting.mockReturnValueOnce("tiers").mockReturnValue(null);
    m.findPendingHoldGate.mockResolvedValue({ plan_id: "p1" });
    await route(ev("yes"));
    expect(m.clearAwaiting).toHaveBeenCalledWith("u1");
    expect(m.answer).toHaveBeenCalledWith(expect.anything(), true, expect.anything());
    expect(m.handleBudgetText).not.toHaveBeenCalled();
  });

  it("awaiting tiers: yes/no with no gate falls through to the stage handler", async () => {
    lane("LINK_SENT", { state: "APPROVING" });
    m.getAwaiting.mockReturnValueOnce("tiers").mockReturnValue(null);
    await route(ev("ok"));
    expect(m.clearAwaiting).toHaveBeenCalledWith("u1");
    expect(m.handleBudgetText).not.toHaveBeenCalled();
    expect(m.handleFreeText).toHaveBeenCalledOnce();
  });

  it.each([
    ["wait what does that mean", true], ["huh", true], ["is 1 walkable?", true], ["what's that", true],
    ["my max is 15 now", false], ["about forty", false], ["whatever", false], ["donut", false],
  ])("isQuestion(%j) → %s", (t, q) => expect(isQuestion(t)).toBe(q));

  it("awaiting budget goes to the budget delegate regardless of stage", async () => {
    lane("VOTED", { state: "VOTING" });
    m.getAwaiting.mockReturnValue("budget");
    await route(ev("1 3"));
    expect(m.handleBudgetText).toHaveBeenCalledOnce();
    expect(m.handleDigitsBallot).not.toHaveBeenCalled();
  });

  it.each([
    ["JOINED", "COLLECTING", "I can do $40", "handleBudgetText"],
    ["BUDGET_LOCKED", "COLLECTING", "no seafood", "handlePrefsText"],
    ["PREFS_DONE", "COLLECTING", "random", "handleFreeText"],
    ["PREFS_DONE", "RESEARCHING", "1 3", "handleFreeText"],
    ["PREFS_DONE", "VOTING", "the first one", "handleBallotText"],
    ["VOTED", "VOTING", "actually the second", "handleBallotText"],
    ["GATED", "APPROVING", "ok cool", "handleFreeText"],
    // Ordinary chat in every stage reaches a delegate (free → conversational delegate; VOTING → ballot, which converses on non-votes).
    ["PREFS_DONE", "COLLECTING", "ok thanks!", "handleFreeText"],
    ["PREFS_DONE", "RESEARCHING", "what's next?", "handleFreeText"],
    ["VOTED", "VOTING", "thanks!!", "handleBallotText"],
    ["HELD", "APPROVING", "when do we eat", "handleFreeText"],
    ["CAPTURED", "CONFIRMED", "yay", "handleFreeText"],
  ] as const)("stage %s in %s: %j goes to %s", async (stage, state, text, expected) => {
    lane(stage, { state });
    await route(ev(text));
    expect(m[expected]).toHaveBeenCalledOnce();
  });

  it("digits ballot in VOTING", async () => {
    lane("PREFS_DONE", { state: "VOTING" });
    await route(ev("1, 3"));
    expect(m.handleDigitsBallot).toHaveBeenCalledWith(expect.anything(), [1, 3], expect.anything());
    expect(m.handleBallotText).not.toHaveBeenCalled();
  });

  it("commands get no typing bubble (a fast template reply could land before it); LLM-backed text does", async () => {
    await route(ev("status"));
    expect(m.typingOn).not.toHaveBeenCalled();
    await route(ev("ok thanks!"));
    expect(m.typingOn).toHaveBeenCalledOnce();
  });

  it("after capture: no active plan falls back to today's CONFIRMED plan, so 'status' and questions keep their context", async () => {
    m.currentPlanForUser.mockResolvedValue(null);
    m.recentConfirmedPlan.mockResolvedValue({ id: "p9", state: "CONFIRMED", version: 3, event_date: "2026-10-18" });
    m.getParticipant.mockResolvedValue({ stage: "CAPTURED", lane: 1 });
    m.getAwaiting.mockReturnValue("budget"); // a leftover flag must not reopen the budget step
    await route(ev("status"));
    expect(m.handleCommand).toHaveBeenCalledWith(user, expect.objectContaining({ plan: expect.objectContaining({ id: "p9" }) }), { kind: "status" }, expect.anything());
    await route(ev("what time is dinner?"));
    expect(m.handleFreeText).toHaveBeenCalledWith(user, expect.objectContaining({ plan: expect.objectContaining({ id: "p9" }) }), expect.anything());
    expect(m.handleBudgetText).not.toHaveBeenCalled();
    expect(m.clearAwaiting).toHaveBeenCalledWith("u1");
    expect(m.recentConfirmedPlan).toHaveBeenCalledWith("u1");
  });

  it("after a lost share.captured: a HELD lane in the CONFIRMED plan keeps the booked-plan context too", async () => {
    m.currentPlanForUser.mockResolvedValue(null);
    m.recentConfirmedPlan.mockResolvedValue({ id: "p9", state: "CONFIRMED", version: 3, event_date: "2026-10-18" });
    m.getParticipant.mockResolvedValue({ stage: "HELD", lane: 1 });
    await route(ev("what's the plan?"));
    expect(m.handleFreeText).toHaveBeenCalledWith(user, expect.objectContaining({ plan: expect.objectContaining({ id: "p9" }) }), expect.anything());
  });

  it("no recent CONFIRMED plan (the repo applies the date window and plan state): the start chat", async () => {
    m.currentPlanForUser.mockResolvedValue(null);
    m.recentConfirmedPlan.mockResolvedValue(null);
    await route(ev("hi"));
    expect(m.handleStartText).toHaveBeenCalledWith(user, expect.anything()); // no plan context: the start chat
    expect(m.handleFreeText).not.toHaveBeenCalled();
  });

  it.each([
    ["JOINED", null],
    ["BUDGET_LOCKED", null],
    ["VOTED", "budget"],
  ] as const)("a question about another member's budget at %s (flag %s) gets T_ONLY_YOURS; the step stays open", async (stage, flag) => {
    lane(stage, { state: flag ? "VOTING" : "COLLECTING" });
    m.getAwaiting.mockReturnValue(flag);
    m.mentionsOthersBudget.mockReturnValue(true);
    await route(ev("what's Sam's budget?"));
    expect(m.mentionsOthersBudget).toHaveBeenCalledWith("what's Sam's budget?", ["Sam"]);
    expect(m.sendOnlyYours).toHaveBeenCalledWith("u1", "p1", expect.anything());
    for (const f of [m.handleBudgetText, m.handlePrefsText, m.handleFreeText]) expect(f).not.toHaveBeenCalled();
  });

  it("no active lane: the text goes to start-by-chat (plan creation), not the free delegate", async () => {
    m.currentPlanForUser.mockResolvedValue(null);
    await route(ev("Hey SquadTab! Help me plan a night out."));
    expect(m.handleStartText).toHaveBeenCalledWith(user, expect.objectContaining({ message_id: "msg1" }));
    expect(m.handleFreeText).not.toHaveBeenCalled();
    expect(m.typingOn).toHaveBeenCalledOnce(); // the start chat calls the LLM (parsePlanDraft)
  });

  it("a declined user with no other plan also starts by chat", async () => {
    lane("DECLINED");
    await route(ev("santa monica tonight, 4 of us"));
    expect(m.handleStartText).toHaveBeenCalledOnce();
  });
});

describe("forgiving first message (ux-flow §8.1)", () => {
  beforeEach(() => lane("INVITED"));

  it.each(["hey", "I'm in for Dinner + show!", "Hey SquadTab! Let's get planning.", "help", "status", "JOIN 4821", "join #4821 please"])(
    "INVITED + %j joins the current plan",
    async (text) => {
      await route(ev(text));
      expect(m.onJoinText).toHaveBeenCalledWith(user, "4821", expect.objectContaining({ message_id: "msg1" }));
      expect(m.handleCommand).not.toHaveBeenCalled();
      expect(m.handleFreeText).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["I'm out", { kind: "out" }],
    ["stop", { kind: "out" }],
    ["forget me", { kind: "forget_me" }],
    ["join 9999", { kind: "join", code: "9999" }],
  ])("INVITED + %j still runs as a command", async (text, cmd) => {
    await route(ev(text));
    expect(m.handleCommand).toHaveBeenCalledWith(user, expect.objectContaining({ plan: expect.anything() }), cmd, expect.anything());
    expect(m.onJoinText).not.toHaveBeenCalled();
  });

  it.each(["hey", "JOIN 4821"])("INVITED + %j into a plan with 8 texted lanes → T_PLAN_FULL, no join, no typing", async (text) => {
    m.joinWouldOverfill.mockResolvedValue(true);
    await route(ev(text));
    expect(m.joinWouldOverfill).toHaveBeenCalledWith(user, "4821");
    expect(m.reply).toHaveBeenCalledWith(user, "T_PLAN_FULL", {}, expect.objectContaining({ message_id: "msg1" }));
    expect(m.onJoinText).not.toHaveBeenCalled();
    expect(m.typingOn).not.toHaveBeenCalled();
  });

  it("the card intercept still runs before the forgiving join", async () => {
    await route(ev("4111 1111 1111 1111"));
    expect(m.reply).toHaveBeenCalledWith(user, "T_CARD_INTERCEPT", {}, expect.anything(), "p1");
    expect(m.onJoinText).not.toHaveBeenCalled();
  });

  it("a JOINED member's text is not a join", async () => {
    lane("JOINED");
    await route(ev("hey"));
    expect(m.onJoinText).not.toHaveBeenCalled();
    expect(m.handleBudgetText).toHaveBeenCalledOnce();
  });
});

describe("first text after a web /join (INVITED lane, no live lane)", () => {
  const START = "Hey SquadTab! Help me plan a night out.";
  // The real currentPlanForUser never returns a plan where the lane is INVITED (repo/plans.ts), so the /join lane is
  // found only by newestInvitedPlanForUser.
  const invited = (o: Record<string, unknown> = {}) => {
    m.currentPlanForUser.mockResolvedValue(null);
    m.newestInvitedPlanForUser.mockResolvedValue(plan(o));
    m.getParticipant.mockResolvedValue({ stage: "INVITED", lane: 3 });
  };
  beforeEach(() => invited());

  it.each(["hey", "I'm in for Dinner + show!", "Hey SquadTab! Let's get planning.", "status", "JOIN 4821"])(
    "%j joins the invited plan instead of starting a new one",
    async (text) => {
      await route(ev(text));
      expect(m.newestInvitedPlanForUser).toHaveBeenCalledWith("u1");
      expect(m.joinWouldOverfill).toHaveBeenCalledWith(user, "4821");
      expect(m.onJoinText).toHaveBeenCalledWith(user, "4821", expect.objectContaining({ message_id: "msg1" }));
      for (const f of [m.handleStartText, m.handleCommand, m.handleFreeText, m.handleBudgetText]) expect(f).not.toHaveBeenCalled();
    },
  );

  it("8 texted lanes already in → T_PLAN_FULL, the lane stays INVITED", async () => {
    m.joinWouldOverfill.mockResolvedValue(true);
    await route(ev("hey"));
    expect(m.reply).toHaveBeenCalledWith(user, "T_PLAN_FULL", {}, expect.objectContaining({ message_id: "msg1" }));
    expect(m.onJoinText).not.toHaveBeenCalled();
    expect(m.handleStartText).not.toHaveBeenCalled();
  });

  it.each([
    ["I'm out", { kind: "out" }],
    ["forget me", { kind: "forget_me" }],
    ["join 9999", { kind: "join", code: "9999" }],
  ])("%j still runs as a command, against the invited lane", async (text, cmd) => {
    await route(ev(text));
    expect(m.handleCommand).toHaveBeenCalledWith(user, expect.objectContaining({ plan: expect.objectContaining({ code: "4821" }) }), cmd, expect.anything());
    expect(m.onJoinText).not.toHaveBeenCalled();
  });

  it("the /start pre-fill starts the sender's own plan; an old invite is not looked up", async () => {
    await route(ev(START));
    expect(m.newestInvitedPlanForUser).not.toHaveBeenCalled();
    expect(m.handleStartText).toHaveBeenCalledWith(user, expect.anything());
    expect(m.onJoinText).not.toHaveBeenCalled();
  });

  it("a live lane in an active plan wins: the invite is never looked up", async () => {
    lane("JOINED");
    await route(ev("hey"));
    expect(m.newestInvitedPlanForUser).not.toHaveBeenCalled();
    expect(m.onJoinText).not.toHaveBeenCalled();
    expect(m.handleBudgetText).toHaveBeenCalledOnce();
  });

  it("a member who declined their active plan can still join the plan they were invited to", async () => {
    m.currentPlanForUser.mockResolvedValue(plan({ id: "p0", code: "1111" }));
    m.getParticipant.mockImplementation(async (planId: string) => (planId === "p0" ? { stage: "DECLINED", lane: 1 } : { stage: "INVITED", lane: 3 }));
    await route(ev("hey"));
    expect(m.onJoinText).toHaveBeenCalledWith(user, "4821", expect.anything());
  });

  it("booked last night, planning again: the /start pre-fill and the start chat after it skip the CONFIRMED plan", async () => {
    m.recentConfirmedPlan.mockResolvedValue({ id: "p9", state: "CONFIRMED", version: 3, event_date: "2026-10-18" });
    m.newestInvitedPlanForUser.mockResolvedValue(null);
    await route(ev("Hey SquadTab! Help me plan a night out."));
    expect(m.handleStartText).toHaveBeenCalledTimes(1);
    expect(m.recentConfirmedPlan).not.toHaveBeenCalled();
    m.hasStartDraft.mockReturnValue(true); // T_START_HELLO went out: the description continues the start chat
    await route(ev("Ana here! Westwood tonight, 3 of us"));
    expect(m.handleStartText).toHaveBeenCalledTimes(2);
    expect(m.handleCommand).not.toHaveBeenCalled(); // not T_STATUS for last night's plan
    expect(m.handleFreeText).not.toHaveBeenCalled();
    expect(m.recentConfirmedPlan).not.toHaveBeenCalled();
  });

  it("a pending invite still wins over a start chat under way (an abandoned draft never blocks a friend's invite)", async () => {
    m.hasStartDraft.mockReturnValue(true);
    await route(ev("hey"));
    expect(m.onJoinText).toHaveBeenCalledWith(user, "4821", expect.anything());
    expect(m.handleStartText).not.toHaveBeenCalled();
  });

  it("a pending invite wins over yesterday's CONFIRMED plan", async () => {
    m.recentConfirmedPlan.mockResolvedValue({ id: "p9", state: "CONFIRMED", version: 3, event_date: "2026-10-18" });
    await route(ev("I'm in for Dinner + show!"));
    expect(m.onJoinText).toHaveBeenCalledWith(user, "4821", expect.anything());
    expect(m.handleFreeText).not.toHaveBeenCalled();
  });

  it("no invite either: the start chat, as before", async () => {
    m.newestInvitedPlanForUser.mockResolvedValue(null);
    await route(ev("hey"));
    expect(m.handleStartText).toHaveBeenCalledWith(user, expect.anything());
    expect(m.onJoinText).not.toHaveBeenCalled();
  });

  it("isStartPrefill matches only the /start sentence", () => {
    for (const t of [START, "hey squadtab help me plan a night out", "Hey SquadTab, help me plan a night out!"]) expect(isStartPrefill(t)).toBe(true);
    for (const t of ["Hey SquadTab! Let's get planning.", "Hey SquadTab, where are we at?", "help me plan a night out", "hey"]) expect(isStartPrefill(t)).toBe(false);
  });
});

describe("a question at the first budget ask (JOINED, no menu yet)", () => {
  const Q = "wait, why do you need my budget?";
  beforeEach(() => lane("JOINED"));
  const unclearOf = () => m.handleBudgetText.mock.calls[0]![2] as (() => Promise<boolean>) | undefined;

  it("goes to the budget parser first, with the delegate + budget re-ask as the fallback (not the tiers menu)", async () => {
    m.converseReply.mockResolvedValue(true);
    await route(ev(Q));
    expect(m.handleBudgetText).toHaveBeenCalledWith(expect.objectContaining({ plan: expect.objectContaining({ id: "p1" }) }), expect.anything(), expect.any(Function));
    expect(m.converseReply).not.toHaveBeenCalled(); // a budget-shaped answer still parses: the fallback runs only if it didn't
    expect(await unclearOf()!()).toBe(true);
    expect(m.converseReply).toHaveBeenCalledWith(user, expect.objectContaining({ plan: expect.objectContaining({ id: "p1" }) }), expect.objectContaining({ text: Q }), { mode: "budget_question" });
    expect(m.reply).toHaveBeenCalledWith(user, "T_BUDGET_REASK", {}, expect.objectContaining({ message_id: "msg1" }), "p1", 2);
    expect(m.reply.mock.invocationCallOrder[0]).toBeGreaterThan(m.converseReply.mock.invocationCallOrder[0]!);
  });

  it.each(["why do you need that", "what's this for?", "how does this work", "who sees it", "when do we go", "can I skip this", "do I have to", "is it private"])(
    "%j counts as a question",
    async (text) => {
      await route(ev(text));
      expect(unclearOf()).toEqual(expect.any(Function));
    },
  );

  it.each(["I can do $40", "around forty", "40 max", "whatever's cheap"])("%j is a budget answer: no delegate fallback", async (text) => {
    await route(ev(text));
    expect(m.handleBudgetText).toHaveBeenCalledWith(expect.anything(), expect.anything(), undefined);
  });

  it("no usable delegate answer (mock LLM, blocked reply) → false, so the tiers menu goes out; no re-ask", async () => {
    m.converseReply.mockResolvedValue(false);
    await route(ev(Q));
    expect(await unclearOf()!()).toBe(false);
    expect(m.reply).not.toHaveBeenCalled();
  });

  it("the delegate's dispatch already asked (change budget / menu set a flag) → no second ask", async () => {
    m.converseReply.mockImplementation(async () => {
      m.getAwaiting.mockReturnValue("budget");
      return true;
    });
    await route(ev("can I change my budget later?"));
    expect(await unclearOf()!()).toBe(true);
    expect(m.reply).not.toHaveBeenCalled();
  });

  it("a question in place of the name gets the same fallback", async () => {
    m.findUserByPhotonId.mockResolvedValue({ ...user, first_name: "" });
    m.getAwaiting.mockReturnValueOnce("name").mockReturnValue(null);
    await route(ev("who is this?"));
    expect(m.onNameText).not.toHaveBeenCalled();
    expect(unclearOf()).toEqual(expect.any(Function));
  });

  it("under the tiers menu nothing changes: the delegate answers and the menu stays open (no re-ask)", async () => {
    m.getAwaiting.mockReturnValue("tiers");
    m.converseReply.mockResolvedValue(true);
    await route(ev(Q));
    expect(await unclearOf()!()).toBe(true);
    expect(m.reply).not.toHaveBeenCalled();
  });
});

describe("pre-filled first texts from a member already in the plan (ux-flow §3.3)", () => {
  const START = "Hey SquadTab! Help me plan a night out.";
  const STATUS = "Hey SquadTab, where are we at?";
  const expectStatusOnly = () => {
    expect(m.handleCommand).toHaveBeenCalledWith(user, expect.objectContaining({ plan: expect.anything() }), { kind: "status" }, expect.anything());
    for (const f of [m.handleBudgetText, m.handlePrefsText, m.handleBallotText, m.handleFreeText, m.applyTier, m.onJoinText, m.handleStartText]) {
      expect(f).not.toHaveBeenCalled();
    }
  };

  it.each([
    ["BUDGET_LOCKED", "COLLECTING", START],
    ["BUDGET_LOCKED", "COLLECTING", "I'm in for Dinner + show!"],
    ["JOINED", "COLLECTING", STATUS],
    ["JOINED", "COLLECTING", "Hey SquadTab! Let's get planning."],
    ["PREFS_DONE", "VOTING", "I’m in!"],
    ["VOTED", "VOTING", STATUS],
  ] as const)("%s in %s + %j → status reply, no stage handler", async (stage, state, text) => {
    lane(stage, { state });
    await route(ev(text));
    expectStatusOnly();
  });

  it("wins over an awaiting tiers flag and leaves the flag for the real answer", async () => {
    lane("JOINED");
    m.getAwaiting.mockReturnValue("tiers");
    await route(ev(STATUS));
    expectStatusOnly();
    expect(m.clearAwaiting).not.toHaveBeenCalled();
  });

  it("a real preference that starts like the friend pre-fill is still a preference", async () => {
    lane("BUDGET_LOCKED");
    await route(ev("I'm in for sushi"));
    expect(m.handlePrefsText).toHaveBeenCalledOnce();
    expect(m.handleCommand).not.toHaveBeenCalled();
  });

  it("isPrefillText matches only the exact pre-fills, ignoring case and punctuation", () => {
    for (const t of [START, "hey squadtab help me plan a night out", STATUS, "HEY SQUADTAB WHERE ARE WE AT", "Hey SquadTab! Let’s get planning.", "I'm in!", "im in", "I'm in for dinner + show."]) {
      expect(isPrefillText(t, "Dinner + show")).toBe(true);
    }
    for (const t of ["hey", "help me plan a night out", "where are we at", "I'm in for sushi", "I'm in for Dinner + comedy show!", "I'm out", "40 max"]) {
      expect(isPrefillText(t, "Dinner + show")).toBe(false);
    }
    expect(isPrefillText("I'm in for Dinner + comedy show!", "Dinner + comedy show")).toBe(true);
  });
});

describe("name step (ux-flow §8.2)", () => {
  const blank = { ...user, first_name: "" };
  beforeEach(() => {
    m.findUserByPhotonId.mockResolvedValue(blank);
    lane("JOINED");
  });

  it("awaiting name + a name → onNameText with the parsed name, and the flag is cleared", async () => {
    m.getAwaiting.mockReturnValue("name");
    await route(ev("it's leo!"));
    expect(m.clearAwaiting).toHaveBeenCalledWith("u1");
    expect(m.onNameText).toHaveBeenCalledWith(expect.objectContaining({ user: blank }), "Leo", expect.anything());
    expect(m.handleBudgetText).not.toHaveBeenCalled();
  });

  it.each(["40 max", "maybe sixty", "around forty", "no idea", "$50"])("awaiting name + %j → the budget path, name untouched", async (text) => {
    m.getAwaiting.mockReturnValue("name");
    await route(ev(text));
    expect(m.clearAwaiting).toHaveBeenCalledWith("u1");
    expect(m.handleBudgetText).toHaveBeenCalledOnce();
    expect(m.onNameText).not.toHaveBeenCalled();
  });

  it("a blank-name organizer answering the budget ask without the flag goes to the budget path", async () => {
    m.getAwaiting.mockReturnValue(null);
    await route(ev("maybe sixty"));
    expect(m.handleBudgetText).toHaveBeenCalledOnce();
    expect(m.onNameText).not.toHaveBeenCalled();
  });

  it("a blank name alone never triggers the name step (no flag, a name-like text → budget)", async () => {
    m.getAwaiting.mockReturnValue(null);
    await route(ev("Leo"));
    expect(m.onNameText).not.toHaveBeenCalled();
    expect(m.handleBudgetText).toHaveBeenCalledOnce();
  });

  it("a stale name flag past JOINED clears and falls through to the stage handler", async () => {
    lane("BUDGET_LOCKED");
    m.getAwaiting.mockReturnValue("name");
    await route(ev("no seafood"));
    expect(m.clearAwaiting).toHaveBeenCalledWith("u1");
    expect(m.handlePrefsText).toHaveBeenCalledOnce();
    expect(m.onNameText).not.toHaveBeenCalled();
  });
});

describe("join regex (loosened)", () => {
  it.each([
    ["JOIN 4821", "4821"],
    ["join #4821", "4821"],
    ["Join 4821 please", "4821"],
    ["hey! join4821", "4821"],
    ["I'm in, JOIN #0042.", "0042"],
  ])("%j → join %s", (text, code) => {
    expect(parseCommand(text)).toEqual({ kind: "join", code });
  });

  it.each(["join 12", "join 12345", "join", "joining 4821", "rejoin 4821", "I'll join later"])("%j is not a join", (text) => {
    expect(parseCommand(text)?.kind).not.toBe("join");
  });
});
