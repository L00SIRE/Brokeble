// Every "break it" press (tamper, replay, expired, wrong_tag) in every order state: rejected at the right step, never
// captured, never a 5xx. MockVenue models the states; LiveVenue is driven through a fake fetch to prove what goes on the wire.
import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { canonicalConsent } from "@tab/shared/tap";
import type { CreateOrderRequest } from "@tab/shared";
import { env } from "../src/env";

const m = vi.hoisted(() => ({ latest: vi.fn(), venue: {} as { current: unknown } }));
vi.mock("../src/repo/plans", () => ({ latestPlanWithOrder: m.latest }));
vi.mock("../src/ports", () => ({
  ports: {
    get venue() {
      return m.venue.current;
    },
  },
}));

const { MockVenue } = await import("../src/ports/venue.mock");
const { LiveVenue, VenueHttpError } = await import("../src/venueClient");
const { mountOps } = await import("../src/ops/routes");

const KINDS = ["tamper", "replay", "expired", "wrong_tag"] as const;
const STEP = { wrong_tag: 1, expired: 3, replay: 4, tamper: 6 } as const;

const orderReq = (): CreateOrderRequest => ({
  plan_ref: "11111111-1111-4111-8111-111111111111", plan_version: 1, party_size: 2, deadline_at: "2026-10-18T06:00:00.000Z",
  payer_refs: ["a".repeat(32), "b".repeat(32)],
  bundle: {
    bundle_key: "bnd_0123456789", date: "2026-10-18",
    dinner: { name: "D", address: "1 A St", time: "18:30", est_high_pp_usd: 14 },
    show: { name: "S", address: "2 A St", time: "20:00", est_high_pp_usd: 14 },
  },
});

const app = new Hono();
mountOps(app);
const press = (kind: string) =>
  app.request("/ops/tap-test", { method: "POST", headers: { authorization: "Bearer operator-key-0123456789", "content-type": "application/json" }, body: JSON.stringify({ kind }) });

async function setup(state: "partial" | "held" | "captured" | "cancelled") {
  const v = new MockVenue({ deliver: null });
  const { order_id, shares } = await v.createOrder(orderReq());
  m.venue.current = v;
  m.latest.mockResolvedValue({ venue_order_id: order_id });
  v.authorize(shares[0]!.share_id);
  if (state !== "partial") v.authorize(shares[1]!.share_id);
  if (state === "captured") {
    const o = await v.getOrder(order_id);
    await v.commit(order_id, { order_id, total_cents: o.total_cents, shares: o.shares.map((s) => ({ share_id: s.share_id, cybs_payment_id: s.cybs_payment_id ?? "", amount_cents: s.amount_cents })) });
  }
  if (state === "cancelled") await v.cancel(order_id, "test");
  return { v, order_id };
}

beforeEach(() => {
  vi.resetAllMocks();
  Object.assign(env, { OPERATOR_KEY: "operator-key-0123456789" });
});

describe("POST /ops/tap-test in every state", () => {
  it.each(KINDS)("%s with no order: 409 no_order with a readable message", async (kind) => {
    m.latest.mockResolvedValue(null);
    const res = await press(kind);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ ok: false, error: "no_order", message: expect.stringContaining("No order") });
  });

  describe.each(["partial", "held", "captured", "cancelled"] as const)("order state %s", (state) => {
    it.each(KINDS)("%s is rejected at its step and never changes the order", async (kind) => {
      const { v, order_id } = await setup(state);
      const before = await v.getOrder(order_id);
      const res = await press(kind);
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ ok: true, result: "rejected", expected_step: STEP[kind], failed_step: STEP[kind], matched: true, captured: false });
      const after = await v.getOrder(order_id);
      expect(after.status).toBe(before.status);
      expect(after.shares.map((s) => s.status)).toEqual(before.shares.map((s) => s.status));
    });
  });

  it("an order the venue does not know is a 424, not a 500", async () => {
    m.venue.current = new MockVenue({ deliver: null });
    m.latest.mockResolvedValue({ venue_order_id: "ord_missing" });
    const res = await press("replay");
    expect(res.status).toBe(424);
    expect(((await res.json()) as { message: string }).message).toMatch(/venue/i);
  });

  it("venue 4xx maps to 409, an outage to 424, a DB error to 424", async () => {
    m.latest.mockResolvedValue({ venue_order_id: "o" });
    m.venue.current = { getOrder: async () => { throw new VenueHttpError(404, {}, "getOrder"); } };
    expect((await press("tamper")).status).toBe(409);
    m.venue.current = { getOrder: async () => { throw new TypeError("fetch failed"); } };
    expect((await press("tamper")).status).toBe(424);
    m.latest.mockRejectedValue(new Error("db down"));
    expect((await press("tamper")).status).toBe(424);
  });
});

describe("LiveVenue test requests can never commit", () => {
  const consent = {
    order_id: "ord_1", total_cents: 200,
    shares: [{ share_id: "shr_a", cybs_payment_id: "p1", amount_cents: 100 }, { share_id: "shr_b", cybs_payment_id: "p2", amount_cents: 100 }],
  };
  const reject = { order_id: "ord_1", result: "rejected", captures: [], tap: { route: "r", tag: "agent-payer-auth", steps: [{ n: 4, name: "nonce", ok: false, detail: "x" }], business: null, accepted: false, reason: "x", signature_base: "" } };
  function live() {
    const sent: { body: string }[] = [];
    const fetchFn = vi.fn(async (_u: URL, init: RequestInit) => {
      sent.push({ body: Buffer.from(init.body as Uint8Array).toString() });
      return new Response(JSON.stringify(reject), { status: 401 });
    });
    const signer = { keyId: "k", sign: () => ({ "Signature-Input": "i", Signature: "sig" }) };
    const v = new LiveVenue({ baseUrl: "https://v.test", signer: () => signer as never, emit: async () => {}, fetch: fetchFn as never });
    return { v, sent };
  }
  it("replay sends the same forged (never matching) body twice", async () => {
    const { v, sent } = live();
    await v.commit("ord_1", consent, "replay");
    expect(sent).toHaveLength(2);
    expect(sent[0]!.body).toBe(sent[1]!.body);
    expect(sent[0]!.body).not.toBe(canonicalConsent(consent));
  });
  it("tamper sends a body that differs from the signed one", async () => {
    const { v, sent } = live();
    await v.commit("ord_1", consent, "tamper");
    expect(sent[0]!.body).not.toBe(canonicalConsent(consent));
  });
  it("replay with zero shares still forges (total changed)", async () => {
    const { v, sent } = live();
    const empty = { ...consent, shares: [] };
    await v.commit("ord_1", empty, "replay");
    expect(sent[0]!.body).not.toBe(canonicalConsent(empty));
  });
});
