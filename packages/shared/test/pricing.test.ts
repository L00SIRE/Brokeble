import { describe, expect, it } from "vitest";
import { orderTotalCents, priceBundle, TAX, TIP } from "../src/pricing";

const b = (dinner: number, show: number) => ({ dinner: { est_high_pp_usd: dinner }, show: { est_high_pp_usd: show } });

describe("priceBundle", () => {
  it("uses the PLAN constants", () => {
    expect(TAX).toBe(0.0975);
    expect(TIP).toBe(0.18);
  });

  it("applies tax+tip to dinner, tax only to show, and rounds up to a whole dollar", () => {
    // 20*1.2775 + 10*1.0975 = 25.55 + 10.975 = 36.525 → $37
    expect(priceBundle(b(20, 10))).toBe(3700);
    // 40*1.2775 = 51.10 → $52
    expect(priceBundle(b(40, 0))).toBe(5200);
    // 0 + 25*1.0975 = 27.4375 → $28
    expect(priceBundle(b(0, 25))).toBe(2800);
  });

  it("does not round up an exact dollar (no float drift)", () => {
    // 100*1.0975 = 109.75; 400*1.2775 = 511.00 exactly
    expect(priceBundle(b(400, 0))).toBe(51100);
    expect(priceBundle(b(0, 400))).toBe(43900);
    expect(priceBundle(b(0, 0))).toBe(0);
  });

  it("matches the formula for every integer pair up to $120", () => {
    for (let d = 0; d <= 120; d += 7) {
      for (let s = 0; s <= 120; s += 5) {
        const exact = (d * 12775 + s * 10975) / 10000; // dollars
        const all = priceBundle(b(d, s));
        expect(all % 100).toBe(0);
        expect(all / 100).toBeGreaterThanOrEqual(exact);
        expect(all / 100 - exact).toBeLessThan(1);
      }
    }
  });

  it("accepts a VenueBundle-shaped object", () => {
    const venueBundle = {
      bundle_key: "k",
      date: "2026-10-17",
      dinner: { name: "D", address: "1 Main St", time: "18:30", est_high_pp_usd: 20 },
      show: { name: "S", address: "2 Main St", time: "20:30", est_high_pp_usd: 10 },
    };
    expect(priceBundle(venueBundle)).toBe(3700);
  });

  it("rejects non-integer or negative prices", () => {
    expect(() => priceBundle(b(10.5, 1))).toThrow(RangeError);
    expect(() => priceBundle(b(-1, 1))).toThrow(RangeError);
  });
});

describe("orderTotalCents", () => {
  it("is share × party size with no remainder", () => {
    expect(orderTotalCents(3700, 4)).toBe(14800);
    expect(() => orderTotalCents(3700, 0)).toThrow(RangeError);
  });
});
