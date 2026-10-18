// Money spine (A plan T9/T11): create_order → holdGate/pay links → venue hook → exactly-once commit → confirm, plus
// cancel (nobody named), the create_order/cancel race and the last-share commit. Runs against the in-memory MockVenue
// with every DB/notify dependency faked; the state machine fake enforces the same from/version guard as the real one.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Bundle, LaneStage, VenueEvent } from "@tab/shared";
import type { DueJob } from "../src/dueJobs";
import type { MemberRow, PlanRow, PlanState } from "../src/repo/types";
import { MockVenue } from "../src/ports/venue.mock";

const w = vi.hoisted(() => ({
  plans: new Map<string, any>(),
  members: [] as any[],
  payLinks: new Map<string, any>(),
  seen: new Set<string>(),
  venue: null as any,
  bundle: null as any,
  env: { DEMO_TIMERS: false, VOICE_ENABLED: false },
}));

vi.mock("../src/ports", () => ({ ports: { get venue() { return w.venue; } } }));
vi.mock("../src/env", async (orig) => {
  const a: any = await orig();
  return { ...a, env: new Proxy(a.env, { get: (t, k) => (k in w.env ? (w.env as any)[k] : t[k]) }) };
});
vi.mock("../src/repo/plans", () => ({
  getPlan: vi.fn(async (id: string) => (w.plans.has(id) ? structuredClone(w.plans.get(id)) : null)),
  getPlanByRef: vi.fn(async (ref: string) => structuredClone([...w.plans.values()].find((p) => p.ref === ref) ?? null)),
  setVenueOrder: vi.fn(async (id: string, orderId: string, at: Date) => {
    const p = w.plans.get(id);
    p.venue_order_id = orderId;
    p.deadlines = { ...p.deadlines, approve_at: at.toISOString() };
  }),
}));
vi.mock("../src/repo/bundles", () => ({ getBundle: vi.fn(async () => w.bundle) }));
vi.mock("../src/repo/participants", () => ({
  listMembers: vi.fn(async () => w.members.filter((m) => !["DECLINED", "RELEASED", "INVITED", "JOINED", "BUDGET_LOCKED"].includes(m.stage)).map((m) => ({ ...m }))),
  memberByPayerRef: vi.fn(async (_p: string, ref: string) => w.members.find((m) => m.payer_ref === ref) ?? null),
  countByStage: vi.fn(async () => w.members.reduce((acc: any, m) => ({ ...acc, [m.stage]: (acc[m.stage] ?? 0) + 1 }), {})),
}));
vi.mock("../src/repo/payLinks", () => ({
  upsertPayLink: vi.fn(async (l: any) => void w.payLinks.set(`${l.plan_id}:${l.user_id}:${l.plan_version}`, { ...l, updated_at: new Date() })),
  getPayLink: vi.fn(async (p: string, u: string, v: number) => w.payLinks.get(`${p}:${u}:${v}`) ?? null),
}));
vi.mock("../src/repo/inboundEvents", () => ({
  seenInbound: vi.fn(async (_s: string, id: string) => w.seen.has(id)),
  markInboundSeen: vi.fn(async (_s: string, id: string) => void w.seen.add(id)),
}));
vi.mock("../src/plan/machine", () => {
  const ORDER = ["INVITED", "JOINED", "BUDGET_LOCKED", "PREFS_DONE", "VOTED", "GATED", "LINK_SENT", "HELD", "CAPTURED"];
  return {
    stageAtLeast: (s: string, min: string) => ORDER.includes(s) && ORDER.indexOf(s) >= ORDER.indexOf(min),
    transition: vi.fn(async (id: string, from: any, to: string, o: { version?: number } = {}) => {
      const p = w.plans.get(id);
      const froms = typeof from === "string" ? [from] : from;
      if (!p || !froms.includes(p.state) || (o.version !== undefined && o.version !== p.version)) return null;
      const from_state = p.state;
      p.state = to;
      return { id, version: p.version, from_state };
    }),
  };
});
vi.mock("../src/plan/membership", () => ({
  setStage: vi.fn(async (_p: string, u: string, stage: string) => void (w.members.find((m) => m.user_id === u).stage = stage)),
}));
vi.mock("../src/plan/decision", () => ({ bundleTitle: () => "Dinner at Bestia → Show at The Echo" }));
vi.mock("../src/notify/notify", async (orig) => ({ tplKey: ((await orig()) as any).tplKey, notify: vi.fn(async () => "sent") }));
vi.mock("../src/notify/fanout", () => ({ fanout: vi.fn(async () => 1) }));
vi.mock("../src/notify/render", () => ({ usd2: (c: number) => (c / 100).toFixed(2), fmtDeadline: () => "9:40 PM" }));
vi.mock("../src/money/holdGate", () => ({ check: vi.fn(async () => "link") }));
vi.mock("../src/delegates/awaiting", () => ({ setAwaiting: vi.fn() }));
vi.mock("../src/dueJobs", async (orig) => ({ ...((await orig()) as any), enqueue: vi.fn(async () => true) }));
vi.mock("../src/events", () => ({ emit: vi.fn(async () => 1) }));
vi.mock("../src/creao/concierge", () => ({ startConciergeFor: vi.fn(async () => {}) }));
vi.mock("../src/creao/research", () => ({ cancelResearch: vi.fn(async () => {}) }));
vi.mock("../src/repo/outbound", () => ({ usersSettledTemplate: vi.fn(async () => new Set<string>()) }));

