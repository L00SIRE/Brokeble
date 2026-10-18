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
}));

vi.mock("./machine", () => ({ transition: m.transition }));
vi.mock("../repo/plans", () => ({ getPlan: m.getPlan }));
vi.mock("../ports", () => ({ ports: { venue: { cancel: m.venueCancel } } }));
vi.mock("../notify/fanout", () => ({ fanout: m.fanout }));
vi.mock("../events", () => ({ emit: m.emit }));
vi.mock("../creao/research", () => ({ cancelResearch: m.cancelResearch }));
vi.mock("./venueHook", () => ({ venueClient: { emitCounters: m.emitCounters } }));

import { cancel } from "./cancel";

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
    expect(m.transition).toHaveBeenNthCalledWith(2, PLAN, "CANCELLING", "CANCELLED");
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
