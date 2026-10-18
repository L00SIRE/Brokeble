import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InboundEvent } from "@tab/shared";

const m = vi.hoisted(() => ({
  computeWinner: vi.fn(),
  resolveApprovals: vi.fn(),
  enqueue: vi.fn(),
  emit: vi.fn(),
  fanout: vi.fn(),
  notify: vi.fn(),
  listBallots: vi.fn(),
  upsertBallot: vi.fn(),
  getShortlist: vi.fn(),
  getParticipant: vi.fn(),
  listMembers: vi.fn(),
  getPlan: vi.fn(),
  setChosenBundle: vi.fn(),
  transition: vi.fn(),
  setStage: vi.fn(),
}));

vi.mock("../src/decide/score", () => ({ computeWinner: m.computeWinner }));
vi.mock("../src/decide/ballot", () => ({ resolveApprovals: m.resolveApprovals }));
vi.mock("../src/dueJobs", () => ({ enqueue: m.enqueue }));
vi.mock("../src/events", () => ({ emit: m.emit }));
vi.mock("../src/jobs/kinds", () => ({
  A_JOB_KINDS: { createOrder: "create_order" },
  aJobKeys: { createOrder: (p: string, v: number) => `order:${p}:${v}` },
}));
vi.mock("../src/notify/fanout", () => ({ fanout: m.fanout }));
vi.mock("../src/notify/notify", () => ({
  notify: m.notify,
  tplKey: (p: string, u: string, t: string, v: number, s?: string | number) => `tpl:${p}:${u}:${t}:${v}${s === undefined ? "" : `:${s}`}`,
  replyKey: (id: string, n: number) => `reply:${id}:${n}`,
}));
vi.mock("../src/repo/ballots", () => ({ listBallots: m.listBallots, upsertBallot: m.upsertBallot }));
vi.mock("../src/repo/bundles", () => ({ getShortlist: m.getShortlist }));
vi.mock("../src/repo/participants", () => ({ getParticipant: m.getParticipant, listMembers: m.listMembers }));
vi.mock("../src/repo/plans", () => ({ getPlan: m.getPlan, setChosenBundle: m.setChosenBundle }));
vi.mock("../src/plan/machine", () => ({
  transition: m.transition,
  stageAtLeast: (s: string, min: string) => {
    const order = ["INVITED", "JOINED", "BUDGET_LOCKED", "PREFS_DONE", "VOTED", "GATED", "LINK_SENT", "HELD", "CAPTURED"];
    return order.includes(s) && order.indexOf(s) >= order.indexOf(min);
  },
}));
vi.mock("../src/plan/membership", () => ({ setStage: m.setStage }));
vi.mock("../src/plan/decision", () => ({
  bundleTitle: (b: { id: string }) => `title-${b.id}`,
  toPublicBundle: (b: { id: string }, index: number) => ({ id: b.id, index }),
}));

import { closeVote, handleDigitsBallot, maybeCloseVote, publicShortlist, recordBallot, voteDeadlineJob } from "../src/plan/ballots";

const PLAN = "p1";
const plan = (o: Record<string, unknown> = {}) => ({ id: PLAN, state: "VOTING", version: 2, time_start: "18:30", ...o });
const ctx = (stage = "PREFS_DONE") => ({ user: { id: "u1" }, plan: plan(), participant: { stage } }) as never;
const ev = { message_id: "msg1", event_id: "ev1" } as InboundEvent;
const bundles = [{ id: "b1" }, { id: "b2" }, { id: "b3" }];
const parse = (approvals: number[]) => ({ approvals, constraints: [], none_of_these: false, intent: "ballot", confidence: "high" }) as never;

beforeEach(() => {
  vi.resetAllMocks();
  m.getPlan.mockResolvedValue(plan());
  m.getParticipant.mockResolvedValue({ stage: "PREFS_DONE" });
  m.getShortlist.mockResolvedValue(bundles);
  m.listMembers.mockResolvedValue([{ user_id: "u1" }, { user_id: "u2" }, { user_id: "u3" }]);
  m.listBallots.mockResolvedValue([]);
  m.resolveApprovals.mockReturnValue(["b1", "b3"]);
  m.transition.mockImplementation(async (_p: string, _f: string, _t: string, o: { inTx?: (tx: string, t: unknown) => Promise<void> } = {}) => {
    const t = { id: PLAN, version: 2, from_state: "VOTING" };
    await o.inTx?.("tx", t);
    return t;
  });
  m.computeWinner.mockResolvedValue("b3");
  m.notify.mockResolvedValue("sent");
});

