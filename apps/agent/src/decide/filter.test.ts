import type { Bundle } from "@tab/shared";
import { describe, expect, it } from "vitest";
import { effectiveHardMax, filter } from "./filter";
import { budget, uid } from "./testkit";

const b = (id: string, all_in_pp_cents: number) => ({ id, all_in_pp_cents }) as Bundle;

describe("effectiveHardMax", () => {
  it("uses hard_max when set, else round(target × 1.10)", () => {
    expect(effectiveHardMax({ target_pp_cents: 4000, hard_max_pp_cents: 5000 })).toBe(5000);
    expect(effectiveHardMax({ target_pp_cents: 4000, hard_max_pp_cents: null })).toBe(4400);
    expect(effectiveHardMax({ target_pp_cents: 4545, hard_max_pp_cents: null })).toBe(5000); // 4999.5 rounds up
  });
});

describe("filter", () => {
  const bundles = [b("cheap", 3000), b("mid", 4400), b("high", 5000)];

  it("one member below a bundle's price removes it; exact equality is kept", () => {
    const out = filter(bundles, [budget(uid(), 4500, 6000), budget(uid(), 4000)]);
    expect(out.map((x) => x.id)).toEqual(["cheap", "mid"]);
  });

  it("every member must fit", () => {
    expect(filter(bundles, [budget(uid(), 9000, 9000), budget(uid(), 2900, 2900)])).toEqual([]);
  });

  it("no constraints keeps everything", () => {
    expect(filter(bundles, [])).toHaveLength(3);
  });
});
