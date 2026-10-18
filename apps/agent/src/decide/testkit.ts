// Test builders for decide/* (not a test file itself). Constraint literals are plain objects, never @tab/shared/private (P1).
import type { Ballot, Option, Preferences } from "@tab/shared";
import { optionId } from "../repo/options";
import type { filter } from "./filter";

export const AREA = "Westwood / Sawtelle";
export const PLAN = { time_start: "18:30", time_end: "23:00", area: AREA };

type DinnerOver = { usd?: number; opens?: string; closes?: string; area?: string; dietary?: Option["data"]["dietary_fit"] };
type ShowOver = { usd?: number; start?: string; end?: string; area?: string };

const base = (name: string, usd: number, area: string) => ({
  name,
  address: `${name} 100 Test Way, Los Angeles, CA 90024`,
  area,
  url: "https://example.com/v",
  price_tier: "<$25" as const,
  est_low_pp_usd: 0,
  est_high_pp_usd: usd,
  price_evidence_url: "https://example.com/p",
  pitch: `${name} pitch`,
});

export function dinner(name: string, o: DinnerOver = {}): Option {
  const data = {
    category: "dinner" as const,
    ...base(name, o.usd ?? 10, o.area ?? AREA),
    dietary_fit: o.dietary ?? [],
    opens: o.opens ?? "17:00",
    closes: o.closes ?? "22:30",
    hours_evidence_url: "https://example.com/h",
  };
  return { id: optionId(data), run_id: "run_d", source: "cached", data, est_high_pp_cents: data.est_high_pp_usd * 100 };
}

export function show(name: string, o: ShowOver = {}): Option {
  const data = {
    category: "show" as const,
    ...base(name, o.usd ?? 5, o.area ?? AREA),
    dietary_fit: [],
    show_start: o.start ?? "20:30",
    show_end_est: o.end ?? "22:00",
    showtime_evidence_url: "https://example.com/s",
  };
  return { id: optionId(data), run_id: "run_s", source: "cached", data, est_high_pp_cents: data.est_high_pp_usd * 100 };
}

export const prefs = (p: Partial<Preferences> = {}): Preferences => ({
  cuisines_like: [],
  cuisines_avoid: [],
  dietary: [],
  vibe: [],
  earliest_start: null,
  latest_end: null,
  dealbreakers: [],
  ...p,
});

export type Constraint = Parameters<typeof filter>[1][number];
let n = 0;
export const uid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
export const PLAN_ID = "11111111-1111-4111-8111-111111111111";

export const budget = (user_id: string, target_pp_cents: number, hard_max_pp_cents: number | null = null): Constraint => ({
  plan_id: PLAN_ID,
  user_id,
  target_pp_cents,
  hard_max_pp_cents,
  source: "dm",
  confidence: "high",
  confirmed_at: null,
});

export const ballot = (user_id: string, approvals: string[]): Ballot => ({
  plan_id: PLAN_ID,
  user_id,
  plan_version: 1,
  approvals,
  constraints: [],
  source: "digits",
  at: "2026-10-18T03:00:00.000Z",
});
