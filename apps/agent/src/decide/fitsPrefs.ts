// fitsPrefs: dietary and time windows (no private data; B C-2). Pure. Owner B.
import type { Bundle, Preferences } from "@tab/shared";
import { toMinutes } from "./compose";

/** Minutes on the plan's clock: +24 h for a time earlier than `anchor` (an evening plan's 00:30 is after 23:00). */
const since = (hhmm: string, anchor: number): number => {
  const m = toMinutes(hhmm);
  return m < anchor ? m + 1440 : m;
};

/** Keeps a bundle iff for every member: prefs.dietary ⊆ dinner dietary_fit, earliest_start ≤ dinner_time (if set), show_end_est ≤ latest_end (if set). */
export function fitsPrefs(bundles: readonly Bundle[], prefs: readonly Preferences[]): Bundle[] {
  return bundles.filter((b) => {
    const start = toMinutes(b.dinner_time);
    const end = since(b.show_end_est, start);
    const fit = new Set(b.dinner.data.dietary_fit);
    return prefs.every(
      (p) =>
        p.dietary.every((d) => fit.has(d)) &&
        (p.earliest_start === null || toMinutes(p.earliest_start) <= start) &&
        (p.latest_end === null || end <= since(p.latest_end, start)),
    );
  });
}
