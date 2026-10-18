// resolveApprovals: ballot constraints evaluated in code (B plan T6; A calls it, never re-implements it). Pure. Owner B.
import type { BallotParse, PublicBundle } from "@tab/shared";
import { toMinutes } from "./compose";

/**
 * Start from parse.approvals (indices into `shortlist`), drop `exclude` indices; times compare as minutes since
 * planTimeStart (+24 h for any time earlier than it): end_before drops show_end_est > time, start_after drops
 * dinner_time < time. none_of_these → []. Returns the surviving bundle ids in index order.
 */
export function resolveApprovals(parse: BallotParse, shortlist: readonly PublicBundle[], planTimeStart: string): string[] {
  if (parse.none_of_these) return [];
  const t0 = toMinutes(planTimeStart);
  const rel = (hhmm: string) => {
    const m = toMinutes(hhmm);
    return m < t0 ? m + 1440 : m;
  };
  const approved = new Set(parse.approvals);
  const keep = (b: PublicBundle) =>
    parse.constraints.every((c) => {
      if (c.kind === "exclude") return c.index !== b.index;
      if (c.kind === "end_before") return rel(b.show_end_est) <= rel(c.time);
      return rel(b.dinner_time) >= rel(c.time);
    });
  return [...shortlist]
    .sort((a, b) => a.index - b.index)
    .filter((b) => approved.has(b.index) && keep(b))
    .map((b) => b.id);
}
