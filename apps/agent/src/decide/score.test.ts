import type { Bundle } from "@tab/shared";
import { describe, expect, it } from "vitest";
import type { RatingRow } from "../repo/types";
import { compose } from "./compose";
import { comfort, dropVetoed, effectiveRating, nashWelfare, pickWinner, shortlist } from "./score";
import { ballot, budget, dinner, PLAN, show, uid } from "./testkit";

const all = compose([dinner("D1", { usd: 10 }), dinner("D2", { usd: 12 }), dinner("D3", { usd: 14 }), show("S1"), show("S2"), show("S3")], PLAN);
const rate = (user_id: string, bundles: readonly Bundle[], score: (b: Bundle) => number): RatingRow[] =>
  bundles.map((b) => ({ user_id, bundle_id: b.id, score: score(b) }));

describe("ratings and comfort", () => {
  it("clamps to [0.05, 1]; missing → 0.5", () => {
    const r = [{ user_id: "u", bundle_id: "a", score: 0 }, { user_id: "u", bundle_id: "b", score: 7 }];
    expect(effectiveRating(r, "u", "a")).toBe(0.05);
    expect(effectiveRating(r, "u", "b")).toBe(1);
    expect(effectiveRating(r, "u", "zzz")).toBe(0.5);
  });

  it("comfort is 1 up to target, then monotonically decreasing to a 0.6 floor", () => {
    const c = { target_pp_cents: 4000, hard_max_pp_cents: 5000 };
    expect(comfort(4000, c)).toBe(1);
    expect(comfort(4500, c)).toBeCloseTo(0.8);
    expect(comfort(5000, c)).toBeCloseTo(0.6);
    expect(comfort(9000, c)).toBe(0.6);
    const xs = [4000, 4200, 4400, 4600, 4800, 5000].map((p) => comfort(p, c));
    for (let i = 1; i < xs.length; i++) expect(xs[i]!).toBeLessThan(xs[i - 1]!);
    expect(comfort(4001, { target_pp_cents: 4000, hard_max_pp_cents: 4000 })).toBe(0.6); // span guarded by max(1, …)
  });

  it("NW sums ln(rating × comfort) over members; a zero rating clamps instead of -Infinity", () => {
    const [u1, u2] = [uid(), uid()];
    const b = all[0]!;
    const cs = [budget(u1, 100_000), budget(u2, 100_000)];
    expect(nashWelfare(b, [{ user_id: u1, bundle_id: b.id, score: 0 }], cs)).toBeCloseTo(Math.log(0.05) + Math.log(0.5));
  });
});

describe("shortlist", () => {
  it("returns 3 diverse bundles (no shared dinner or show) by max Nash welfare", () => {
    const [u1, u2] = [uid(), uid()];
    const best = all.find((b) => b.dinner.data.name === "D1" && b.show.data.name === "S1")!;
    const ratings = [...rate(u1, all, (b) => (b === best ? 1 : 0.6)), ...rate(u2, all, () => 0.7)];
    const top = shortlist(all, ratings, [budget(u1, 100_000), budget(u2, 100_000)]);
    expect(top).toHaveLength(3);
    expect(top[0]!.id).toBe(best.id);
    expect(new Set(top.map((b) => b.dinner.id)).size).toBe(3);
    expect(new Set(top.map((b) => b.show.id)).size).toBe(3);
  });

  it("Nash welfare punishes a plan one member hates even if another loves it", () => {
    const [u1, u2] = [uid(), uid()];
    const [a, b] = [all[0]!, all.find((x) => x.dinner.id !== all[0]!.dinner.id && x.show.id !== all[0]!.show.id)!];
    const ratings = [
      { user_id: u1, bundle_id: a.id, score: 1 },
      { user_id: u2, bundle_id: a.id, score: 0.1 },
      { user_id: u1, bundle_id: b.id, score: 0.6 },
      { user_id: u2, bundle_id: b.id, score: 0.6 },
    ];
    expect(shortlist([a, b], ratings, [budget(u1, 100_000), budget(u2, 100_000)])[0]!.id).toBe(b.id);
  });

  it("comfort pushes over-target plans down", () => {
    const u = uid();
    const top = shortlist(all, [], [budget(u, 2000, 6000)]);
    expect(top.map((b) => b.all_in_pp_cents)).toEqual([...top.map((b) => b.all_in_pp_cents)].sort((x, y) => x - y));
  });

  it("deterministic tie-break: all_in asc, then id", () => {
    const top = shortlist([...all].reverse(), [], []);
    expect(top).toEqual(shortlist(all, [], []));
    expect(top[0]!.all_in_pp_cents).toBe(Math.min(...all.map((b) => b.all_in_pp_cents)));
    const same = all.filter((b) => b.dinner.data.name === "D1"); // equal price (shows all $5)
    expect(shortlist(same, [], [])[0]!.id).toBe([...same].map((b) => b.id).sort()[0]);
  });

  it("returns fewer than 3 when diversity is impossible", () => {
    expect(shortlist(compose([dinner("D"), show("S1"), show("S2")], PLAN), [], [])).toHaveLength(1);
  });
});

