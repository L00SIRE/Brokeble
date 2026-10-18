// PLAN §15 demo beats over the committed cached-options + demo-seed fixtures, through the same pure pipeline as
// computeShortlist (MockLLM ratings). The beat assertions run once the placeholder fixtures (example.com venues)
// are replaced by a real Scout snapshot; until then they are skipped, never silently passing.
import { readFileSync } from "node:fs";
import type { Bundle, Category, Option, Preferences } from "@tab/shared";
import { describe, expect, it } from "vitest";
import { MockLLM } from "../ports/llm.mock";
import { cachedOptionsPath, CachedOptionsFile } from "../ports/cachedOptions";
import { optionId } from "../repo/options";
import { EMPTY_PREFERENCES } from "../repo/preferences";
import type { RatingRow } from "../repo/types";
import { resolveApprovals } from "./ballot";
import { compose } from "./compose";
import { filter } from "./filter";
import { fitsPrefs } from "./fitsPrefs";
import { selectForRating, toRateCandidates } from "./rateCandidates";
import { shortlist } from "./score";
import { budget, type Constraint } from "./testkit";

const seed = JSON.parse(readFileSync(new URL("../../fixtures/demo-seed.json", import.meta.url), "utf8")) as {
  plan: { area: string; time_start: string; time_end: string };
  members: { target_pp_cents: number; hard_max_pp_cents: number | null; prefs: Preferences }[];
};
const load = (c: Category) => CachedOptionsFile.parse(JSON.parse(readFileSync(cachedOptionsPath(c), "utf8")));
const files = [load("dinner"), load("show")];
const options: Option[] = files.flatMap((f) =>
  f.options.map((data) => ({ id: optionId(data), run_id: f.run_id, source: "cached" as const, data, est_high_pp_cents: data.est_high_pp_usd * 100 })),
);
const placeholder = options.some((o) => new URL(o.data.url).hostname === "example.com");

type Member = { prefs: Preferences; c: Constraint };
const members: Member[] = seed.members.map((m, i) => ({
  prefs: m.prefs,
  c: budget(`00000000-0000-4000-8000-00000000000${i + 1}`, m.target_pp_cents, m.hard_max_pp_cents),
}));
const judge: Member = { prefs: EMPTY_PREFERENCES, c: budget("00000000-0000-4000-8000-000000000099", 3000, 3000) };

async function pipeline(ms: readonly Member[]): Promise<{ survivors: Bundle[]; top3: Bundle[] }> {
  const survivors = filter(fitsPrefs(compose(options, seed.plan), ms.map((m) => m.prefs)), ms.map((m) => m.c));
  const candidates = selectForRating(survivors);
  const llm = new MockLLM();
  const ratings: RatingRow[] = [];
  for (const m of ms) {
    const { ratings: r } = await llm.rateBundles(m.prefs, toRateCandidates(candidates));
    for (const { index, score } of r) ratings.push({ user_id: m.c.user_id, bundle_id: candidates[index - 1]!.id, score });
  }
  return { survivors, top3: shortlist(candidates, ratings, ms.map((m) => m.c)) };
}

describe("demo fixtures", () => {
  it("the fixtures compose into bundles for the seeded plan", () => {
    expect(compose(options, seed.plan).length).toBeGreaterThan(0);
  });

  it.skipIf(placeholder)("≥ 3 diverse bundles survive a 3000-cent hard max", async () => {
    const { top3 } = await pipeline([judge]);
    expect(top3).toHaveLength(3);
  });

  it.skipIf(placeholder)("adding the $30 judge changes the shortlist (v1 → v2 refresh beat)", async () => {
    const v1 = await pipeline(members);
    const v2 = await pipeline([...members, judge]);
    expect(v1.top3).toHaveLength(3);
    expect(v2.top3).toHaveLength(3);
    expect(v2.top3.map((b) => b.id)).not.toEqual(v1.top3.map((b) => b.id));
  });

  it.skipIf(placeholder)('post-judge plan 2 ends by 22:00, so "2, but not if it ends after 10" approves it', async () => {
    const { top3 } = await pipeline([...members, judge]);
    const parse = { approvals: [2], constraints: [{ kind: "end_before" as const, time: "22:00" }], none_of_these: false, intent: "ballot" as const, confidence: "high" as const };
    expect(resolveApprovals(parse, toRateCandidates(top3), seed.plan.time_start)).toEqual([top3[1]!.id]);
  });
});
