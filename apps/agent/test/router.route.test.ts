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
    onJoinText: f(), onNameText: f(), handleStartText: f(),
  };
});

vi.mock("../src/delegates/awaiting", () => ({ getAwaiting: m.getAwaiting, clearAwaiting: m.clearAwaiting }));
vi.mock("../src/delegates/budget", () => ({ applyTier: m.applyTier, handleBudgetText: m.handleBudgetText }));
vi.mock("../src/delegates/ballot", () => ({ handleBallotText: m.handleBallotText }));
vi.mock("../src/delegates/free", () => ({ handleFreeText: m.handleFreeText }));
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
vi.mock("../src/repo/participants", () => ({ getParticipant: m.getParticipant }));
vi.mock("../src/repo/plans", () => ({ currentPlanForUser: m.currentPlanForUser }));
vi.mock("../src/repo/users", () => ({ findUserByPhone: m.findUserByPhone, findUserByPhotonId: m.findUserByPhotonId, setPhotonUserId: m.setPhotonUserId }));
vi.mock("../src/repo/payLinks", () => ({ getPayLink: m.getPayLink }));
vi.mock("../src/router/handlers", () => ({ handleCommand: m.handleCommand, reply: m.reply }));
vi.mock("../src/plan/membership", () => ({ onJoinText: m.onJoinText, onNameText: m.onNameText }));
vi.mock("../src/plan/startByChat", () => ({ handleStartText: m.handleStartText }));

import { isPrefillText, parseCommand } from "../src/router/commands";
import { route } from "../src/router/route";

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

  it("unknown sender: marks read, shows typing, replies T_NOT_IN_PLAN", async () => {
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

  it("no active lane: the text goes to start-by-chat (plan creation), not the free delegate", async () => {
    m.currentPlanForUser.mockResolvedValue(null);
    await route(ev("Hey SquadTab! Help me plan a night out."));
    expect(m.handleStartText).toHaveBeenCalledWith(user, expect.objectContaining({ message_id: "msg1" }));
    expect(m.handleFreeText).not.toHaveBeenCalled();
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
