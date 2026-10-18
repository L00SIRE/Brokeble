// VENUE_MODE=mock: an in-memory stand-in for apps/venue. It prices with the shared priceBundle() (M3), holds only
// fake authorizations, captures only when every share is AUTHORIZED and the consent set matches (M4), and returns a
// TapVerifyReport labelled as mock (no signature exists in mock mode). `authorize()` simulates the pay page.
// Like the live client (venueClient commitOnce), commit() puts the report on the console as `tap.verify`; it never emits
// `tap.signed`, because nothing is signed here, and the console labels a report without one as the simulation.
import { randomBytes } from "node:crypto";
import {
  type CommitResult,
  type ConsentSet,
  CreateOrderRequest,
  type CreateOrderResponse,
  type OrderItem,
  type OrderStatus,
  type SseEvent,
  type Share,
  TAX,
  TIP,
  type TapStep,
  type TapVerifyReport,
  type VenueEvent,
  orderTotalCents,
  priceBundle,
} from "@tab/shared";
import { canonicalConsent } from "@tab/shared/tap";
import type { TapTestKind, VenuePort } from "./types";

type MockOrder = Omit<OrderStatus, "updated_at" | "shares"> & { deadline_at: string; shares: Share[]; updated_at: Date };
const id = (prefix: string) => prefix + randomBytes(8).toString("hex").slice(0, 10);
const STEPS: TapStep["name"][] = ["tag", "params", "timestamps", "nonce", "key", "signature"];
const FAIL_AT: Record<TapTestKind, number> = { wrong_tag: 1, expired: 3, replay: 4, tamper: 6 };

export type MockVenueDeps = { emit?: (ev: SseEvent) => Promise<unknown> | void };

export class MockVenue implements VenuePort {
  readonly orders = new Map<string, MockOrder>();

  constructor(private readonly deps: MockVenueDeps = {}) {}

  async checkAvailability(_bundleKey: string): Promise<{ available: boolean }> {
    return { available: true };
  }

  async createOrder(input: CreateOrderRequest): Promise<CreateOrderResponse> {
    const req = CreateOrderRequest.parse(input);
    if (req.payer_refs.length !== req.party_size) throw new Error("payer_refs.length must equal party_size");
    const existing = [...this.orders.values()].find((o) => o.plan_ref === req.plan_ref && o.plan_version === req.plan_version);
    if (existing) throw new Error(`order exists for plan_ref/version (${existing.order_id})`); // venue: unique (plan_ref, plan_version)
    const share = priceBundle(req.bundle);
    const dinnerPp = Math.round(req.bundle.dinner.est_high_pp_usd * 100 * (1 + TAX + TIP));
    const items: OrderItem[] = [
      { kind: "dinner", name: req.bundle.dinner.name, address: req.bundle.dinner.address, time: req.bundle.dinner.time, unit_price_pp_cents: dinnerPp, qty: req.party_size },
      { kind: "show", name: req.bundle.show.name, address: req.bundle.show.address, time: req.bundle.show.time, unit_price_pp_cents: share - dinnerPp, qty: req.party_size },
    ];
    const order: MockOrder = {
      order_id: id("ord_"), plan_ref: req.plan_ref, plan_version: req.plan_version, status: "OPEN",
      total_cents: orderTotalCents(share, req.party_size), deadline_at: req.deadline_at, updated_at: new Date(),
      shares: req.payer_refs.map((payer_ref) => ({ share_id: id("shr_"), payer_ref, amount_cents: share, status: "PENDING", cybs_payment_id: null, card_last4: null })),
    };
    this.orders.set(order.order_id, order);
    return {
      order_id: order.order_id, total_cents: order.total_cents, currency: "USD", items,
      shares: order.shares.map((s) => ({
        share_id: s.share_id, payer_ref: s.payer_ref, amount_cents: s.amount_cents,
        pay_url: `https://mock-venue.invalid/pay/${randomBytes(16).toString("hex")}`, expires_at: order.deadline_at,
      })),
    };
  }

  async getOrder(orderId: string): Promise<OrderStatus> {
    return this.view(this.get(orderId));
  }

  async commit(orderId: string, consent: ConsentSet, test?: TapTestKind): Promise<CommitResult> {
    const result = this.commitResult(orderId, consent, test);
    await this.deps.emit?.({ type: "tap.verify", order_id: orderId, report: result.tap });
    return result;
  }

