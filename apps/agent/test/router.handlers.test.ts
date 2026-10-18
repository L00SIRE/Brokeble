import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InboundEvent } from "@tab/shared";

const m = vi.hoisted(() => {
  const order: string[] = [];
  const rec = (name: string) => vi.fn(async () => void order.push(name));
  return {
    order,
    notify: vi.fn(async (_u: string, id: string, _v?: unknown, _o?: unknown) => (order.push(`notify:${id}`), "sent")),
    cancelResearch: rec("cancelResearch"), setAwaiting: rec("setAwaiting"), clearAwaiting: rec("clearAwaiting"),
    releaseSeat: rec("releaseSeat"), fanout: rec("fanout"), stopPlanTyping: rec("stopPlanTyping"),
    cancel: rec("cancel"), transition: vi.fn(), onGo: rec("onGo"), onJoinText: rec("onJoinText"), onOut: rec("onOut"), onWait: rec("onWait"),
    getOrder: vi.fn(), getPlan: vi.fn(),
    countByStage: vi.fn(), capturedPlanIdsForUser: vi.fn(), getParticipant: vi.fn(), beginStartChat: rec("beginStartChat"), joinWouldOverfill: vi.fn(async () => false),
    begin: vi.fn(),
    del: {
      privateConstraints: rec("pc"), prefs: rec("prefs"), ratings: rec("ratings"), ballots: rec("ballots"),
      holdGates: rec("holdGates"), payLinks: rec("payLinks"), dmRoute: rec("dmRoute"), scrub: rec("scrub"),
    },
  };
});

vi.mock("../src/creao/research", () => ({ cancelResearch: m.cancelResearch }));
vi.mock("../src/delegates/awaiting", () => ({ setAwaiting: m.setAwaiting, clearAwaiting: m.clearAwaiting }));
vi.mock("../src/db", () => ({ sql: { begin: m.begin } }));
vi.mock("../src/join/seats", () => ({ releaseSeat: m.releaseSeat }));
vi.mock("../src/join/capacity", () => ({ joinWouldOverfill: m.joinWouldOverfill }));
vi.mock("../src/notify/fanout", () => ({ fanout: m.fanout }));
vi.mock("../src/notify/notify", () => ({ notify: m.notify, replyKey: (id: string, n: number) => `reply:${id}:${n}` }));
vi.mock("../src/notify/presence", () => ({ stopPlanTyping: m.stopPlanTyping }));
vi.mock("../src/notify/render", () => ({ fmtDate: () => "Sat, Oct 17", usd2: (c: number) => (c / 100).toFixed(2) })); // like the real one: no "$"
vi.mock("../src/plan/cancel", () => ({ cancel: m.cancel }));
vi.mock("../src/plan/machine", () => {
  const order = ["INVITED", "JOINED", "BUDGET_LOCKED", "PREFS_DONE", "VOTED", "GATED", "LINK_SENT", "HELD", "CAPTURED"];
  return {
    STAGE_ORDER: order,
    stageAtLeast: (s: string, min: string) => order.includes(s) && order.indexOf(s) >= order.indexOf(min),
    transition: m.transition,
  };
});
vi.mock("../src/plan/membership", () => ({ onGo: m.onGo, onJoinText: m.onJoinText, onOut: m.onOut, onWait: m.onWait }));
vi.mock("../src/ports", () => ({ ports: { venue: { getOrder: m.getOrder } } }));
vi.mock("../src/repo/ballots", () => ({ deleteBallotsForUser: m.del.ballots }));
vi.mock("../src/repo/dmRoutes", () => ({ deleteDmRoute: m.del.dmRoute }));
vi.mock("../src/repo/holdGates", () => ({ deleteHoldGatesForUser: m.del.holdGates }));
vi.mock("../src/repo/participants", () => ({ countByStage: m.countByStage, capturedPlanIdsForUser: m.capturedPlanIdsForUser, getParticipant: m.getParticipant }));
vi.mock("../src/plan/startByChat", () => ({ beginStartChat: m.beginStartChat }));
vi.mock("../src/repo/payLinks", () => ({ deletePayLinksForUser: m.del.payLinks }));
vi.mock("../src/repo/plans", () => ({
  getPlan: m.getPlan,
  ACTIVE_STATES: ["COLLECTING", "RESEARCHING", "VOTING", "ORDERING", "APPROVING", "COMMITTING", "CANCELLING"],
}));
vi.mock("../src/repo/preferences", () => ({ deletePreferencesForUser: m.del.prefs }));
vi.mock("../src/repo/privateConstraints", () => ({ deleteForUser: m.del.privateConstraints }));
vi.mock("../src/repo/ratings", () => ({ deleteRatingsForUser: m.del.ratings }));
vi.mock("../src/repo/users", () => ({ scrubUser: m.del.scrub }));

