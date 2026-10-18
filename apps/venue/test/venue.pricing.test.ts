import { describe, expect, it } from "vitest";
import { CreateOrderRequest, priceBundle } from "@tab/shared";
import { priceOrder } from "../src/pricing-bridge";

const bundle = {
  bundle_key: "bnd_0123456789", date: "2026-10-18",
  dinner: { name: "D", address: "addr 1", time: "18:00" as const, est_high_pp_usd: 22 },
  show: { name: "S", address: "addr 2", time: "20:00" as const, est_high_pp_usd: 8 },
};

describe("order pricing (M3)", () => {
  it("total = priceBundle × party_size and the items sum to it", () => {
    for (const n of [2, 3, 8]) {
      const p = priceOrder(bundle, n);
      expect(p.sharePp).toBe(priceBundle(bundle));
      expect(p.total).toBe(priceBundle(bundle) * n);
      expect(p.items.reduce((s, i) => s + i.unit_price_pp_cents * i.qty, 0)).toBe(p.total);
    }
  });
  it("rejects amount fields in the request body (strict zod)", () => {
    const base = { plan_ref: crypto.randomUUID(), plan_version: 1, bundle, party_size: 2, payer_refs: ["a".repeat(32), "b".repeat(32)], deadline_at: new Date().toISOString() };
    expect(CreateOrderRequest.safeParse(base).success).toBe(true);
    expect(CreateOrderRequest.safeParse({ ...base, total_cents: 1 }).success).toBe(false);
    expect(CreateOrderRequest.safeParse({ ...base, amount_cents: 1 }).success).toBe(false);
  });
});
