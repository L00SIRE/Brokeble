import { describe, expect, it } from "vitest";
import { ResearchBrief, type Preferences } from "@tab/shared";
import { buildResearchBrief, topK } from "../src/creao/brief";

const prefs = (o: Partial<Preferences> = {}): Preferences => ({
  cuisines_like: [], cuisines_avoid: [], dietary: [], vibe: [], earliest_start: null, latest_end: null, dealbreakers: [], ...o,
});
const plan = { area: "Westwood / Sawtelle", event_date: "2026-10-17", time_start: "18:30:00", time_end: "23:00" };

describe("topK", () => {
  it("orders by frequency then alphabetically and truncates", () => {
    expect(topK(["quiet", "lively", "lively", "casual", "trendy", "trendy"], 3)).toEqual(["lively", "trendy", "casual"]);
    expect(topK([], 3)).toEqual([]);
  });
});

describe("buildResearchBrief", () => {
  it("aggregates dietary tags and vibes without identities", () => {
    const b = buildResearchBrief(
      "dinner",
      plan,
      [
        prefs({ dietary: ["vegetarian", "halal"], vibe: ["lively"], cuisines_like: ["thai"], dealbreakers: ["no loud places"] }),
        prefs({ dietary: ["vegetarian"], vibe: ["lively", "quiet"] }),
      ],
      3,
    );
    expect(b).toEqual({
      category: "dinner",
      area: "Westwood / Sawtelle",
      date: "2026-10-17",
      time_window: { start: "18:30", end: "23:00" },
      party_size: 3,
      dietary_tags: ["halal", "vegetarian"],
      vibe: ["lively", "quiet"],
      price_tiers: ["<$25", "$25-50", "$50+"],
      count_per_tier: 4,
    });
    expect(ResearchBrief.safeParse(b).success).toBe(true);
  });

  it("carries free text, budgets and names nowhere", () => {
    const json = JSON.stringify(buildResearchBrief("show", plan, [prefs({ cuisines_avoid: ["secret-cuisine"], dealbreakers: ["secret-dealbreaker"] })], 2));
    expect(json).not.toMatch(/secret|budget|phone|name|cents/i);
  });

  it("clamps party size to 2..8 and tolerates no prefs", () => {
    expect(buildResearchBrief("show", plan, [], 1).party_size).toBe(2);
    expect(buildResearchBrief("show", plan, [], 20).party_size).toBe(8);
    expect(buildResearchBrief("show", plan, [], 4)).toMatchObject({ dietary_tags: [], vibe: [] });
  });
});