import { forgetMe, handleCommand, phaseText, sendAlreadyInPlan, sendReceipts, sendStatus } from "../src/router/handlers";

const user = { id: "u1", payer_ref: "ref1", first_name: "Ana" } as never;
const ev = { message_id: "msg1" } as InboundEvent;
const ctx = (stage = "PREFS_DONE", p: Record<string, unknown> = {}) =>
  ({ user, plan: { id: "p1", title: "Friday night", state: "COLLECTING", organizer_id: "org", party_target: 4, version: 1, ...p }, participant: { stage } }) as never;
const sentIds = () => m.notify.mock.calls.map((c) => c[1]);

beforeEach(() => {
  vi.clearAllMocks();
  m.order.length = 0;
  m.begin.mockImplementation(async (f: (tx: unknown) => Promise<void>) => {
    m.order.push("tx:start");
    await f("tx");
    m.order.push("tx:end");
  });
});

describe("phaseText", () => {
  const by = { JOINED: 1, PREFS_DONE: 1, VOTED: 2, HELD: 1, CAPTURED: 1 };
  it("is built from counts only", () => {
    expect(phaseText("COLLECTING", by, 6)).toBe("waiting on friends (5 of 6 ready)");
    expect(phaseText("VOTING", by, 6)).toBe("4 of 5 voted");
    expect(phaseText("APPROVING", by, 6)).toBe("waiting on holds (2 of 4 in)");
    expect(phaseText("CONFIRMED", {}, 4)).toBe("confirmed");
  });
});