describe("publicShortlist", () => {
  it("indexes the version's bundles 1..3 in rank order", async () => {
    expect((await publicShortlist(PLAN, 2)).map((b) => b.index)).toEqual([1, 2, 3]);
    expect(m.getShortlist).toHaveBeenCalledWith(PLAN, 2);
  });
});

describe("recordBallot", () => {
  it("resolves approvals in code, stores them, advances the stage and sends only counts", async () => {
    m.listBallots.mockResolvedValue([{ user_id: "u1" }]);
    await recordBallot(ctx(), parse([1, 3]), "digits", ev);
    expect(m.resolveApprovals).toHaveBeenCalledWith(expect.anything(), expect.any(Array), "18:30");
    expect(m.upsertBallot).toHaveBeenCalledWith(
      expect.objectContaining({ plan_id: PLAN, user_id: "u1", plan_version: 2, approvals: ["b1", "b3"], source: "digits", constraints: [] }),
    );
    expect(m.setStage).toHaveBeenCalledWith(PLAN, "u1", "VOTED");
    expect(m.emit).toHaveBeenCalledWith({ type: "vote.tally", plan_id: PLAN, voted: 1, total: 3 });
    const [, id, varsFor, opts] = m.fanout.mock.calls[0]!;
    expect(id).toBe("T_VOTE_TALLY");
    expect(varsFor({ user_id: "u2", first_name: "Sam" })).toEqual({ k: 1, n: 3 });
    expect(opts).toMatchObject({ version: 2, suffix: 1 });
    expect(m.transition).not.toHaveBeenCalled();
  });

  it("does not regress a stage that is already VOTED on a re-vote", async () => {
    await recordBallot({ ...(ctx() as object), participant: { stage: "VOTED" } } as never, parse([2]), "delegate", ev);
    expect(m.setStage).not.toHaveBeenCalled();
    expect(m.upsertBallot).toHaveBeenCalledWith(expect.objectContaining({ source: "delegate" }));
  });

  it("ignores ballots outside VOTING or from members who are not in", async () => {
    m.getPlan.mockResolvedValue(plan({ state: "ORDERING" }));
    await recordBallot(ctx(), parse([1]), "digits", ev);
    m.getPlan.mockResolvedValue(plan());
    m.getParticipant.mockResolvedValue({ stage: "DECLINED" });
    await recordBallot(ctx(), parse([1]), "digits", ev);
    expect(m.upsertBallot).not.toHaveBeenCalled();
  });

  it("closes the vote when the last member votes, after the final tally", async () => {
    m.listBallots.mockResolvedValue([{ user_id: "u1" }, { user_id: "u2" }, { user_id: "u3" }]);
    await recordBallot(ctx(), parse([1]), "digits", ev);
    expect(m.fanout.mock.calls.map((c) => c[1])).toEqual(["T_VOTE_TALLY", "T_WINNER"]);
    expect(m.fanout.mock.calls[0]![3]).toMatchObject({ suffix: 3 });
    expect(m.transition).toHaveBeenCalledWith(PLAN, "VOTING", "ORDERING", expect.objectContaining({ version: 2 }));
  });
});

describe("handleDigitsBallot", () => {
  it("dedupes, keeps only shortlist indices and records a high-confidence digits ballot", async () => {
    await handleDigitsBallot(ctx(), [3, 1, 3, 9], ev);
    expect(m.resolveApprovals).toHaveBeenCalledWith(
      { approvals: [1, 3], constraints: [], none_of_these: false, intent: "ballot", confidence: "high" },
      expect.any(Array),
      "18:30",
    );
    expect(m.upsertBallot).toHaveBeenCalledOnce();
  });

  it("asks to clarify once per version, then falls back to T_HELP", async () => {
    await handleDigitsBallot(ctx(), [9], ev);
    expect(m.notify).toHaveBeenCalledWith("u1", "T_BALLOT_CLARIFY", {}, expect.objectContaining({ key: `tpl:${PLAN}:u1:T_BALLOT_CLARIFY:2` }));
    expect(m.notify).toHaveBeenCalledTimes(1);
    m.notify.mockResolvedValueOnce("duplicate");
    await handleDigitsBallot(ctx(), [9], ev);
    expect(m.notify).toHaveBeenLastCalledWith("u1", "T_HELP", {}, expect.objectContaining({ key: "reply:msg1:1" }));
    expect(m.upsertBallot).not.toHaveBeenCalled();
  });
});

