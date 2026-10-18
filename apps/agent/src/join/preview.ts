// Public plan preview (GET /plans/:code, /join and /status responses; ux-flow §7.2). Built from an explicit whitelist:
// title, date, time, area, the organizer's first name and counts. Never budgets, never other members' names: a
// 4-digit code is enumerable, so everything here is effectively public. Owner A.
import type { LaneStage } from "@tab/shared";
import { env } from "../env";
import { fmtDate } from "../notify/render";
import { stageAtLeast } from "../plan/machine";
import { countByStage } from "../repo/participants";
import type { PlanRow, PlanState } from "../repo/types";
import { getUser } from "../repo/users";
import type { PlanPreview } from "./schemas";

/** States a new person can still join in (and that the web treats as "open"). */
export const JOINABLE_STATES: ReadonlySet<PlanState> = new Set(["COLLECTING", "RESEARCHING", "VOTING"]);

/** Most people one plan seats: ResearchBrief.party_size max and CreatePlanBody.party_target max. */
export const MAX_PLAN_PARTICIPANTS = 8;

const NOT_SEATED: readonly LaneStage[] = ["DECLINED", "RELEASED"];

export type PlanCounts = { joined: number; seated: number };

/** joined = stage ≥ JOINED (DECLINED/RELEASED excluded); seated = every participant not DECLINED/RELEASED (INVITED included). */
export function countsFrom(by: Partial<Record<LaneStage, number>>): PlanCounts {
  let joined = 0;
  let seated = 0;
  for (const [stage, n = 0] of Object.entries(by) as [LaneStage, number | undefined][]) {
    if (NOT_SEATED.includes(stage)) continue;
    seated += n;
    if (stageAtLeast(stage, "JOINED")) joined += n;
  }
  return { joined, seated };
}

export async function planCounts(planId: string): Promise<PlanCounts> {
  return countsFrom(await countByStage(planId));
}

/** "19:00" → "7:00 PM". */
export function timeLabel(hhmm: string): string {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm);
  if (!m) throw new RangeError(`invalid time: ${hhmm}`);
  const h = Number(m[1]);
  return `${h % 12 || 12}:${m[2]} ${h >= 12 ? "PM" : "AM"}`;
}

/**
 * "full" counts `joined` (lanes that texted us), the same rule as the /join cap (capacity.ts confirmedMembers): form-only
 * INVITED rows never fill a plan, so made-up phones on an enumerable code cannot make the invite page read "full".
 */
export function previewStatus(state: PlanState, joined: number): PlanPreview["status"] {
  if (!JOINABLE_STATES.has(state)) return "closed";
  return joined >= MAX_PLAN_PARTICIPANTS ? "full" : "open";
}

/** A real first name, or null for unknown ('') and scrubbed ("forget me") users. */
export const publicFirstName = (name: string | null | undefined): string | null =>
  name && name !== "(removed)" ? name : null;

export const joinUrlFor = (code: string): string => `${new URL(env.WEB_ORIGIN).origin}/j/${code}`;

/** The whitelisted preview. `counts` may be passed when the caller already has them. */
export async function buildPlanPreview(plan: PlanRow, counts?: PlanCounts): Promise<PlanPreview> {
  const [c, organizer] = await Promise.all([
    counts ?? planCounts(plan.id),
    plan.organizer_id ? getUser(plan.organizer_id) : Promise.resolve(null),
  ]);
  return {
    code: plan.code,
    title: plan.title,
    date_label: fmtDate(plan.event_date),
    time_label: timeLabel(plan.time_start),
    area: plan.area,
    organizer_first_name: publicFirstName(organizer?.first_name),
    joined: c.joined,
    party_target: plan.party_target,
    status: previewStatus(plan.state, c.joined),
  };
}