describe("handleCommand", () => {
  const cmd = (kind: string, c: unknown) => handleCommand(user, c as never, { kind } as never, ev);

  it("status replies T_STATUS with the phase, threaded under the inbound", async () => {
    m.countByStage.mockResolvedValue({ PREFS_DONE: 2 });
    await sendStatus(ctx(), ev);
    expect(m.notify).toHaveBeenCalledWith("u1", "T_STATUS", { title: "Friday night", phase: "waiting on friends (2 of 4 ready)" }, { key: "reply:msg1:1", replyTo: "msg1", planId: "p1" });
  });

  it("plan commands without a plan reply T_NOT_IN_PLAN; plan-free ones do not need a context", async () => {
    for (const k of ["status", "out", "go", "wait", "cancel_plan", "change_budget"]) await cmd(k, null);
    expect(sentIds()).toEqual(Array(6).fill("T_NOT_IN_PLAN"));
    m.notify.mockClear();
    await cmd("help", null);
    expect(sentIds()).toEqual(["T_HELP"]);
  });

  it("routes join, out, go, wait to membership", async () => {
    await handleCommand(user, null, { kind: "join", code: "4821" }, ev);
    expect(m.onJoinText).toHaveBeenCalledWith(user, "4821", ev);
    const c = ctx();
    await cmd("out", c);
    expect(m.onOut).toHaveBeenCalledWith(c, ev, "member_out");
    await cmd("go", c);
    await cmd("wait", c);
    expect(m.onGo).toHaveBeenCalled();
    expect(m.onWait).toHaveBeenCalled();
  });

  it("JOIN that would confirm a 9th lane replies T_PLAN_FULL and never reaches membership", async () => {
    m.joinWouldOverfill.mockResolvedValueOnce(true);
    await handleCommand(user, null, { kind: "join", code: "4821" }, ev);
    expect(m.joinWouldOverfill).toHaveBeenCalledWith(user, "4821");
    expect(m.onJoinText).not.toHaveBeenCalled();
    expect(m.notify).toHaveBeenCalledWith("u1", "T_PLAN_FULL", {}, { key: "reply:msg1:1", replyTo: "msg1" });
  });

  it("after capture every plan command answers with T_STATUS: nothing can be undone", async () => {
    m.countByStage.mockResolvedValue({ CAPTURED: 3 });
    const c = ctx("CAPTURED", { state: "CONFIRMED", organizer_id: "u1" });
    for (const k of ["status", "out", "go", "wait", "cancel_plan", "change_budget"]) await cmd(k, c);
    expect(sentIds()).toEqual(Array(6).fill("T_STATUS"));
    expect(m.notify.mock.calls[0]![2]).toEqual({ title: "Friday night", phase: "confirmed" });
    for (const f of [m.onOut, m.onGo, m.onWait, m.cancel, m.transition, m.setAwaiting]) expect(f).not.toHaveBeenCalled();
  });

  it("remove card is T_HELP (nothing can forget a payer at the venue)", async () => {
    await cmd("remove_card", ctx());
    expect(sentIds()).toEqual(["T_HELP"]);
  });

  describe("cancel plan", () => {
    it("is organizer only", async () => {
      await cmd("cancel_plan", ctx("PREFS_DONE"));
      expect(sentIds()).toEqual(["T_ORGANIZER_ONLY"]);
      expect(m.transition).not.toHaveBeenCalled();
      expect(m.cancel).not.toHaveBeenCalled();
    });

    it("cancels a pre-order plan directly and tells the group", async () => {
      m.transition.mockResolvedValue({ id: "p1", version: 3, from_state: "VOTING" });
      await cmd("cancel_plan", ctx("PREFS_DONE", { organizer_id: "u1", state: "VOTING" }));
      expect(m.transition).toHaveBeenCalledWith("p1", ["COLLECTING", "RESEARCHING", "VOTING"], "CANCELLED");
      expect(m.cancelResearch).toHaveBeenCalledWith("p1");
      // No pay link exists before ORDERING, so the copy never mentions a released authorization.
      expect(m.fanout).toHaveBeenCalledWith("p1", "T_PLAN_OFF", expect.any(Function), { version: 3 });
      expect(m.cancel).not.toHaveBeenCalled();
    });

    it("tells the organizer where it stands when cancel() can't finish (venue down → CANCELLING) or had nothing to do", async () => {
      m.countByStage.mockResolvedValue({});
      m.cancel.mockResolvedValueOnce(true as never);
      m.getPlan.mockResolvedValueOnce({ id: "p1", title: "Friday night", state: "CANCELLING", party_target: 4 });
      await cmd("cancel_plan", ctx("HELD", { organizer_id: "u1", state: "APPROVING" }));
      expect(m.notify).toHaveBeenLastCalledWith("u1", "T_STATUS", { title: "Friday night", phase: "cancelling; any holds are released automatically" }, expect.anything());
      m.notify.mockClear();
      m.cancel.mockResolvedValueOnce(true as never);
      m.getPlan.mockResolvedValueOnce({ id: "p1", title: "Friday night", state: "CANCELLED", party_target: 4 });
      await cmd("cancel_plan", ctx("HELD", { organizer_id: "u1", state: "APPROVING" }));
      expect(m.notify).not.toHaveBeenCalled(); // finished: T_CANCELLED came from cancel()'s fan-out
      m.cancel.mockResolvedValueOnce(false as never);
      m.getPlan.mockResolvedValueOnce({ id: "p1", title: "Friday night", state: "COMMITTING", party_target: 4 });
      await cmd("cancel_plan", ctx("HELD", { organizer_id: "u1", state: "COMMITTING" }));
      expect(sentIds()).toEqual(["T_STATUS"]);
    });

    it("hands an ordered plan, or a lost pre-order race, to cancel()", async () => {
      await cmd("cancel_plan", ctx("HELD", { organizer_id: "u1", state: "APPROVING" }));
      expect(m.cancel).toHaveBeenCalledWith("p1", "organizer");
      m.cancel.mockClear();
      m.transition.mockResolvedValue(null);
      await cmd("cancel_plan", ctx("HELD", { organizer_id: "u1", state: "VOTING" }));
      expect(m.cancel).toHaveBeenCalledWith("p1", "organizer");
    });
  });

  describe("change budget", () => {
    it("sets the awaiting flag and asks, keeping the stage", async () => {
      await cmd("change_budget", ctx("VOTED"));
      expect(m.setAwaiting).toHaveBeenCalledWith("u1", "budget");
      expect(sentIds()).toEqual(["T_BUDGET_REASK"]);
    });

    it("is closed once HELD, and before JOIN", async () => {
      m.countByStage.mockResolvedValue({});
      await cmd("change_budget", ctx("HELD", { state: "APPROVING" }));
      expect(m.setAwaiting).not.toHaveBeenCalled();
      expect(sentIds()).toEqual(["T_STATUS"]);
      m.notify.mockClear();
      await cmd("change_budget", ctx("INVITED"));
      expect(sentIds()).toEqual(["T_HELP"]);
      expect(m.setAwaiting).not.toHaveBeenCalled();
    });
  });
});