import { enqueue } from "../src/dueJobs";
import { emit } from "../src/events";
import { startConciergeFor } from "../src/creao/concierge";
import { cancelResearch } from "../src/creao/research";
import * as holdGate from "../src/money/holdGate";
import { fanout } from "../src/notify/fanout";
import { notify } from "../src/notify/notify";
import { transition } from "../src/plan/machine";
import { buildCreateOrderRequest, createOrderJob } from "../src/plan/order";
import { commitJob, confirm, postConfirmJob } from "../src/plan/commit";
import { usersSettledTemplate } from "../src/repo/outbound";
import { VenueHttpError } from "../src/venueClient";
import { cancel } from "../src/plan/cancel";
import { dispatchVenueEvent, displayBrand, mountVenueHook, venueClient } from "../src/plan/venueHook";
import { Hono } from "hono";

const PLAN_ID = "11111111-1111-4111-8111-111111111111";
const REF = "22222222-2222-4222-8222-222222222222";
const ref = (n: number) => String(n).repeat(32);
const opt = (category: "dinner" | "show", name: string, usd: number) => ({
  id: `opt_${name}`, run_id: "run", source: "cached" as const, est_high_pp_cents: usd * 100,
  data: {
    category, name, address: `${name} St, Los Angeles`, area: "DTLA", url: "https://x.example", price_tier: "$25-50", est_low_pp_usd: usd - 5,
    est_high_pp_usd: usd, price_evidence_url: "https://x.example", dietary_fit: [], pitch: "good",
    ...(category === "dinner" ? { opens: "17:00", closes: "23:00", hours_evidence_url: "https://x.example" } : { show_start: "20:30", show_end_est: "22:00", showtime_evidence_url: "https://x.example" }),
  },
});
const BUNDLE = { id: "bnd_abc", dinner: opt("dinner", "Bestia", 40), show: opt("show", "Echo", 20), dinner_time: "18:30", show_start: "20:30", show_end_est: "22:00", all_in_pp_cents: 8000 } as unknown as Bundle;

function seed(state: PlanState = "ORDERING", n = 3) {
  w.venue = new MockVenue();
  w.bundle = BUNDLE;
  w.payLinks.clear();
  w.seen.clear();
  w.plans.clear();
  w.plans.set(PLAN_ID, {
    id: PLAN_ID, ref: REF, code: "1234", organizer_id: "u1", state, version: 4, title: "Fri", area: "DTLA", event_date: "2026-10-17",
    time_start: "18:00", time_end: "23:00", party_target: n, chosen_bundle_id: BUNDLE.id, venue_order_id: null, deadlines: {}, created_at: new Date(), updated_at: new Date(),
  } satisfies PlanRow);
  w.members = Array.from({ length: n }, (_, i) => ({ plan_id: PLAN_ID, user_id: `u${i + 1}`, lane: i + 1, stage: "VOTED" as LaneStage, joined_at: new Date(), first_name: `F${i + 1}`, payer_ref: ref(i + 1) }));
}
const plan = () => w.plans.get(PLAN_ID) as PlanRow;
const job = (kind: string, payload: Record<string, unknown>, attempts = 1): DueJob => ({ id: 1, plan_id: PLAN_ID, kind, dedupe_key: "k", due_at: new Date(), payload, attempts });
const sentTo = (tpl: string) => vi.mocked(notify).mock.calls.filter((c) => c[1] === tpl).map((c) => c[0]);
const fanned = (tpl: string) => vi.mocked(fanout).mock.calls.filter((c) => c[1] === tpl);

/** create_order, then every member authorizes on the mock pay page; returns the hook events in order. */
async function orderAndAuthorize(): Promise<VenueEvent[]> {
  await createOrderJob(job("create_order", { version: 4 }));
  const order = await w.venue.getOrder(plan().venue_order_id!);
  return order.shares.map((s: { share_id: string }) => w.venue.authorize(s.share_id));
}

// C's venueClient is stubbed at the seam (its modules may not exist yet in a parallel build).
const verifyVenueHook = vi.spyOn(venueClient, "verifyVenueHook");
const emitLedger = vi.spyOn(venueClient, "emitLedger").mockResolvedValue();
const emitCounters = vi.spyOn(venueClient, "emitCounters").mockResolvedValue();

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(holdGate.check).mockImplementation(async () => "link");
  seed();
});

