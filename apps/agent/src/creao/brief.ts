// P6: CREAO inputs are ResearchBrief only (enums, area, date, times, party size). Owner B.
import { ResearchBrief, type Category, type Preferences } from "@tab/shared";
import type { PlanRow } from "../repo/types";

/** The k most frequent values (frequency desc, then alphabetical). */
export function topK<T extends string>(values: readonly T[], k: number): T[] {
  const counts = new Map<T, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts]
    .sort(([a, na], [b, nb]) => nb - na || (a < b ? -1 : a > b ? 1 : 0))
    .slice(0, k)
    .map(([v]) => v);
}

/**
 * Strict parse, so a stray field (a name, a phone, a budget) throws instead of reaching CREAO. Only aggregates leave:
 * the sorted union of dietary tags and the top three vibes, never who asked for them.
 */
export function buildResearchBrief(
  category: Category,
  plan: Pick<PlanRow, "area" | "event_date" | "time_start" | "time_end">,
  prefsList: readonly Preferences[],
  partySize: number,
): ResearchBrief {
  return ResearchBrief.parse({
    category,
    area: plan.area,
    date: plan.event_date.slice(0, 10),
    time_window: { start: plan.time_start.slice(0, 5), end: plan.time_end.slice(0, 5) },
    party_size: Math.min(8, Math.max(2, partySize)),
    dietary_tags: [...new Set(prefsList.flatMap((p) => p.dietary))].sort(),
    vibe: topK(
      prefsList.flatMap((p) => p.vibe),
      3,
    ),
    price_tiers: ["<$25", "$25-50", "$50+"],
    count_per_tier: 4,
  });
}