describe("sendReceipts", () => {
  const confirmed = { id: "p1", title: "Friday night", state: "CONFIRMED", venue_order_id: "ord1", event_date: "2026-10-17" };

  it("lists the user's own captured share with the card suffix", async () => {
    m.capturedPlanIdsForUser.mockResolvedValue(["p1"]);
    m.getPlan.mockResolvedValue(confirmed);
    m.getOrder.mockResolvedValue({
      shares: [
        { payer_ref: "other", status: "CAPTURED", amount_cents: 9999, card_last4: "0000" },
        { payer_ref: "ref1", status: "CAPTURED", amount_cents: 4550, card_last4: "1111" },
      ],
    });
    await sendReceipts(user, ev);
    expect(m.notify).toHaveBeenCalledWith("u1", "T_RECEIPTS", { lines: "Friday night, Sat, Oct 17: $45.50 on card ••1111" }, expect.anything());
  });

  it("says None yet. when nothing is captured or lookups fail", async () => {
    m.capturedPlanIdsForUser.mockResolvedValue(["p1", "p2"]);
    m.getPlan.mockResolvedValueOnce({ ...confirmed, state: "CANCELLED" }).mockRejectedValueOnce(new Error("db down"));
    await sendReceipts(user, ev);
    expect(m.notify).toHaveBeenCalledWith("u1", "T_RECEIPTS", { lines: "None yet." }, expect.anything());
  });
});

describe("forgetMe", () => {
  it("leaves the plan, confirms while the route exists, deletes in one transaction, then releases the seat", async () => {
    await forgetMe(user, ctx("VOTED", { state: "APPROVING" }), ev);
    expect(m.order).toEqual([
      "onOut", "notify:T_FORGOTTEN", "tx:start", "pc", "prefs", "ratings", "ballots", "holdGates", "payLinks", "dmRoute", "scrub", "tx:end",
      "clearAwaiting", "releaseSeat",
    ]);
    expect(m.notify.mock.calls[0]![3]).toMatchObject({ key: "reply:msg1:2" });
    expect(m.del.privateConstraints).toHaveBeenCalledWith("u1", "tx");
  });

  it("does not run I'm out when there is no plan or the plan is already committing", async () => {
    await forgetMe(user, null, ev);
    await forgetMe(user, ctx("HELD", { state: "COMMITTING" }), ev);
    expect(m.onOut).not.toHaveBeenCalled();
    expect(m.del.scrub).toHaveBeenCalledTimes(2);
  });

  it("a failed seat release does not fail the deletion", async () => {
    m.releaseSeat.mockRejectedValueOnce(new Error("photon down"));
    await expect(forgetMe(user, null, ev)).resolves.toBeUndefined();
    expect(m.del.scrub).toHaveBeenCalled();
  });
});