describe("buildCreateOrderRequest", () => {
  it("maps plan, bundle and members (lane order) onto the venue contract", () => {
    const at = new Date("2026-10-18T04:40:00Z");
    const shuffled = [...w.members].reverse() as MemberRow[];
    const req = buildCreateOrderRequest(plan(), BUNDLE, shuffled, at);
    expect(req).toEqual({
      plan_ref: REF, plan_version: 4,
      bundle: {
        bundle_key: "bnd_abc", date: "2026-10-17",
        dinner: { name: "Bestia", address: "Bestia St, Los Angeles", time: "18:30", est_high_pp_usd: 40 },
        show: { name: "Echo", address: "Echo St, Los Angeles", time: "20:30", est_high_pp_usd: 20 },
      },
      party_size: 3, payer_refs: [ref(1), ref(2), ref(3)], deadline_at: at.toISOString(),
    });
  });
});

describe("create_order", () => {
  it("orders, stores pay links, sends T_PAY_LINK, moves to APPROVING and schedules the ladder", async () => {
    await createOrderJob(job("create_order", { version: 4 }));
    expect(plan().state).toBe("APPROVING");
    expect(plan().venue_order_id).toMatch(/^ord_/);
    expect(w.payLinks.size).toBe(3);
    expect(sentTo("T_PAY_LINK")).toEqual(["u1", "u2", "u3"]);
    const [, , vars, o] = vi.mocked(notify).mock.calls[0]!;
    expect(vars).toMatchObject({ title: "Dinner at Bestia → Show at The Echo", deadline: "9:40 PM", url: expect.stringMatching(/^https:\/\/mock-venue/) });
    expect(o.key).toBe(`tpl:${PLAN_ID}:u1:T_PAY_LINK:4`);
    expect(w.members.map((m) => m.stage)).toEqual(["LINK_SENT", "LINK_SENT", "LINK_SENT"]);
    const kinds = vi.mocked(enqueue).mock.calls.map((c) => [c[0], c[1]]);
    expect(kinds).toEqual([["approve_reping", `reping:${PLAN_ID}:4`], ["approve_deadline", `approve:${PLAN_ID}:4`]]);
    const approveAt = new Date(plan().deadlines.approve_at!).getTime();
    expect(vi.mocked(enqueue).mock.calls[0]![2].getTime()).toBe(approveAt - 30 * 60_000);
  });

  it("holdGate 'ask' sends T_HOLD_GATE (no link) and marks the member GATED", async () => {
    vi.mocked(holdGate.check).mockImplementation(async (_p, u) => (u === "u2" ? "ask" : "link"));
    await createOrderJob(job("create_order", { version: 4 }));
    expect(sentTo("T_PAY_LINK")).toEqual(["u1", "u3"]);
    expect(sentTo("T_HOLD_GATE")).toEqual(["u2"]);
    const call = vi.mocked(notify).mock.calls.find((c) => c[1] === "T_HOLD_GATE")!;
    expect(call[2]).toEqual({ amount: expect.any(String) });
    expect(call[3].key).toMatch(new RegExp(`T_HOLD_GATE:4:\\d+$`));
    expect(w.members[1].stage).toBe("GATED");
  });

  it("schedules voice_nudge only when VOICE_ENABLED, and uses demo windows with DEMO_TIMERS", async () => {
    w.env.VOICE_ENABLED = true;
    w.env.DEMO_TIMERS = true;
    try {
      await createOrderJob(job("create_order", { version: 4 }));
    } finally {
      w.env.VOICE_ENABLED = false;
      w.env.DEMO_TIMERS = false;
    }
    const at = new Date(plan().deadlines.approve_at!).getTime();
    const calls = vi.mocked(enqueue).mock.calls;
    expect(calls.map((c) => c[0])).toEqual(["approve_reping", "approve_deadline", "voice_nudge"]);
    expect(calls[0]![2].getTime()).toBe(at - 3 * 60_000);
    expect(calls[2]![1]).toBe(`voice:${PLAN_ID}:4`);
  });

  it("unavailable bundle → CANCELLED + T_NO_FIT, no order", async () => {
    vi.spyOn(w.venue, "checkAvailability").mockResolvedValue({ available: false });
    await createOrderJob(job("create_order", { version: 4 }));
    expect(plan().state).toBe("CANCELLED");
    expect(fanned("T_NO_FIT")).toHaveLength(1);
    expect(w.venue.orders.size).toBe(0);
  });

  it("stale version or wrong state is a no-op", async () => {
    await createOrderJob(job("create_order", { version: 3 }));
    plan().state = "VOTING";
    await createOrderJob(job("create_order", { version: 4 }));
    expect(w.venue.orders.size).toBe(0);
    expect(notify).not.toHaveBeenCalled();
  });

  it("cancel race: plan cancelled while createOrder is in flight → the orphan order is cancelled", async () => {
    const create = w.venue.createOrder.bind(w.venue);
    vi.spyOn(w.venue, "createOrder").mockImplementation(async (req) => {
      const res = await create(req);
      await cancel(PLAN_ID, "member_out"); // lands before setVenueOrder: no order id yet
      return res;
    });
    const cancelSpy = vi.spyOn(w.venue, "cancel");
    await createOrderJob(job("create_order", { version: 4 }));
    expect(plan().state).toBe("CANCELLED");
    expect(cancelSpy).toHaveBeenCalledWith(plan().venue_order_id, "plan_cancelled");
    expect((await w.venue.getOrder(plan().venue_order_id!)).status).toBe("CANCELLED");
    expect(sentTo("T_PAY_LINK")).toEqual([]);
    expect(fanned("T_CANCELLED")).toHaveLength(1);
  });

  it("a permanent venue rejection (HTTP 400) calls the plan off at once: CANCELLED + T_CANCELLED, no pay link", async () => {
    vi.spyOn(w.venue, "createOrder").mockRejectedValue(new VenueHttpError(400, { error: "bad_request" }, "createOrder"));
    await createOrderJob(job("create_order", { version: 4 }));
    expect(plan().state).toBe("CANCELLED");
    expect(fanned("T_CANCELLED")).toHaveLength(1);
    expect(fanned("T_CANCELLED")[0]![3]).toEqual({ version: 4 });
    expect(sentTo("T_PAY_LINK")).toEqual([]);
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({ type: "system", level: "error" }));
  });

  it("a transient failure (venue down, 409, 5xx) is retried until the last attempt, then the plan is called off", async () => {
    const spy = vi.spyOn(w.venue, "createOrder").mockRejectedValue(new TypeError("fetch failed"));
    await expect(createOrderJob(job("create_order", { version: 4 }, 1))).rejects.toThrow("fetch failed");
    spy.mockRejectedValue(new VenueHttpError(409, {}, "createOrder"));
    await expect(createOrderJob(job("create_order", { version: 4 }, 7))).rejects.toThrow("HTTP 409");
    expect(plan().state).toBe("ORDERING");
    expect(fanout).not.toHaveBeenCalled();
    spy.mockRejectedValue(new VenueHttpError(503, {}, "createOrder"));
    await createOrderJob(job("create_order", { version: 4 }, 8)); // CREATE_ORDER_MAX_ATTEMPTS
    expect(plan().state).toBe("CANCELLED");
    expect(fanned("T_CANCELLED")).toHaveLength(1);
  });

  it("a plan cancelled by someone else while create_order was failing is left alone", async () => {
    vi.spyOn(w.venue, "createOrder").mockRejectedValue(new VenueHttpError(400, {}, "createOrder"));
    vi.spyOn(w.venue, "checkAvailability").mockImplementation(async () => {
      plan().state = "CANCELLED";
      return { available: true };
    });
    await createOrderJob(job("create_order", { version: 4 }));
    expect(plan().state).toBe("CANCELLED");
    expect(fanout).not.toHaveBeenCalled();
  });

  it("retry after a crash past createOrder resumes from stored pay links without a second order", async () => {
    vi.mocked(transition).mockRejectedValueOnce(new Error("crash")); // dies after setVenueOrder, before APPROVING
    await expect(createOrderJob(job("create_order", { version: 4 }))).rejects.toThrow("crash");
    expect(plan().state).toBe("ORDERING");
    expect(notify).not.toHaveBeenCalled();
    await createOrderJob(job("create_order", { version: 4 }, 2));
    expect(w.venue.orders.size).toBe(1);
    expect(plan().state).toBe("APPROVING");
    expect(sentTo("T_PAY_LINK")).toEqual(["u1", "u2", "u3"]);
  });
});