describe("maybeCloseVote", () => {
  it("waits while any active member has not voted", async () => {
    m.listBallots.mockResolvedValue([{ user_id: "u1" }, { user_id: "u2" }]);
    await maybeCloseVote(PLAN, 2);
    expect(m.computeWinner).not.toHaveBeenCalled();
  });

  it("ignores ballots from people who left, and stale versions", async () => {
    m.listBallots.mockResolvedValue([{ user_id: "gone" }, { user_id: "u1" }, { user_id: "u2" }, { user_id: "u3" }]);
    await maybeCloseVote(PLAN, 2);
    expect(m.computeWinner).toHaveBeenCalledOnce();
    m.computeWinner.mockClear();
    await maybeCloseVote(PLAN, 1);
    expect(m.computeWinner).not.toHaveBeenCalled();
  });

  it("never closes an empty plan", async () => {
    m.listMembers.mockResolvedValue([]);
    await maybeCloseVote(PLAN, 2);
    expect(m.computeWinner).not.toHaveBeenCalled();
  });
});

describe("closeVote", () => {
  it("sets the winner, transitions at the version, enqueues create_order and announces by title", async () => {
    await closeVote(PLAN, 2);
    expect(m.computeWinner).toHaveBeenCalledWith(PLAN, 2);
    expect(m.setChosenBundle).toHaveBeenCalledWith(PLAN, "b3", "tx");
    expect(m.enqueue).toHaveBeenCalledWith("create_order", `order:${PLAN}:2`, expect.any(Date), { version: 2 }, { planId: PLAN, tx: "tx" });
    const [, id, varsFor] = m.fanout.mock.calls[0]!;
    expect(id).toBe("T_WINNER");
    expect(varsFor({})).toEqual({ title: "title-b3" });
  });

  it("does nothing when it loses the transition race", async () => {
    m.transition.mockResolvedValue(null);
    await closeVote(PLAN, 2);
    expect(m.enqueue).not.toHaveBeenCalled();
    expect(m.setChosenBundle).not.toHaveBeenCalled();
    expect(m.fanout).not.toHaveBeenCalled();
  });

  it("throws before touching state if the winner is not in the shortlist", async () => {
    m.computeWinner.mockResolvedValue("nope");
    await expect(closeVote(PLAN, 2)).rejects.toThrow();
    expect(m.transition).not.toHaveBeenCalled();
  });

  it("ignores plans that are no longer VOTING at that version", async () => {
    m.getPlan.mockResolvedValue(plan({ state: "ORDERING" }));
    await closeVote(PLAN, 2);
    m.getPlan.mockResolvedValue(plan({ version: 3 }));
    await closeVote(PLAN, 2);
    expect(m.computeWinner).not.toHaveBeenCalled();
  });
});

describe("voteDeadlineJob", () => {
  const job = (o: object) =>
    ({ id: 1, kind: "vote_deadline", dedupe_key: "k", due_at: new Date(), attempts: 1, plan_id: PLAN, payload: { version: 2 }, ...o }) as never;

  it("closes the vote with whoever has voted", async () => {
    await voteDeadlineJob(job({}));
    expect(m.computeWinner).toHaveBeenCalledWith(PLAN, 2);
  });

  it("is a no-op for a superseded version or a malformed job", async () => {
    await voteDeadlineJob(job({ payload: { version: 1 } }));
    await voteDeadlineJob(job({ payload: {} }));
    await voteDeadlineJob(job({ plan_id: null }));
    expect(m.computeWinner).not.toHaveBeenCalled();
  });
});
