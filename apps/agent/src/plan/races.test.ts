// Races between closers (last vote vs vote deadline) and between "I'm out" and a commit that already started.
import type { InboundEvent } from "@tab/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  tx: { tx: true },
  transition: vi.fn(),
  setChosenBundle: vi.fn(async () => {}),
  enqueue: vi.fn(async () => true),
  fanout: vi.fn(async () => 1),
  notify: vi.fn(async () => "sent"),
  computeWinner: vi.fn(),
  getShortlist: vi.fn(),
  getPlan: vi.fn(),
  getParticipant: vi.fn(),
  updateStage: vi.fn(async () => ({ lane: 3 })),
  cancel: vi.fn(),
  sendStatus: vi.fn(async () => {}),
}));

vi.mock("../db", () => ({ sql: { begin: async (cb: (t: unknown) => Promise<unknown>) => cb(m.tx) } }));
vi.mock("../events", () => ({ emit: vi.fn(async () => 1) }));
vi.mock("../dueJobs", async (orig) => ({ ...(await orig<typeof import("../dueJobs")>()), enqueue: m.enqueue }));
vi.mock("../creao/research", () => ({ startResearch: vi.fn(), cancelResearch: vi.fn() }));
vi.mock("../decide/score", () => ({ computeWinner: m.computeWinner }));
vi.mock("../decide/ballot", () => ({ resolveApprovals: vi.fn() }));
vi.mock("../delegates/budget", () => ({ confirmFormBudget: vi.fn() }));
vi.mock("../notify/fanout", () => ({ fanout: m.fanout }));
vi.mock("../notify/notify", async (orig) => ({ ...(await orig<typeof import("../notify/notify")>()), notify: m.notify }));
vi.mock("../notify/presence", () => ({ startPlanTyping: vi.fn(), stopPlanTyping: vi.fn() }));
vi.mock("../notify/render", () => ({ fmtDate: () => "Sat, Oct 17" }));
vi.mock("../repo/ballots", () => ({ listBallots: vi.fn(), upsertBallot: vi.fn() }));
vi.mock("../repo/bundles", () => ({ getShortlist: m.getShortlist }));
vi.mock("../repo/participants", () => ({ getParticipant: m.getParticipant, listMembers: vi.fn(async () => []), updateStage: m.updateStage }));
vi.mock("../repo/plans", () => ({ getPlan: m.getPlan, getPlanByCode: vi.fn(), setChosenBundle: m.setChosenBundle }));
vi.mock("../repo/users", () => ({ getUser: vi.fn(async () => ({ first_name: "Ana" })) }));
vi.mock("../router/handlers", () => ({ sendStatus: m.sendStatus }));
vi.mock("./cancel", () => ({ cancel: m.cancel }));
vi.mock("./decision", () => ({ bundleTitle: (b: { id: string }) => `title-${b.id}`, toPublicBundle: (b: { id: string }, index: number) => ({ id: b.id, index }) }));
vi.mock("./machine", async (orig) => ({ ...(await orig<typeof import("./machine")>()), transition: m.transition }));

import { closeVote } from "./ballots";
import { onOut } from "./membership";

const PLAN = "p1";
const plan = (o: Record<string, unknown> = {}) => ({ id: PLAN, state: "VOTING", version: 2, title: "Dinner + show", ...o });
const ev = { event_id: "evt_1", message_id: "pho_msg_1" } as InboundEvent;

/** transition double that runs inTx like the real one (inside the transaction, after the winning UPDATE). */
const winTransition = (version = 2) =>
  m.transition.mockImplementation(async (_p: string, _f: unknown, _t: string, o: { inTx?: (tx: unknown, t: unknown) => Promise<void> } = {}) => {
    const t = { id: PLAN, version, from_state: "VOTING" };
    await o.inTx?.(m.tx, t);
    return t;
  });

beforeEach(() => {
  vi.clearAllMocks();
  m.getPlan.mockResolvedValue(plan());
  m.getShortlist.mockResolvedValue([{ id: "b1" }, { id: "b2" }, { id: "b3" }]);
  m.computeWinner.mockResolvedValue("b3");
});

describe("closeVote", () => {
  it("writes the winner and create_order inside the winning transaction", async () => {
    winTransition();
    await closeVote(PLAN, 2);
    expect(m.transition).toHaveBeenCalledWith(PLAN, "VOTING", "ORDERING", expect.objectContaining({ version: 2 }));
    expect(m.setChosenBundle).toHaveBeenCalledWith(PLAN, "b3", m.tx);
    expect(m.enqueue).toHaveBeenCalledWith("create_order", `order:${PLAN}:2`, expect.any(Date), { version: 2 }, { planId: PLAN, tx: m.tx });
    expect(m.fanout).toHaveBeenCalledWith(PLAN, "T_WINNER", expect.any(Function), expect.objectContaining({ version: 2 }));
  });

  it("a losing closer can never overwrite the chosen bundle", async () => {
    m.transition.mockResolvedValue(null);
    m.computeWinner.mockResolvedValue("b1");
    await closeVote(PLAN, 2);
    expect(m.setChosenBundle).not.toHaveBeenCalled();
    expect(m.enqueue).not.toHaveBeenCalled();
    expect(m.fanout).not.toHaveBeenCalled();
  });
});

describe("onOut while APPROVING", () => {
  const ctx = (stage: string) => ({ user: { id: "u3" }, plan: plan({ state: "APPROVING" }), participant: { stage } }) as never;

  it("cancel wins → the leaver is DECLINED and acked", async () => {
    m.getPlan.mockResolvedValue(plan({ state: "APPROVING" }));
    m.getParticipant.mockResolvedValue({ stage: "LINK_SENT" });
    m.cancel.mockResolvedValue(true);
    await onOut(ctx("LINK_SENT"), ev, "member_out");
    expect(m.updateStage).toHaveBeenCalledWith(PLAN, "u3", "DECLINED", m.tx);
    expect(m.updateStage.mock.invocationCallOrder[0]!).toBeLessThan(m.cancel.mock.invocationCallOrder[0]!);
    expect(m.notify).toHaveBeenCalledWith("u3", "T_OUT_ACK", { title: "Dinner + show" }, expect.anything());
  });

  it("a commit that started first wins → a HELD leaver gets the status, never \"you're out\"", async () => {
    m.getPlan.mockResolvedValueOnce(plan({ state: "APPROVING" })).mockResolvedValue(plan({ state: "COMMITTING" }));
    m.getParticipant.mockResolvedValue({ stage: "HELD" });
    m.cancel.mockResolvedValue(false);
    await onOut(ctx("HELD"), ev, "member_out");
    expect(m.updateStage).not.toHaveBeenCalled();
    expect(m.notify).not.toHaveBeenCalled();
    expect(m.sendStatus).toHaveBeenCalledWith(expect.objectContaining({ plan: expect.objectContaining({ state: "COMMITTING" }) }), ev);
  });
});