describe("venue hook → commit (exactly once) → confirm", () => {
  it("share.authorized: HELD, T_HELD, T_IN_COUNT k/n, ledger, one commit job per share", async () => {
    const [ev] = await orderAndAuthorize();
    vi.mocked(notify).mockClear();
    await dispatchVenueEvent(ev!);
    expect(w.members[0].stage).toBe("HELD");
    const held = vi.mocked(notify).mock.calls.find((c) => c[1] === "T_HELD")!;
    expect(held[2]).toEqual({ amount: expect.any(String), brand: "Visa", last4: "1111" });
    const [inCount] = fanned("T_IN_COUNT");
    expect((inCount![2] as (r: unknown) => unknown)(w.members[0])).toEqual({ k: 1, n: 3 });
    expect(inCount![3]).toMatchObject({ version: 4, suffix: 1 });
    expect(emitLedger).toHaveBeenCalledWith(ev);
    const commitCall = vi.mocked(enqueue).mock.calls.find((c) => c[0] === "commit")!;
    expect(commitCall[1]).toBe(`commit:${PLAN_ID}:4:${ev!.share_id}`);
    expect(commitCall[3]).toEqual({ version: 4, share_id: ev!.share_id });
  });

  it("early commit jobs are no-ops; the last share's job captures exactly once and confirms", async () => {
    await createOrderJob(job("create_order", { version: 4 }));
    const shares = (await w.venue.getOrder(plan().venue_order_id!)).shares as { share_id: string }[];
    const commitSpy = vi.spyOn(w.venue, "commit");
    for (const s of shares.slice(0, 2)) {
      w.venue.authorize(s.share_id);
      await commitJob(job("commit", { version: 4, share_id: s.share_id }));
    }
    expect(commitSpy).not.toHaveBeenCalled();
    expect(plan().state).toBe("APPROVING");
    w.venue.authorize(shares[2]!.share_id);
    await commitJob(job("commit", { version: 4, share_id: shares[2]!.share_id }));
    await commitJob(job("commit", { version: 4, share_id: shares[2]!.share_id }));
    expect(commitSpy).toHaveBeenCalledTimes(1);
    expect(plan().state).toBe("CONFIRMED");
    // The mock venue delivered share.captured per share through the venue-hook dispatch, like the live venue.
    expect(w.members.map((m) => m.stage)).toEqual(["CAPTURED", "CAPTURED", "CAPTURED"]);
    expect(vi.mocked(emitLedger).mock.calls.map(([ev]) => ev.type)).toEqual(["share.captured", "share.captured", "share.captured"]);
    expect(fanned("T_CAPTURED")).toHaveLength(1);
    const [, , varsFor, o] = fanned("T_CAPTURED")[0]!;
    expect((varsFor as (r: MemberRow) => unknown)(w.members[0])).toEqual({ title: "Dinner at Bestia → Show at The Echo", amount: expect.stringMatching(/^\d+\.\d\d$/) });
    expect(o).toMatchObject({ version: 4 });
    expect(emitCounters).toHaveBeenCalledTimes(1);
    expect(startConciergeFor).toHaveBeenCalledWith(PLAN_ID);
    expect((await w.venue.getOrder(plan().venue_order_id!)).status).toBe("CAPTURED");
  });

  it("a commit job before every share is AUTHORIZED does nothing", async () => {
    await createOrderJob(job("create_order", { version: 4 }));
    const order = await w.venue.getOrder(plan().venue_order_id!);
    w.venue.authorize(order.shares[0].share_id);
    const commitSpy = vi.spyOn(w.venue, "commit");
    await commitJob(job("commit", { version: 4, share_id: order.shares[0].share_id }));
    expect(commitSpy).not.toHaveBeenCalled();
    expect(plan().state).toBe("APPROVING");
  });

  it("rejected commit on an OPEN order cancels the plan (T_CANCELLED, nobody named)", async () => {
    await orderAndAuthorize();
    vi.spyOn(w.venue, "commit").mockResolvedValue({ order_id: "x", result: "rejected", tap: {} as never, captures: [] });
    await commitJob(job("commit", { version: 4, share_id: "s" }));
    expect(plan().state).toBe("CANCELLED");
    expect(fanned("T_CANCELLED")).toHaveLength(1);
    expect((fanned("T_CANCELLED")[0]![2] as () => unknown)()).toEqual({});
  });

  it("CommitPendingError waits for order.captured, which then confirms", async () => {
    await orderAndAuthorize();
    const pending = Object.assign(new Error("pending"), { name: "CommitPendingError" });
    vi.spyOn(w.venue, "commit").mockRejectedValue(pending);
    await commitJob(job("commit", { version: 4, share_id: "s" }));
    expect(plan().state).toBe("COMMITTING");
    await dispatchVenueEvent({ event_id: "e1", at: new Date().toISOString(), order_id: plan().venue_order_id!, plan_ref: REF, type: "order.captured", share_id: null, payer_ref: null, data: {} });
    expect(plan().state).toBe("CONFIRMED");
    expect(fanned("T_CAPTURED")).toHaveLength(1);
  });

  it("partial → system error, no DMs", async () => {
    await orderAndAuthorize();
    vi.mocked(notify).mockClear();
    vi.spyOn(w.venue, "commit").mockResolvedValue({ order_id: "x", result: "partial", tap: {} as never, captures: [] });
    await commitJob(job("commit", { version: 4, share_id: "s" }));
    expect(emit).toHaveBeenCalledWith({ type: "system", level: "error", msg: "capture needs attention" });
    expect(notify).not.toHaveBeenCalled();
    expect(fanout).not.toHaveBeenCalled();
  });

  it("a retried winner finds COMMITTING and still commits; a first-attempt sibling does not", async () => {
    await orderAndAuthorize();
    const real = w.venue.commit.bind(w.venue);
    const spy = vi.spyOn(w.venue, "commit").mockRejectedValueOnce(new Error("ETIMEDOUT"));
    await expect(commitJob(job("commit", { version: 4, share_id: "s" }))).rejects.toThrow("ETIMEDOUT");
    expect(plan().state).toBe("COMMITTING");
    spy.mockImplementation(real);
    await commitJob(job("commit", { version: 4, share_id: "other" }, 1));
    expect(spy).toHaveBeenCalledTimes(1);
    await commitJob(job("commit", { version: 4, share_id: "s" }, 2));
    expect(spy).toHaveBeenCalledTimes(2);
    expect(plan().state).toBe("CONFIRMED");
  });

  it("rejected commit because the venue's deadline sweep already cancelled the order → CANCELLED + T_CANCELLED, never stuck in COMMITTING", async () => {
    await orderAndAuthorize();
    const orderId = plan().venue_order_id!;
    vi.spyOn(w.venue, "commit").mockImplementation(async () => {
      await w.venue.cancel(orderId, "deadline_passed"); // the venue's sweep wins the race
      return { order_id: orderId, result: "rejected", tap: {} as never, captures: [] };
    });
    await commitJob(job("commit", { version: 4, share_id: "s" }));
    expect(plan().state).toBe("CANCELLED");
    expect(fanned("T_CANCELLED")).toHaveLength(1);
  });

  it("order.cancelled while COMMITTING finishes the plan (the venue only emits it once nothing was captured)", async () => {
    await orderAndAuthorize();
    plan().state = "COMMITTING";
    await dispatchVenueEvent({ event_id: "e_c", at: new Date().toISOString(), order_id: plan().venue_order_id!, plan_ref: REF, type: "order.cancelled", share_id: null, payer_ref: null, data: { reason: "deadline_passed" } });
    expect(plan().state).toBe("CANCELLED");
    expect(fanned("T_CANCELLED")).toHaveLength(1);
  });

  it("a retried commit job that finds the order CANCELLED finishes a COMMITTING plan", async () => {
    await orderAndAuthorize();
    plan().state = "COMMITTING";
    await w.venue.cancel(plan().venue_order_id!, "deadline_passed");
    await commitJob(job("commit", { version: 4, share_id: "s" }, 2));
    expect(plan().state).toBe("CANCELLED");
  });

  it("post_confirm backstop: T_CAPTURED only to members whose send never settled, counters and concierge again", async () => {
    await orderAndAuthorize();
    plan().state = "CONFIRMED";
    vi.mocked(usersSettledTemplate).mockResolvedValueOnce(new Set(["u1", "u3"]));
    await postConfirmJob(job("post_confirm", { version: 4 }));
    const [, , varsFor, o] = fanned("T_CAPTURED")[0]!;
    const only = (o as unknown as { only: (r: MemberRow) => boolean }).only;
    expect(only(w.members[1])).toBe(true);
    expect(only(w.members[0])).toBe(false);
    expect((varsFor as (r: MemberRow) => unknown)(w.members[1])).toEqual({ title: "Dinner at Bestia → Show at The Echo", amount: expect.stringMatching(/^\d+\.\d\d$/) });
    expect(emitCounters).toHaveBeenCalledTimes(1);
    expect(startConciergeFor).toHaveBeenCalledWith(PLAN_ID);
  });

  it("post_confirm backstop: everyone settled → no second fan-out; wrong state or version → no-op", async () => {
    await orderAndAuthorize();
    plan().state = "CONFIRMED";
    vi.mocked(usersSettledTemplate).mockResolvedValueOnce(new Set(["u1", "u2", "u3"]));
    await postConfirmJob(job("post_confirm", { version: 4 }));
    expect(fanned("T_CAPTURED")).toHaveLength(0);
    vi.mocked(startConciergeFor).mockClear();
    await postConfirmJob(job("post_confirm", { version: 3 }));
    plan().state = "CANCELLED";
    await postConfirmJob(job("post_confirm", { version: 4 }));
    expect(startConciergeFor).not.toHaveBeenCalled();
  });

  it("confirm is idempotent", async () => {
    plan().state = "COMMITTING";
    await confirm(PLAN_ID);
    await confirm(PLAN_ID);
    expect(emitCounters).toHaveBeenCalledTimes(1);
    expect(startConciergeFor).toHaveBeenCalledTimes(1);
  });
});

