// holdGate (M7): pure tests. Every collaborator is mocked; amounts are cents.
import type { InboundEvent } from "@tab/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  getConstraints: vi.fn(),
  insertPending: vi.fn(),
  getGate: vi.fn(),
  answerGate: vi.fn(),
  getLink: vi.fn(),
  notify: vi.fn(),
  setStage: vi.fn(),
  onOut: vi.fn(),
  setAwaiting: vi.fn(),
  clearAwaiting: vi.fn(),
  getBundle: vi.fn(),
}));

vi.mock("../repo/privateConstraints", () => ({ get: m.getConstraints }));
vi.mock("../repo/holdGates", () => ({ insertPendingHoldGate: m.insertPending, getHoldGate: m.getGate, answerHoldGate: m.answerGate }));
vi.mock("../repo/payLinks", () => ({ getPayLink: m.getLink }));
vi.mock("../decide/filter", () => ({
  effectiveHardMax: (c: { target_pp_cents: number; hard_max_pp_cents: number | null }) => c.hard_max_pp_cents ?? Math.round(c.target_pp_cents * 1.1),
}));
vi.mock("../notify/notify", async () => ({ ...(await vi.importActual<object>("../notify/notify")), notify: m.notify }));
vi.mock("../notify/render", () => ({
  usd2: (cents: number) => (cents / 100).toFixed(2),
  fmtDeadline: (at: Date | string) => `at ${new Date(at).toISOString()}`,
}));
vi.mock("../plan/membership", () => ({ setStage: m.setStage, onOut: m.onOut }));
vi.mock("../delegates/awaiting", () => ({ setAwaiting: m.setAwaiting, clearAwaiting: m.clearAwaiting }));
vi.mock("../repo/bundles", () => ({ getBundle: m.getBundle }));
vi.mock("../plan/decision", () => ({ bundleTitle: (b: { id: string }) => `Dinner at D-${b.id} → Show at S-${b.id}` }));

import * as holdGate from "./holdGate";
import type { MemberContext } from "../repo/types";

const PLAN = "3f1c2b8e-6a0d-4c1f-9e2a-7b5d4c3a2f10";
const USER = "9d8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6a";
const PAY_URL = "https://pay.example/p/tok";

const ctx = (stage: string, state = "APPROVING"): MemberContext =>
  ({
    user: { id: USER },
    plan: { id: PLAN, version: 2, state, title: "Dinner + show", deadlines: { approve_at: "2026-10-18T05:00:00Z" } },
    participant: { stage },
  }) as unknown as MemberContext;
const inbound = { message_id: "pho_msg_1" } as InboundEvent;
const link = { amount_cents: 6000, pay_url: PAY_URL, expires_at: new Date("2026-10-18T06:00:00Z") };
const constraints = (target: number, hard: number | null) => ({ target_pp_cents: target, hard_max_pp_cents: hard });

beforeEach(() => {
  vi.resetAllMocks();
  m.notify.mockResolvedValue("sent");
  m.answerGate.mockResolvedValue(true);
  m.getLink.mockResolvedValue(link);
});

describe("check", () => {
  it("links when the member has no constraints", async () => {
    m.getConstraints.mockResolvedValue(null);
    expect(await holdGate.check(PLAN, USER, 2, 99_999)).toBe("link");
    expect(m.insertPending).not.toHaveBeenCalled();
  });

  it("links at exactly the hard max and below", async () => {
    m.getConstraints.mockResolvedValue(constraints(4000, 5000));
    expect(await holdGate.check(PLAN, USER, 2, 5000)).toBe("link");
    expect(await holdGate.check(PLAN, USER, 2, 4999)).toBe("link");
    expect(m.insertPending).not.toHaveBeenCalled();
  });

  it("asks and records a pending gate one cent over", async () => {
    m.getConstraints.mockResolvedValue(constraints(4000, 5000));
    expect(await holdGate.check(PLAN, USER, 2, 5001)).toBe("ask");
    expect(m.insertPending).toHaveBeenCalledWith(PLAN, USER, 2, 5001);
  });

  it("falls back to the slack-derived max when hard_max is null", async () => {
    m.getConstraints.mockResolvedValue(constraints(4000, null)); // 4400
    expect(await holdGate.check(PLAN, USER, 2, 4400)).toBe("link");
    expect(await holdGate.check(PLAN, USER, 2, 4401)).toBe("ask");
  });
});

