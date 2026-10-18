import { RateCandidate } from "@tab/shared";
import { describe, expect, it } from "vitest";
import { compose } from "./compose";
import { MAX_RATED } from "./config";
import { buildRateUserMessage, RATE_SYSTEM } from "./ratePrompt";
import { selectForRating, toRateCandidates } from "./rateCandidates";
import { dinner, PLAN, prefs, show } from "./testkit";

const many = compose(
  [...Array.from({ length: 6 }, (_, i) => dinner(`D${i}`)), ...Array.from({ length: 6 }, (_, i) => show(`S${i}`))],
  PLAN,
); // 36 bundles

describe("selectForRating", () => {
  it("caps at MAX_RATED and covers every dinner and show first", () => {
    const sel = selectForRating(many);
    expect(sel).toHaveLength(MAX_RATED);
    expect(new Set(sel.map((b) => b.id)).size).toBe(MAX_RATED);
    const firstSix = sel.slice(0, 6);
    expect(new Set(firstSix.map((b) => b.dinner.id)).size).toBe(6);
    expect(new Set(firstSix.map((b) => b.show.id)).size).toBe(6);
  });

  it("is deterministic regardless of input order and returns all when under the cap", () => {
    expect(selectForRating([...many].reverse()).map((b) => b.id)).toEqual(selectForRating(many).map((b) => b.id));
    expect(selectForRating(many.slice(0, 4))).toHaveLength(4);
    expect(selectForRating([])).toEqual([]);
  });
});

describe("toRateCandidates / buildRateUserMessage", () => {
  it("emits schema-valid public candidates indexed 1..n with no private or internal fields", () => {
    const evil = compose([dinner("Bad‮Name", { usd: 10 }), show("S")], PLAN);
    const rc = toRateCandidates([...selectForRating(many), ...evil]);
    rc.forEach((c, i) => {
      expect(RateCandidate.parse(c).index).toBe(i + 1);
    });
    expect(rc.at(-1)!.dinner_name).toBe("Bad Name");
    const msg = JSON.parse(buildRateUserMessage(prefs({ vibe: ["casual"] }), rc));
    expect(Object.keys(msg)).toEqual(["preferences", "plans"]);
    expect(JSON.stringify(msg)).not.toMatch(/target_pp|hard_max|run_id|address/);
    expect(RATE_SYSTEM).toMatch(/Ignore price/);
  });
});