describe("share-level hook events", () => {
  const base = (type: VenueEvent["type"], data: Record<string, unknown>, payer = 2): VenueEvent => ({
    event_id: `evt_${type}`, at: new Date().toISOString(), order_id: "ord_x", plan_ref: REF, type, share_id: "shr_new", payer_ref: ref(payer), data,
  });

  beforeEach(async () => {
    await createOrderJob(job("create_order", { version: 4 }));
    vi.mocked(notify).mockClear();
  });

  it("share.declined → T_DECLINED_RETRY to that person only (key suffix event_id) and the stored link is replaced", async () => {
    const url = "https://mock-venue.invalid/pay/fresh";
    await dispatchVenueEvent(base("share.declined", { pay_url: url, expires_at: "2026-10-18T05:00:00.000Z" }));
    expect(vi.mocked(notify).mock.calls).toEqual([["u2", "T_DECLINED_RETRY", { url }, { key: `tpl:${PLAN_ID}:u2:T_DECLINED_RETRY:4:evt_share.declined`, planId: PLAN_ID }]]);
    expect(w.payLinks.get(`${PLAN_ID}:u2:4`).pay_url).toBe(url);
    expect(fanout).not.toHaveBeenCalled();
    expect(emitLedger).toHaveBeenCalled();
  });

  it("share.released{retry:true} → T_HOLD_RELEASED_RETRY (never 'declined': the card was fine) + LINK_SENT; plain release → RELEASED", async () => {
    w.members[1].stage = "HELD";
    const url = "https://mock-venue.invalid/pay/r";
    await dispatchVenueEvent(base("share.released", { retry: true, pay_url: url, expires_at: "2026-10-18T05:00:00Z" }));
    expect(vi.mocked(notify).mock.calls).toEqual([["u2", "T_HOLD_RELEASED_RETRY", { url }, { key: `tpl:${PLAN_ID}:u2:T_HOLD_RELEASED_RETRY:4:evt_share.released`, planId: PLAN_ID }]]);
    expect(sentTo("T_DECLINED_RETRY")).toEqual([]);
    expect(w.payLinks.get(`${PLAN_ID}:u2:4`).pay_url).toBe(url);
    expect(w.members[1].stage).toBe("LINK_SENT");
    vi.mocked(notify).mockClear();
    await dispatchVenueEvent(base("share.released", { retry: false }, 3));
    expect(notify).not.toHaveBeenCalled();
    expect(w.members[2].stage).toBe("RELEASED");
  });

  it("share.captured → CAPTURED; auth_unknown → ledger only; needs_attention → system error, no DMs", async () => {
    await dispatchVenueEvent(base("share.captured", { amount_cents: 8000 }, 1));
    expect(w.members[0].stage).toBe("CAPTURED");
    await dispatchVenueEvent(base("share.auth_unknown", {}, 3));
    expect(w.members[2].stage).toBe("LINK_SENT");
    await dispatchVenueEvent({ ...base("order.needs_attention", { share_ids: [] }), payer_ref: null, share_id: null });
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({ type: "system", level: "error" }));
    expect(notify).not.toHaveBeenCalled();
    expect(emitLedger).toHaveBeenCalledTimes(2);
  });

  it("a late or redelivered share.authorized never moves a CAPTURED lane back to HELD, but still checks the commit", async () => {
    w.members[0].stage = "CAPTURED";
    await dispatchVenueEvent(base("share.authorized", { amount_cents: 8000, card_brand: "VISA", card_last4: "1111" }, 1));
    expect(w.members[0].stage).toBe("CAPTURED");
    expect(notify).not.toHaveBeenCalled();
    expect(fanout).not.toHaveBeenCalled();
    expect(emitLedger).toHaveBeenCalledTimes(1);
    expect(vi.mocked(enqueue).mock.calls.filter((c) => c[0] === "commit").map((c) => c[1])).toEqual([`commit:${PLAN_ID}:4:shr_new`]);
  });

  it("a redelivered share.authorized for a HELD lane (first dispatch failed part-way) skips the stage write but finishes the keyed messages", async () => {
    w.members[1].stage = "HELD";
    const { setStage } = await import("../src/plan/membership");
    vi.mocked(setStage).mockClear();
    await dispatchVenueEvent(base("share.authorized", { amount_cents: 8000, card_brand: "VISA", card_last4: "1111" }, 2));
    expect(setStage).not.toHaveBeenCalled();
    expect(sentTo("T_HELD")).toEqual(["u2"]);
    expect(vi.mocked(notify).mock.calls.find((c) => c[1] === "T_HELD")![3].key).toBe(`tpl:${PLAN_ID}:u2:T_HELD:4`);
    expect(fanned("T_IN_COUNT")).toHaveLength(1);
    expect(vi.mocked(enqueue).mock.calls.some((c) => c[0] === "commit")).toBe(true);
  });

  it("order.cancelled finishes a CANCELLING plan once (T_CANCELLED + counters)", async () => {
    plan().state = "CANCELLING";
    const ev = { ...base("order.cancelled", { reason: "member_out" }), payer_ref: null, share_id: null };
    await dispatchVenueEvent(ev);
    await dispatchVenueEvent(ev);
    expect(plan().state).toBe("CANCELLED");
    expect(fanned("T_CANCELLED")).toHaveLength(1);
    expect(emitCounters).toHaveBeenCalledTimes(1);
  });
});