describe("pickWinner", () => {
  const top = shortlist(all, [], []);
  const [u1, u2, u3] = [uid(), uid(), uid()];
  const cs = [budget(u1, 100_000), budget(u2, 100_000), budget(u3, 100_000)];

  it("approvals beat Nash welfare", () => {
    const ratings = rate(u1, top, (b) => (b === top[0] ? 1 : 0.1));
    expect(pickWinner(top, [ballot(u1, [top[2]!.id]), ballot(u2, [top[2]!.id, top[0]!.id]), ballot(u3, [top[2]!.id])], ratings, cs)).toBe(top[2]!.id);
  });

  it("approval ties fall to Nash welfare, then all_in, then id", () => {
    const ratings = rate(u1, top, (b) => (b === top[1] ? 1 : 0.2));
    expect(pickWinner(top, [ballot(u1, [top[0]!.id, top[1]!.id])], ratings, cs)).toBe(top[1]!.id);
    expect(pickWinner(top, [], [], cs)).toBe(top[0]!.id);
  });

  it("non-voters approve nothing; duplicate approvals in one ballot count once", () => {
    expect(pickWinner(top, [ballot(u1, [top[1]!.id, top[1]!.id]), ballot(u2, [top[2]!.id])], [], cs)).toBe(
      top[1]!.all_in_pp_cents <= top[2]!.all_in_pp_cents ? top[1]!.id : top[2]!.id,
    );
  });

  it("throws on an empty shortlist", () => {
    expect(() => pickWinner([], [], [], cs)).toThrow();
  });
});

describe("dropVetoed (avoid/dealbreaker veto)", () => {
  const [u1, u2] = [uid(), uid()];
  const steak = all[0]!;
  const floorFor = (u: string, bad: readonly Bundle[]) => rate(u, all, (b) => (bad.includes(b) ? 0.05 : 0.8));

  it("drops candidates a vetoing member rated at the floor", () => {
    expect(dropVetoed(all, floorFor(u1, [steak]), new Set([u1]))).toEqual(all.slice(1));
  });

  it("ignores floor ratings from members with no avoids or dealbreakers", () => {
    expect(dropVetoed(all, floorFor(u2, [steak]), new Set([u1]))).toEqual(all);
    expect(dropVetoed(all, floorFor(u1, [steak]), new Set())).toEqual(all);
  });

  it("never empties the field: if every candidate is vetoed, all stay", () => {
    expect(dropVetoed(all, floorFor(u1, all), new Set([u1]))).toEqual(all);
  });

  it("unrated candidates are not vetoed, and the shortlist then excludes the vetoed bundle", () => {
    const partial = floorFor(u1, [steak]).filter((r) => r.bundle_id !== all[1]!.id);
    expect(dropVetoed(all, partial, new Set([u1]))).toContain(all[1]);
    const r = floorFor(u1, [steak]);
    const top = shortlist(dropVetoed(all, r, new Set([u1])), r, [budget(u1, 100_000)]);
    expect(top.map((b) => b.id)).not.toContain(steak.id);
  });
});
