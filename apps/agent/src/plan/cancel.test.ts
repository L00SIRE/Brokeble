// cancel(): which states each reason may leave, and that the winner alone reverses the venue order.
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  transition: vi.fn(),
  getPlan: vi.fn(),
  venueCancel: vi.fn(),
  fanout: vi.fn(),
  emit: vi.fn(),
  cancelResearch: vi.fn(),
  emitCounters: vi.fn(),
  enqueue: vi.fn(),
  settled: vi.fn(),
}));

vi.mock("./machine", () => ({ transition: m.transition }));
vi.mock("../repo/plans", () => ({ getPlan: m.getPlan }));
vi.mock("../ports", () => ({ ports: { venue: { cancel: m.venueCancel } } }));
vi.mock("../notify/fanout", () => ({ fanout: m.fanout }));
vi.mock("../events", () => ({ emit: m.emit }));
vi.mock("../creao/research", () => ({ cancelResearch: m.cancelResearch }));
vi.mock("./venueHook", () => ({ venueClient: { emitCounters: m.emitCounters } }));
vi.mock("../dueJobs", async (orig) => ({ ...(await orig<typeof import("../dueJobs")>()), enqueue: m.enqueue }));
vi.mock("../repo/outbound", () => ({ usersSettledTemplate: m.settled }));

import { cancel, finishCancel, postCancelJob } from "./cancel";
import type { DueJob } from "../dueJobs";

const PLAN = "p1";

beforeEach(() => {
  vi.resetAllMocks();
  m.transition.mockResolvedValue({ id: PLAN, version: 2, from_state: "APPROVING" });
  m.getPlan.mockResolvedValue({ id: PLAN, venue_order_id: "ord_1" });
  m.venueCancel.mockResolvedValue({ status: "CANCELLED" });
  m.fanout.mockResolvedValue(0);
  m.emitCounters.mockResolvedValue(undefined);
  m.cancelResearch.mockResolvedValue(undefined);
});

describe("cancel", () => {
  it.each(["member_out", "holdgate_no", "deadline", "organizer", "plan_cancelled"] as const)(
    "%s never cancels a plan that is already COMMITTING (the venue may be capturing)",
    async (reason) => {
      expect(await cancel(PLAN, reason)).toBe(true);
      expect(m.transition).toHaveBeenNthCalledWith(1, PLAN, ["ORDERING", "APPROVING"], "CANCELLING");
    },
  );

  it("only a rejected commit leaves COMMITTING", async () => {
    await cancel(PLAN, "commit_rejected");
    expect(m.transition).toHaveBeenNthCalledWith(1, PLAN, "COMMITTING", "CANCELLING");
  });

  it("a loser touches nothing and reports false", async () => {
    m.transition.mockResolvedValue(null);
    expect(await cancel(PLAN, "deadline")).toBe(false);
    expect(m.venueCancel).not.toHaveBeenCalled();
    expect(m.fanout).not.toHaveBeenCalled();
    expect(m.cancelResearch).not.toHaveBeenCalled();
  });

  it("the winner releases the order and, once the venue confirms, finishes with one nameless T_CANCELLED", async () => {
    await cancel(PLAN, "deadline");
    expect(m.venueCancel).toHaveBeenCalledWith("ord_1", "deadline");
    expect(m.transition).toHaveBeenNthCalledWith(2, PLAN, "CANCELLING", "CANCELLED", expect.objectContaining({ inTx: expect.any(Function) }));
    expect(m.fanout).toHaveBeenCalledWith(PLAN, "T_CANCELLED", expect.any(Function), { version: 2 });
    expect(m.fanout.mock.calls[0]![2]({})).toEqual({});
  });

  it("a venue that has not cancelled yet leaves the plan CANCELLING for the order.cancelled hook", async () => {
    m.venueCancel.mockResolvedValue({ status: "CANCELLING" });
    await cancel(PLAN, "member_out");
    expect(m.transition).toHaveBeenCalledTimes(1);
    expect(m.fanout).not.toHaveBeenCalled();
  });
});

describe("finishCancel + post_cancel backstop", () => {
  const job = (o: Partial<DueJob> = {}): DueJob => ({ id: 1, plan_id: PLAN, kind: "post_cancel", dedupe_key: "k", due_at: new Date(), payload: { version: 2 }, attempts: 1, ...o });

  it("enqueues post_cancel inside the winning transaction (durable even if the process dies right after)", async () => {
    const tx = { tx: true };
    m.transition.mockImplementation(async (_p: string, _f: unknown, _t: string, o: { inTx?: (tx: unknown, t: unknown) => Promise<void> } = {}) => {
      const t = { id: PLAN, version: 5, from_state: "ORDERING" };
      await o.inTx?.(tx, t);
      return t;
    });
    await finishCancel(PLAN, "ORDERING", { version: 5 });
    expect(m.transition).toHaveBeenCalledWith(PLAN, "ORDERING", "CANCELLED", expect.objectContaining({ version: 5 }));
    expect(m.enqueue).toHaveBeenCalledWith("post_cancel", `postcancel:${PLAN}:5`, expect.any(Date), { version: 5 }, { planId: PLAN, tx });
    expect(m.fanout).toHaveBeenCalledWith(PLAN, "T_CANCELLED", expect.any(Function), { version: 5 });
  });

  it("the backstop re-sends T_CANCELLED only to recipients whose send never settled, then counters", async () => {
    m.getPlan.mockResolvedValue({ id: PLAN, state: "CANCELLED", version: 2 });
    m.settled.mockResolvedValue(new Set(["u1"]));
    await postCancelJob(job());
    expect(m.settled).toHaveBeenCalledWith(PLAN, "T_CANCELLED");
    const o = m.fanout.mock.calls[0]![3] as { version: number; only: (r: { user_id: string }) => boolean };
    expect(o.version).toBe(2);
    expect(o.only({ user_id: "u1" })).toBe(false);
    expect(o.only({ user_id: "u2" })).toBe(true);
    expect(m.emitCounters).toHaveBeenCalledOnce();
  });

  it("the backstop is a no-op unless the plan is still CANCELLED at the job's version", async () => {
    for (const p of [null, { id: PLAN, state: "CONFIRMED", version: 2 }, { id: PLAN, state: "CANCELLED", version: 3 }]) {
      m.getPlan.mockResolvedValue(p);
      await postCancelJob(job());
    }
    expect(m.fanout).not.toHaveBeenCalled();
    expect(m.emitCounters).not.toHaveBeenCalled();
  });
});