describe("cancel", () => {
  it("APPROVING with an order: venue cancel → CANCELLED, T_CANCELLED to all, counters, research cancelled", async () => {
    await orderAndAuthorize();
    await cancel(PLAN_ID, "member_out");
    expect(plan().state).toBe("CANCELLED");
    expect((await w.venue.getOrder(plan().venue_order_id!)).status).toBe("CANCELLED");
    expect(fanned("T_CANCELLED")).toHaveLength(1);
    expect(fanned("T_CANCELLED")[0]![3]).toEqual({ version: 4 }); // every recipient, same nameless template
    expect(emitCounters).toHaveBeenCalledTimes(1);
    expect(cancelResearch).toHaveBeenCalledWith(PLAN_ID);
  });

  it("venue cancel not final → stays CANCELLING until order.cancelled", async () => {
    await createOrderJob(job("create_order", { version: 4 }));
    vi.spyOn(w.venue, "cancel").mockResolvedValue({ status: "CANCELLING" } as never);
    await cancel(PLAN_ID, "deadline");
    expect(plan().state).toBe("CANCELLING");
    expect(fanned("T_CANCELLED")).toHaveLength(0);
  });

  it("is a no-op outside ORDERING/APPROVING/COMMITTING", async () => {
    plan().state = "CONFIRMED";
    await cancel(PLAN_ID, "organizer");
    expect(plan().state).toBe("CONFIRMED");
    expect(fanout).not.toHaveBeenCalled();
  });

  it("venue failure leaves CANCELLING with a system error instead of throwing", async () => {
    await createOrderJob(job("create_order", { version: 4 }));
    vi.spyOn(w.venue, "cancel").mockRejectedValue(new Error("ECONNRESET"));
    await cancel(PLAN_ID, "member_out");
    expect(plan().state).toBe("CANCELLING");
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({ type: "system", level: "error" }));
  });
});

