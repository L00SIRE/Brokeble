// Which bundles get rated (≤ MAX_RATED in one call per member). Pure. Owner B.
import type { Bundle, RateCandidate } from "@tab/shared";
import { byId } from "./compose";
import { MAX_RATED } from "./config";

/**
 * Greedy coverage: repeatedly add the bundle covering the most not-yet-covered dinners/shows (ties by id), so every
 * venue gets rated and disjoint picks stay possible; then fill by id, up to MAX_RATED.
 */
export function selectForRating(bundles: readonly Bundle[]): Bundle[] {
  const pool = [...bundles].sort(byId);
  const picked: Bundle[] = [];
  const covered = new Set<string>();
  const gain = (b: Bundle) => Number(!covered.has(b.dinner.id)) + Number(!covered.has(b.show.id));
  while (picked.length < MAX_RATED) {
    let best = -1;
    let bestGain = 0;
    pool.forEach((b, i) => {
      const g = gain(b);
      if (g > bestGain) [best, bestGain] = [i, g];
    });
    if (best < 0) break;
    const b = pool.splice(best, 1)[0]!;
    covered.add(b.dinner.id).add(b.show.id);
    picked.push(b);
  }
  return [...picked, ...pool.slice(0, MAX_RATED - picked.length)];
}

// Control/format chars (bidi overrides, zero-width) are stripped so Scout text cannot smuggle structure into the prompt.
const clean = (s: string) => s.replace(/[\p{Cc}\p{Cf}]+/gu, " ").replace(/\s+/g, " ").trim();
const cut = (s: string, max: number) => {
  const chars = Array.from(s); // code points, so an emoji is never split
  return chars.length <= max ? s : `${chars.slice(0, max - 1).join("").trimEnd()}…`;
};

/** Public rating payload with index = position + 1 (1..20; RateCandidate, never parsed as PublicBundle). */
export function toRateCandidates(bundles: readonly Bundle[]): RateCandidate[] {
  return bundles.map((b, i) => {
    const dinner = clean(b.dinner.data.name);
    const show = clean(b.show.data.name);
    return {
      id: b.id,
      index: i + 1,
      title: `Dinner at ${dinner} → Show at ${show}`,
      dinner_name: dinner,
      show_name: show,
      dinner_time: b.dinner_time,
      show_start: b.show_start,
      show_end_est: b.show_end_est,
      all_in_pp_cents: b.all_in_pp_cents,
      dietary_fit: [...b.dinner.data.dietary_fit],
      pitch: cut(`${clean(b.dinner.data.pitch)} / ${clean(b.show.data.pitch)}`, 280),
    };
  });
}