  private commitResult(orderId: string, consent: ConsentSet, test?: TapTestKind): CommitResult {
    const o = this.get(orderId);
    const failAt = test ? FAIL_AT[test] : null;
    const steps: TapStep[] = STEPS.map((name, i) => ({
      n: i + 1, name, ok: failAt === null || i + 1 < failAt,
      detail: failAt === i + 1 ? `rejected (mock ${test})` : failAt !== null && i + 1 > failAt ? "not reached" : "mock venue: no signature in mock mode",
    }));
    const route = `POST /checkout/${orderId}`;
    if (failAt !== null) {
      const tap: TapVerifyReport = { route, tag: "agent-payer-auth", steps, business: null, accepted: false, reason: `mock ${test}`, signature_base: "" };
      return { order_id: orderId, result: "rejected", tap, captures: [] };
    }
    const expected = canonicalConsent({
      order_id: o.order_id, total_cents: o.total_cents,
      shares: o.shares.map((s) => ({ share_id: s.share_id, cybs_payment_id: s.cybs_payment_id ?? "", amount_cents: s.amount_cents })),
    });
    const business = {
      all_authorized: o.shares.every((s) => s.status === "AUTHORIZED" || s.status === "CAPTURED"),
      sum_matches: o.shares.reduce((n, s) => n + s.amount_cents, 0) === o.total_cents,
      consent_matches: canonicalConsent(consent) === expected,
    };
    const ok = (o.status === "OPEN" || o.status === "CAPTURED") && business.all_authorized && business.sum_matches && business.consent_matches;
    const tap: TapVerifyReport = { route, tag: "agent-payer-auth", steps, business, accepted: ok, reason: ok ? null : "business check failed", signature_base: "" };
    if (!ok) return { order_id: orderId, result: "rejected", tap, captures: [] };
    for (const s of o.shares) s.status = "CAPTURED"; // idempotent on an already-captured order, like the venue
    this.touch(o, "CAPTURED");
    return { order_id: orderId, result: "captured", tap, captures: o.shares.map((s) => ({ share_id: s.share_id, status: s.status, cybs_capture_id: `mock_cap_${s.share_id}` })) };
  }

  async cancel(orderId: string, _reason: string): Promise<OrderStatus> {
    const o = this.get(orderId);
    if (o.status === "CAPTURED" || o.status === "COMMITTING") return this.view(o);
    for (const s of o.shares) {
      if (s.status === "AUTHORIZED") s.status = "RELEASED";
      else if (s.status === "PENDING" || s.status === "DECLINED") s.status = "VOID";
    }
    this.touch(o, "CANCELLED");
    return this.view(o);
  }

  /** Simulates a cardholder on the pay page. Returns the VenueEvent the real venue would post to /venue/hook. */
  authorize(shareId: string, outcome: "authorized" | "declined" = "authorized"): VenueEvent {
    const o = [...this.orders.values()].find((x) => x.shares.some((s) => s.share_id === shareId));
    const s = o?.shares.find((x) => x.share_id === shareId);
    if (!o || !s) throw new Error(`mock venue: unknown share ${shareId}`);
    if (o.status !== "OPEN" || s.status !== "PENDING") throw new Error(`mock venue: share ${shareId} is ${s.status} on a ${o.status} order`);
    const base = { event_id: id("evt_"), at: new Date().toISOString(), order_id: o.order_id, plan_ref: o.plan_ref, share_id: s.share_id, payer_ref: s.payer_ref };
    if (outcome === "declined") {
      s.status = "DECLINED";
      this.touch(o);
      return { ...base, type: "share.declined", data: { pay_url: `https://mock-venue.invalid/pay/${randomBytes(16).toString("hex")}`, expires_at: o.deadline_at } };
    }
    s.status = "AUTHORIZED";
    s.cybs_payment_id = `mock_pay_${randomBytes(6).toString("hex")}`;
    s.card_last4 = "1111";
    this.touch(o);
    return { ...base, type: "share.authorized", data: { amount_cents: s.amount_cents, card_brand: "VISA", card_last4: "1111", cybs_payment_id_short: s.cybs_payment_id.slice(-8) } };
  }

  private get(orderId: string): MockOrder {
    const o = this.orders.get(orderId);
    if (!o) throw new Error(`mock venue: unknown order ${orderId}`);
    return o;
  }
  private touch(o: MockOrder, status?: OrderStatus["status"]): void {
    if (status) o.status = status;
    o.updated_at = new Date();
  }
  private view(o: MockOrder): OrderStatus {
    const { deadline_at: _d, ...rest } = o;
    return { ...rest, shares: o.shares.map((s) => ({ ...s })), updated_at: o.updated_at.toISOString() };
  }
}
