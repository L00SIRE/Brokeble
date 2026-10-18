// VENUE_MODE=mock delivers venue → agent events through the venue-hook dispatch (dedupe, dispatchVenueEvent, mark seen),
// the same steps handleVenueHook runs for the live venue's signed POST /venue/hook.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CreateOrderRequest, VenueEvent } from "@tab/shared";
import { consentFromOrder } from "@tab/shared/tap";

const seen = new Set<string>();
vi.mock("../src/plan/venueHook", () => ({ dispatchVenueEvent: vi.fn(async () => {}) }));
vi.mock("../src/repo/inboundEvents", () => ({
  seenInbound: vi.fn(async (_src: string, id: string) => seen.has(id)),
  markInboundSeen: vi.fn(async (_src: string, id: string) => void seen.add(id)),
}));

const { dispatchVenueEvent } = await import("../src/plan/venueHook");
const { markInboundSeen } = await import("../src/repo/inboundEvents");
const { MockVenue, deliverToVenueHook } = await import("../src/ports/venue.mock");

const PLAN_REF = "22222222-2222-4222-8222-222222222222";
const orderReq = (party: number): CreateOrderRequest => ({
  plan_ref: PLAN_REF, plan_version: 1, party_size: party, deadline_at: "2026-10-18T06:00:00.000Z",
  payer_refs: Array.from({ length: party }, (_, i) => String(i + 1).repeat(32)),
  bundle: {
    bundle_key: "bnd_0123456789", date: "2026-10-18",
    dinner: { name: "Dinner A", address: "100 Main St", time: "18:30", est_high_pp_usd: 14 },
    show: { name: "Show A", address: "101 Main St", time: "20:00", est_high_pp_usd: 14 },
  },
});
const dispatched = () => vi.mocked(dispatchVenueEvent).mock.calls.map(([ev]) => ev as VenueEvent);

beforeEach(() => {
  seen.clear();
  vi.mocked(dispatchVenueEvent).mockClear();
  vi.mocked(markInboundSeen).mockClear();
});

describe("MockVenue default delivery (venue-hook path)", () => {
  it("commit dispatches share.captured for every share and marks each event seen", async () => {
    const v = new MockVenue();
    const { order_id, shares } = await v.createOrder(orderReq(2));
    shares.forEach((s) => v.authorize(s.share_id));
    expect((await v.commit(order_id, consentFromOrder(await v.getOrder(order_id)))).result).toBe("captured");
    expect(dispatched().map((e) => [e.type, e.payer_ref])).toEqual(shares.map((s) => ["share.captured", s.payer_ref]));
    expect(vi.mocked(markInboundSeen).mock.calls.map((c) => c[1])).toEqual(dispatched().map((e) => e.event_id));
  });

  it("cancel dispatches share.released for each released hold", async () => {
    const v = new MockVenue();
    const { order_id, shares } = await v.createOrder(orderReq(2));
    v.authorize(shares[1]!.share_id);
    await v.cancel(order_id, "member_out");
    expect(dispatched().map((e) => [e.type, e.share_id, e.data])).toEqual([["share.released", shares[1]!.share_id, { retry: false }]]);
  });

  it("deliverToVenueHook skips an event already seen and does not mark a failed dispatch seen", async () => {
    const ev: VenueEvent = { event_id: "evt_dup", at: new Date().toISOString(), order_id: "ord_x", plan_ref: PLAN_REF, type: "share.captured", share_id: "shr_x", payer_ref: "p", data: {} };
    await deliverToVenueHook(ev);
    await deliverToVenueHook(ev);
    expect(dispatchVenueEvent).toHaveBeenCalledTimes(1);

    vi.mocked(dispatchVenueEvent).mockRejectedValueOnce(new Error("db blip"));
    const ev2 = { ...ev, event_id: "evt_fail" };
    await expect(deliverToVenueHook(ev2)).rejects.toThrow("db blip");
    expect(seen.has("evt_fail")).toBe(false);
  });
});
