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
    getParticipant: f(), currentPlanForUser: f(),
    findUserByPhone: f(), findUserByPhotonId: f(), setPhotonUserId: f(),
    getPayLink: f(), handleCommand: f(), reply: f(),
    mentionsOthersBudget: f(), otherFirstNames: f(), sendOnlyYours: f(), capturedPlanIdsForUser: f(), getPlan: f(),
    converseReply: f(),
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
vi.mock("../src/repo/participants", () => ({ getParticipant: m.getParticipant, capturedPlanIdsForUser: m.capturedPlanIdsForUser }));
vi.mock("../src/repo/plans", () => ({ currentPlanForUser: m.currentPlanForUser, getPlan: m.getPlan }));
vi.mock("../src/repo/users", () => ({ findUserByPhone: m.findUserByPhone, findUserByPhotonId: m.findUserByPhotonId, setPhotonUserId: m.setPhotonUserId }));
vi.mock("../src/repo/payLinks", () => ({ getPayLink: m.getPayLink }));
vi.mock("../src/router/handlers", () => ({ handleCommand: m.handleCommand, reply: m.reply }));

import { isQuestion, laDate, route } from "../src/router/route";

const user = { id: "u1", first_name: "Ana", phone_e164: "+13105550001", photon_user_id: "pu1", payer_ref: "x" };
const plan = (o: Record<string, unknown> = {}) => ({ id: "p1", state: "COLLECTING", version: 1, ...o });
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
  m.capturedPlanIdsForUser.mockResolvedValue([]);
  m.otherFirstNames.mockResolvedValue(["Sam"]);
  m.mentionsOthersBudget.mockReturnValue(false);
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
    ["INVITED", "COLLECTING", "random", "handleFreeText"],
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
    m.capturedPlanIdsForUser.mockResolvedValue(["p9", "p8"]);
    m.getPlan.mockResolvedValue({ id: "p9", state: "CONFIRMED", version: 3, event_date: laDate(0) });
    m.getParticipant.mockResolvedValue({ stage: "CAPTURED", lane: 1 });
    m.getAwaiting.mockReturnValue("budget"); // a leftover flag must not reopen the budget step
    await route(ev("status"));
    expect(m.handleCommand).toHaveBeenCalledWith(user, expect.objectContaining({ plan: expect.objectContaining({ id: "p9" }) }), { kind: "status" }, expect.anything());
    await route(ev("what time is dinner?"));
    expect(m.handleFreeText).toHaveBeenCalledWith(user, expect.objectContaining({ plan: expect.objectContaining({ id: "p9" }) }), expect.anything());
    expect(m.handleBudgetText).not.toHaveBeenCalled();
    expect(m.clearAwaiting).toHaveBeenCalledWith("u1");
    expect(m.getPlan).toHaveBeenCalledWith("p9");
  });

  it.each([
    ["an old CONFIRMED plan", { id: "p9", state: "CONFIRMED", event_date: "2020-01-01" }],
    ["a CANCELLED plan", { id: "p9", state: "CANCELLED", event_date: laDate(0) }],
  ])("no fallback context for %s", async (_name, p) => {
    m.currentPlanForUser.mockResolvedValue(null);
    m.capturedPlanIdsForUser.mockResolvedValue(["p9"]);
    m.getPlan.mockResolvedValue(p);
    await route(ev("hi"));
    expect(m.handleFreeText).toHaveBeenCalledWith(user, null, expect.anything());
  });

  it("laDate: LA calendar date, shifted by days", () => {
    expect(laDate(0, new Date("2026-10-18T06:30:00Z"))).toBe("2026-10-17"); // 11:30 PM Saturday in LA
    expect(laDate(-1, new Date("2026-10-18T08:00:00Z"))).toBe("2026-10-17");
    expect(laDate(-1, new Date("2026-03-01T20:00:00Z"))).toBe("2026-02-28");
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

  it("no active lane: free text with a null context", async () => {
    m.currentPlanForUser.mockResolvedValue(null);
    await route(ev("hi"));
    expect(m.handleFreeText).toHaveBeenCalledWith(user, null, expect.anything());
  });
});
