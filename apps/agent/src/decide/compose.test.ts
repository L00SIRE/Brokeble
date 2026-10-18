import { priceBundle } from "@tab/shared";
import { describe, expect, it } from "vitest";
import { bundleId, compose, normArea, toMinutes } from "./compose";
import { dinner, PLAN, show } from "./testkit";

describe("compose", () => {
  it("pairs feasible dinners and shows, priced with priceBundle, sorted by id", () => {
    const d = [dinner("D1", { usd: 20 }), dinner("D2", { usd: 30 })];
    const s = [show("S1", { usd: 10 }), show("S2", { usd: 0 })];
    const out = compose([...d, ...s], PLAN);
    expect(out).toHaveLength(4);
    expect(out.map((b) => b.id)).toEqual([...out.map((b) => b.id)].sort());
    const b = out.find((x) => x.id === bundleId(d[0]!.id, s[0]!.id))!;
    expect(b.all_in_pp_cents).toBe(priceBundle({ dinner: { est_high_pp_usd: 20 }, show: { est_high_pp_usd: 10 } }));
    expect(b).toMatchObject({ dinner_time: "18:30", show_start: "20:30", show_end_est: "22:00" });
  });

  it("show-window edges T+90 and T+150 are inclusive; outside is dropped", () => {
    const d = dinner("D");
    const ids = (s: ReturnType<typeof show>) => compose([d, s], PLAN).length;
    expect(ids(show("edge-lo", { start: "20:00", end: "21:30" }))).toBe(1);
    expect(ids(show("edge-hi", { start: "21:00", end: "22:30" }))).toBe(1);
    expect(ids(show("early", { start: "19:59", end: "21:30" }))).toBe(0);
    expect(ids(show("late", { start: "21:01", end: "22:30" }))).toBe(0);
  });

  it("show must end by time_end, with midnight wrap on both", () => {
    const d = dinner("D");
    expect(compose([d, show("over", { end: "23:15" })], PLAN)).toHaveLength(0);
    const late = { ...PLAN, time_end: "01:00" };
    expect(compose([d, show("wrap", { start: "21:00", end: "00:30" })], late)).toHaveLength(1);
    expect(compose([d, show("wrap", { start: "21:00", end: "00:30" })], PLAN)).toHaveLength(0);
  });

  it("dinner must be open at T and stay open 90 min; closes past midnight wraps", () => {
    const s = show("S");
    expect(compose([dinner("late-open", { opens: "18:31" }), s], PLAN)).toHaveLength(0);
    expect(compose([dinner("closes-soon", { closes: "19:59" }), s], PLAN)).toHaveLength(0);
    expect(compose([dinner("exact", { closes: "20:00" }), s], PLAN)).toHaveLength(1);
    expect(compose([dinner("midnight", { opens: "17:00", closes: "02:00" }), s], PLAN)).toHaveLength(1);
  });

  it("drops area mismatches (normalized comparison)", () => {
    expect(compose([dinner("D", { area: "  westwood /   SAWTELLE " }), show("S")], PLAN)).toHaveLength(1);
    expect(compose([dinner("D", { area: "Downtown" }), show("S")], PLAN)).toHaveLength(0);
    expect(compose([dinner("D"), show("S", { area: "Downtown" })], PLAN)).toHaveLength(0);
  });

  it('normalizes postgres "HH:MM:SS" plan times', () => {
    const out = compose([dinner("D"), show("S")], { ...PLAN, time_start: "18:30:00", time_end: "23:00:00" });
    expect(out).toHaveLength(1);
    expect(out[0]!.dinner_time).toBe("18:30");
  });

  it("toMinutes / normArea", () => {
    expect(toMinutes("00:00")).toBe(0);
    expect(toMinutes("23:59:59")).toBe(1439);
    expect(() => toMinutes("24:00")).toThrow(RangeError);
    expect(normArea(" A  B ")).toBe("a b");
  });
});