describe("POST /venue/hook", () => {
  const app = new Hono();
  mountVenueHook(app);
  const post = (body = "{}") => app.request("/venue/hook", { method: "POST", body, headers: { "content-type": "application/json" } });

  it("401 when C's verifier rejects; raw body is passed through untouched", async () => {
    verifyVenueHook.mockResolvedValue(null);
    const res = await post('{"a": 1}');
    expect(res.status).toBe(401);
    expect(verifyVenueHook.mock.calls[0]![0]).toBe('{"a": 1}');
  });

  it("200 only after the dispatch finished and was marked seen; a replayed event_id is not dispatched again", async () => {
    plan().state = "COMMITTING";
    const ev: VenueEvent = { event_id: "evt_cap", at: new Date().toISOString(), order_id: "o", plan_ref: REF, type: "order.captured", share_id: null, payer_ref: null, data: {} };
    verifyVenueHook.mockResolvedValue(ev);
    expect((await post()).status).toBe(200);
    expect(w.seen.has("evt_cap")).toBe(true);
    expect(plan().state).toBe("CONFIRMED");
    expect((await post()).status).toBe(200);
    expect(vi.mocked(transition).mock.calls.filter((c) => c[2] === "CONFIRMED")).toHaveLength(1);
  });

  it("a failed dispatch answers 500 and stays unseen, so the venue's sweep redelivers it (it never resends a 2xx)", async () => {
    plan().state = "COMMITTING";
    const ev: VenueEvent = { event_id: "evt_lost", at: new Date().toISOString(), order_id: "o", plan_ref: REF, type: "order.captured", share_id: null, payer_ref: null, data: {} };
    verifyVenueHook.mockResolvedValue(ev);
    vi.mocked(transition).mockRejectedValueOnce(Object.assign(new Error("connection closed"), { code: "CONNECTION_CLOSED" }));
    expect((await post()).status).toBe(500);
    expect(w.seen.has("evt_lost")).toBe(false);
    expect(plan().state).toBe("COMMITTING");
    expect((await post()).status).toBe(200); // the redelivery
    expect(w.seen.has("evt_lost")).toBe(true);
    expect(plan().state).toBe("CONFIRMED");
  });
});

describe("displayBrand", () => {
  it.each([["VISA", "Visa"], ["visa", "Visa"], ["001", "Visa"], ["MASTERCARD", "Mastercard"], ["002", "Mastercard"], ["AMEX", "Amex"], ["american_express", "Amex"], ["003", "Amex"], ["DISCOVER", null], [null, null], [7, null]])(
    "%s → %s",
    (raw, out) => expect(displayBrand(raw)).toBe(out),
  );
});