describe("new plan / start over", () => {
  const newPlan = (c: unknown) => handleCommand(user, c as never, { kind: "new_plan" } as never, ev);
  const afterLeave = (state: string, stage: string) => {
    m.getPlan.mockResolvedValue({ id: "p1", state });
    m.getParticipant.mockResolvedValue({ stage });
  };

  it("with no plan: straight to the start chat (T_START_HELLO), nothing left", async () => {
    await newPlan(null);
    expect(m.beginStartChat).toHaveBeenCalledWith("u1", ev);
    expect(m.onOut).not.toHaveBeenCalled();
    expect(m.transition).not.toHaveBeenCalled();
  });

  it("after a CONFIRMED plan: the start chat, the booking is untouched", async () => {
    await newPlan(ctx("CAPTURED", { state: "CONFIRMED" }));
    expect(m.beginStartChat).toHaveBeenCalledWith("u1", ev);
    expect(m.onOut).not.toHaveBeenCalled();
    expect(m.cancel).not.toHaveBeenCalled();
  });

  it("a member of a COLLECTING plan leaves through onOut (the 'I'm out' path), then the start chat", async () => {
    afterLeave("COLLECTING", "DECLINED");
    await newPlan(ctx("PREFS_DONE"));
    expect(m.onOut).toHaveBeenCalledWith(expect.objectContaining({ plan: expect.objectContaining({ id: "p1" }) }), ev, "member_out");
    expect(m.transition).not.toHaveBeenCalled();
    expect(m.order.indexOf("onOut")).toBeLessThan(m.order.indexOf("beginStartChat"));
    expect(m.beginStartChat).toHaveBeenCalledWith("u1", ev, 2);
    expect(m.clearAwaiting).toHaveBeenCalled();
  });

  it.each(["COLLECTING", "RESEARCHING", "VOTING"])("the organizer of a %s plan calls it off (T_PLAN_OFF, nobody named), then the start chat", async (state) => {
    m.transition.mockResolvedValue({ id: "p1", version: 3, from_state: state });
    afterLeave("CANCELLED", "PREFS_DONE");
    await newPlan(ctx("PREFS_DONE", { state, organizer_id: "u1" }));
    expect(m.transition).toHaveBeenCalledWith("p1", ["COLLECTING", "RESEARCHING", "VOTING"], "CANCELLED");
    expect(m.fanout).toHaveBeenCalledWith("p1", "T_PLAN_OFF", expect.any(Function), { version: 3 });
    expect(m.onOut).not.toHaveBeenCalled();
    expect(m.cancel).not.toHaveBeenCalled();
    expect(m.beginStartChat).toHaveBeenCalledWith("u1", ev, 2);
  });

  it("organizer whose plan moved past VOTING meanwhile: falls back to onOut (money-safe cancel path)", async () => {
    m.transition.mockResolvedValue(null);
    afterLeave("CANCELLED", "HELD");
    await newPlan(ctx("PREFS_DONE", { state: "VOTING", organizer_id: "u1" }));
    expect(m.onOut).toHaveBeenCalledWith(expect.anything(), ev, "member_out");
    expect(m.fanout).not.toHaveBeenCalled();
  });

  it("a HELD member in APPROVING goes through onOut (cancel releases every hold); start chat once the plan is CANCELLED", async () => {
    afterLeave("CANCELLED", "HELD");
    await newPlan(ctx("HELD", { state: "APPROVING", organizer_id: "u1" }));
    expect(m.transition).not.toHaveBeenCalled(); // never the pre-order shortcut once holds may exist
    expect(m.onOut).toHaveBeenCalledWith(expect.anything(), ev, "member_out");
    expect(m.beginStartChat).toHaveBeenCalledWith("u1", ev, 2);
  });

  it.each([
    ["COMMITTING", "HELD"],
    ["CANCELLING", "HELD"],
  ])("still counted by the old plan afterwards (%s, %s): no start chat (onOut already answered)", async (state, stage) => {
    afterLeave(state, stage);
    await newPlan(ctx(stage, { state }));
    expect(m.onOut).toHaveBeenCalledOnce();
    expect(m.beginStartChat).not.toHaveBeenCalled();
  });
});

describe("sendAlreadyInPlan", () => {
  it("T_ALREADY_IN_PLAN with the plan title and counts only, threaded under the inbound", async () => {
    m.countByStage.mockResolvedValue({ JOINED: 1, PREFS_DONE: 2, VOTED: 1 });
    await sendAlreadyInPlan(ctx("PREFS_DONE", { title: "Brunch with coffee" }), ev);
    expect(m.notify).toHaveBeenCalledWith("u1", "T_ALREADY_IN_PLAN", { title: "Brunch with coffee", ready: 3, total: 4 }, { key: "reply:msg1:1", replyTo: "msg1", planId: "p1" });
  });
});