describe("answer", () => {
  it("YES approves, sends the stored link as a threaded reply, then LINK_SENT", async () => {
    m.getGate.mockResolvedValue({ status: "pending" });
    await holdGate.answer(ctx("GATED"), true, inbound);
    expect(m.answerGate).toHaveBeenCalledWith(PLAN, USER, 2, "approved");
    expect(m.notify).toHaveBeenCalledWith(
      USER,
      "T_PAY_LINK",
      expect.objectContaining({ title: "Dinner + show", amount: "60.00", url: PAY_URL }),
      expect.objectContaining({ planId: PLAN, replyTo: "pho_msg_1" }),
    );
    expect(m.setStage).toHaveBeenCalledWith(PLAN, USER, "LINK_SENT", { amountCents: 6000 });
    expect(m.clearAwaiting).toHaveBeenCalledWith(USER);
    expect(m.onOut).not.toHaveBeenCalled();
  });

  it("YES uses the booked bundle's title (same as everyone else's pay link), not the plan's working title", async () => {
    m.getGate.mockResolvedValue({ status: "pending" });
    m.getBundle.mockResolvedValue({ id: "bnd_1" });
    const c = ctx("GATED");
    (c.plan as { chosen_bundle_id?: string }).chosen_bundle_id = "bnd_1";
    await holdGate.answer(c, true, inbound);
    expect(m.getBundle).toHaveBeenCalledWith(PLAN, 2, "bnd_1");
    expect(m.notify).toHaveBeenCalledWith(USER, "T_PAY_LINK", expect.objectContaining({ title: "Dinner at D-bnd_1 → Show at S-bnd_1" }), expect.anything());
  });

  it("NO declines and treats it as being out, without sending a link", async () => {
    m.getGate.mockResolvedValue({ status: "pending" });
    const c = ctx("GATED");
    await holdGate.answer(c, false, inbound);
    expect(m.answerGate).toHaveBeenCalledWith(PLAN, USER, 2, "declined");
    expect(m.onOut).toHaveBeenCalledWith(c, inbound, "holdgate_no");
    expect(m.notify).not.toHaveBeenCalled();
  });

  it("loses the race quietly when another reply already answered the gate", async () => {
    m.getGate.mockResolvedValue({ status: "pending" });
    m.answerGate.mockResolvedValue(false);
    await holdGate.answer(ctx("GATED"), true, inbound);
    expect(m.notify).not.toHaveBeenCalled();
    expect(m.setStage).not.toHaveBeenCalled();
  });

  it("ignores a stale reply (no gate, answered gate already delivered, or plan not APPROVING)", async () => {
    m.getGate.mockResolvedValue(null);
    await holdGate.answer(ctx("GATED"), true, inbound);
    m.getGate.mockResolvedValue({ status: "approved" });
    await holdGate.answer(ctx("LINK_SENT"), true, inbound);
    m.getGate.mockResolvedValue({ status: "pending" });
    await holdGate.answer(ctx("GATED", "CANCELLING"), true, inbound);
    expect(m.notify).not.toHaveBeenCalled();
    expect(m.onOut).not.toHaveBeenCalled();
    expect(m.answerGate).not.toHaveBeenCalled();
  });

  it("YES keeps the gate pending when no pay link is stored", async () => {
    m.getGate.mockResolvedValue({ status: "pending" });
    m.getLink.mockResolvedValue(null);
    await holdGate.answer(ctx("GATED"), true, inbound);
    expect(m.answerGate).not.toHaveBeenCalled();
    expect(m.notify).not.toHaveBeenCalled();
  });

  it("a failed send leaves the member GATED and lets a repeated YES redeliver", async () => {
    m.getGate.mockResolvedValue({ status: "pending" });
    m.notify.mockResolvedValue("failed");
    await holdGate.answer(ctx("GATED"), true, inbound);
    expect(m.setStage).not.toHaveBeenCalled();
    expect(m.clearAwaiting).not.toHaveBeenCalled();

    m.getGate.mockResolvedValue({ status: "approved" });
    m.notify.mockResolvedValue("sent");
    await holdGate.answer(ctx("GATED"), true, inbound);
    expect(m.answerGate).toHaveBeenCalledTimes(1);
    expect(m.setStage).toHaveBeenCalledWith(PLAN, USER, "LINK_SENT", { amountCents: 6000 });
  });
});

describe("recheck", () => {
  it("does nothing outside APPROVING or once the member is HELD", async () => {
    await holdGate.recheck(ctx("LINK_SENT", "VOTING"));
    await holdGate.recheck(ctx("HELD"));
    expect(m.getLink).not.toHaveBeenCalled();
  });

  it("does nothing without a stored pay link", async () => {
    m.getLink.mockResolvedValue(null);
    await holdGate.recheck(ctx("LINK_SENT"));
    expect(m.getConstraints).not.toHaveBeenCalled();
  });

  it("a lowered budget below the share asks T_HOLD_GATE, GATED, awaiting holdgate", async () => {
    m.getConstraints.mockResolvedValue(constraints(2000, 2500));
    m.getGate.mockResolvedValue({ status: "pending" });
    await holdGate.recheck(ctx("LINK_SENT"));
    expect(m.notify).toHaveBeenCalledWith(USER, "T_HOLD_GATE", { amount: "60.00" }, expect.objectContaining({ key: expect.stringMatching(/:T_HOLD_GATE:2:6000$/) }));
    expect(m.setStage).toHaveBeenCalledWith(PLAN, USER, "GATED", { amountCents: 6000 });
    expect(m.setAwaiting).toHaveBeenCalledWith(USER, "holdgate");
  });

  it("does not re-ask someone who already said YES to this share", async () => {
    m.getConstraints.mockResolvedValue(constraints(2000, 2500));
    m.getGate.mockResolvedValue({ status: "approved" });
    await holdGate.recheck(ctx("LINK_SENT"));
    expect(m.notify).not.toHaveBeenCalled();
    expect(m.setStage).not.toHaveBeenCalled();
  });

  it("a raised budget that now covers a GATED share closes the ask and sends the link", async () => {
    m.getConstraints.mockResolvedValue(constraints(7000, 8000));
    m.getGate.mockResolvedValue({ status: "pending" });
    await holdGate.recheck(ctx("GATED"));
    expect(m.answerGate).toHaveBeenCalledWith(PLAN, USER, 2, "approved");
    expect(m.notify).toHaveBeenCalledWith(USER, "T_PAY_LINK", expect.objectContaining({ url: PAY_URL }), expect.anything());
    expect(m.setStage).toHaveBeenCalledWith(PLAN, USER, "LINK_SENT", { amountCents: 6000 });
  });

  it("a budget that still covers an already-linked share changes nothing", async () => {
    m.getConstraints.mockResolvedValue(constraints(7000, 8000));
    m.getGate.mockResolvedValue(null);
    await holdGate.recheck(ctx("LINK_SENT"));
    expect(m.notify).not.toHaveBeenCalled();
    expect(m.setStage).not.toHaveBeenCalled();
  });
});
