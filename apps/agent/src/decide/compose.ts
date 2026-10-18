// compose: options → feasible dinner→show bundles priced with the shared priceBundle() (B plan T6). Pure. Owner B.
import { createHash } from "node:crypto";
import { priceBundle, type Bundle, type Option } from "@tab/shared";
import { DINNER_MIN_MIN, SHOW_GAP_MAX, SHOW_GAP_MIN } from "./config";

/** The plan fields compose needs (PlanRow already normalizes time to HH:MM; "HH:MM:SS" is also accepted). */
export type ComposePlan = { time_start: string; time_end: string; area: string };

const DAY = 1440;

/** 'bnd_' + sha1(dinnerId|showId)[0:10] (PLAN §8). */
export function bundleId(dinnerOptionId: string, showOptionId: string): string {
  return "bnd_" + createHash("sha1").update(`${dinnerOptionId}|${showOptionId}`).digest("hex").slice(0, 10);
}

/** "HH:MM" or "HH:MM:SS" → minutes since midnight. */
export function toMinutes(hhmm: string): number {
  const m = /^(\d{2}):(\d{2})(?::\d{2})?$/.exec(hhmm);
  const h = Number(m?.[1]);
  const min = Number(m?.[2]);
  if (!m || h > 23 || min > 59) throw new RangeError(`invalid time "${hhmm}"`);
  return h * 60 + min;
}

/** lowercase, trim, collapse whitespace (area equality). */
export function normArea(area: string): string {
  return area.trim().toLowerCase().replace(/\s+/g, " ");
}

export const byId = <T extends { id: string }>(a: T, b: T): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * T = time_start. Dinner: opens ≤ T and closes ≥ T+90 (closes ≤ opens ⇒ +1440). Show: start ∈ [T+90, T+150] (a start
 * earlier than T is read as after midnight); end = show_end_est (+1440 if before start) ≤ time_end (+1440 if time_end <
 * time_start). Same normArea for dinner, show and plan. dinner_time = time_start; all_in_pp_cents = priceBundle. Sorted by id.
 */
export function compose(options: readonly Option[], plan: ComposePlan): Bundle[] {
  const t = toMinutes(plan.time_start);
  const tEnd = toMinutes(plan.time_end);
  const planEnd = tEnd < t ? tEnd + DAY : tEnd;
  const area = normArea(plan.area);
  const dinnerTime = plan.time_start.slice(0, 5);

  const dinners = options.filter((o) => {
    if (o.data.category !== "dinner" || normArea(o.data.area) !== area) return false;
    const opens = toMinutes(o.data.opens);
    let closes = toMinutes(o.data.closes);
    if (closes <= opens) closes += DAY;
    return opens <= t && closes >= t + DINNER_MIN_MIN;
  });

  const bundles: Bundle[] = [];
  for (const s of options) {
    if (s.data.category !== "show" || normArea(s.data.area) !== area) continue;
    const rawStart = toMinutes(s.data.show_start);
    const start = rawStart < t ? rawStart + DAY : rawStart;
    const end = start + ((toMinutes(s.data.show_end_est) - rawStart + DAY) % DAY);
    if (start < t + SHOW_GAP_MIN || start > t + SHOW_GAP_MAX || end > planEnd) continue;
    for (const d of dinners) {
      bundles.push({
        id: bundleId(d.id, s.id),
        dinner: d,
        show: s,
        dinner_time: dinnerTime,
        show_start: s.data.show_start,
        show_end_est: s.data.show_end_est,
        all_in_pp_cents: priceBundle({ dinner: d.data, show: s.data }),
      });
    }
  }
  return bundles.sort(byId);
}
