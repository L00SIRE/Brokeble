// P1 allowlist: Nash shortlist, winner, and the ONLY orchestrators that load constraints for decisions (B plan T6).
// The orchestrators compute only: A writes app.bundles, emits `shortlist` and does every fan-out. Never log or emit
// constraint values. Owner B.
import type { Ballot, Bundle } from "@tab/shared";
import type { PrivateConstraints } from "@tab/shared/private";
import { ports } from "../ports";
import { getShortlist } from "../repo/bundles";
import { listBallots } from "../repo/ballots";
import { listOptions } from "../repo/options";
import { listMembers } from "../repo/participants";
import { getPlan } from "../repo/plans";
import { EMPTY_PREFERENCES, listPreferences } from "../repo/preferences";
import * as privateConstraints from "../repo/privateConstraints";
import { listRatings, upsertRatings } from "../repo/ratings";
import type { RatingRow } from "../repo/types";
import { compose } from "./compose";
import { COMFORT_FLOOR, RATING_DEFAULT, RATING_FLOOR, SHORTLIST_N } from "./config";
import { effectiveHardMax, filter } from "./filter";
import { fitsPrefs } from "./fitsPrefs";
import { selectForRating, toRateCandidates } from "./rateCandidates";

export type ShortlistResult = {
  from_count: number; // bundles composed from CREAO options
  survived_count: number; // after fitsPrefs + private filter
  survivors: Bundle[];
  top3: Bundle[]; // < 3 ⇒ A sends T_NO_FIT
};

type Budget = Pick<PrivateConstraints, "user_id" | "target_pp_cents" | "hard_max_pp_cents">;
type RatingIndex = ReadonlyMap<string, number>;

const key = (userId: string, bundleId: string) => `${userId}\u0000${bundleId}`;
const indexRatings = (ratings: readonly RatingRow[]): RatingIndex => new Map(ratings.map((r) => [key(r.user_id, r.bundle_id), r.score]));
const clampRating = (score: number | undefined) =>
  score === undefined || !Number.isFinite(score) ? RATING_DEFAULT : Math.min(1, Math.max(RATING_FLOOR, score));

/** clamp(rating, RATING_FLOOR, 1); missing → RATING_DEFAULT. */
export function effectiveRating(ratings: readonly RatingRow[], userId: string, bundleId: string): number {
  return clampRating(ratings.find((r) => r.user_id === userId && r.bundle_id === bundleId)?.score);
}

/** 1 if price ≤ target, else max(COMFORT_FLOOR, 1 − 0.4·(price−target)/max(1, effMax−target)). Code-only. */
export function comfort(priceCents: number, c: Pick<PrivateConstraints, "target_pp_cents" | "hard_max_pp_cents">): number {
  if (priceCents <= c.target_pp_cents) return 1;
  const span = Math.max(1, effectiveHardMax(c) - c.target_pp_cents);
  return Math.max(COMFORT_FLOOR, 1 - (0.4 * (priceCents - c.target_pp_cents)) / span);
}

const welfare = (b: Bundle, idx: RatingIndex, constraints: readonly Budget[]): number =>
  constraints.reduce((sum, c) => sum + Math.log(clampRating(idx.get(key(c.user_id, b.id))) * comfort(b.all_in_pp_cents, c)), 0);

/** NW = Σ over members (one constraint row each) of ln(effectiveRating × comfort). */
export function nashWelfare(b: Bundle, ratings: readonly RatingRow[], constraints: readonly PrivateConstraints[]): number {
  return welfare(b, indexRatings(ratings), constraints);
}

const tieBreak = (a: Bundle, b: Bundle) => a.all_in_pp_cents - b.all_in_pp_cents || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Sort by NW desc, all_in asc, id; greedily take bundles sharing no dinner or show id, up to SHORTLIST_N. */
export function shortlist(bundles: readonly Bundle[], ratings: readonly RatingRow[], constraints: readonly PrivateConstraints[]): Bundle[] {
  const idx = indexRatings(ratings);
  const nw = new Map(bundles.map((b) => [b.id, welfare(b, idx, constraints)]));
  const ranked = [...bundles].sort((a, b) => nw.get(b.id)! - nw.get(a.id)! || tieBreak(a, b));
  const used = new Set<string>();
  const picked: Bundle[] = [];
  for (const b of ranked) {
    if (picked.length === SHORTLIST_N) break;
    if (used.has(b.dinner.id) || used.has(b.show.id)) continue;
    used.add(b.dinner.id).add(b.show.id);
    picked.push(b);
  }
  return picked;
}

/**
 * A member who named avoids or dealbreakers vetoes any candidate they rated at the floor (the rate prompt scores a
 * violation there). Vetoed candidates are dropped, but never all of them: a veto may narrow the field, not turn a fit
 * into a no-fit. Code-only, ratings in / bundles out.
 */
export function dropVetoed(candidates: readonly Bundle[], ratings: readonly RatingRow[], vetoers: ReadonlySet<string>): Bundle[] {
  if (vetoers.size === 0) return [...candidates];
  const vetoed = new Set(ratings.filter((r) => vetoers.has(r.user_id) && r.score <= RATING_FLOOR).map((r) => r.bundle_id));
  const kept = candidates.filter((b) => !vetoed.has(b.id));
  return kept.length > 0 ? kept : [...candidates];
}

/** approvals desc → NW desc → all_in asc → id. Non-voters approve nothing. Returns the winning bundle id. */
export function pickWinner(shortlist: readonly Bundle[], ballots: readonly Ballot[], ratings: readonly RatingRow[], constraints: readonly PrivateConstraints[]): string {
  if (shortlist.length === 0) throw new Error("pickWinner: empty shortlist");
  const approvals = new Map<string, number>();
  for (const ballot of ballots) for (const id of new Set(ballot.approvals)) approvals.set(id, (approvals.get(id) ?? 0) + 1);
  const idx = indexRatings(ratings);
  const nw = new Map(shortlist.map((b) => [b.id, welfare(b, idx, constraints)]));
  const ranked = [...shortlist].sort(
    (a, b) => (approvals.get(b.id) ?? 0) - (approvals.get(a.id) ?? 0) || nw.get(b.id)! - nw.get(a.id)! || tieBreak(a, b),
  );
  return ranked[0]!.id;
}

/**
 * listOptions → compose → fitsPrefs(active members' prefs) → filter(their constraints) → selectForRating → one
 * llm.rateBundles(prefs, toRateCandidates(...)) per member in parallel (that member's prefs only, P2) → upsertRatings
 * → shortlist over the rated candidates (every pick was actually rated). Writes only app.ratings; emits nothing; sends nothing.
 */
export async function computeShortlist(planId: string): Promise<ShortlistResult> {
  const plan = await getPlan(planId);
  if (!plan) throw new Error("computeShortlist: plan not found");
  const userIds = (await listMembers(planId)).map((m) => m.user_id);
  const [options, prefRows, constraints] = await Promise.all([
    listOptions(planId),
    listPreferences(planId, userIds),
    privateConstraints.listForPlan(planId, userIds),
  ]);
  const prefsOf = new Map(prefRows.map((r) => [r.user_id, r.prefs]));
  const members = userIds.map((user_id) => ({ user_id, prefs: prefsOf.get(user_id) ?? EMPTY_PREFERENCES }));

  const composed = compose(options, plan);
  const survivors = filter(
    fitsPrefs(
      composed,
      members.map((m) => m.prefs),
    ),
    constraints,
  );
  const candidates = selectForRating(survivors);
  const rateInput = toRateCandidates(candidates);

  const ratings: RatingRow[] = [];
  if (candidates.length > 0) {
    await Promise.all(
      members.map(async ({ user_id, prefs }) => {
        const { ratings: raw } = await ports.llm.rateBundles(prefs, rateInput);
        const scores = new Map<string, number>();
        for (const r of raw) {
          const b = candidates[r.index - 1];
          if (b && !scores.has(b.id) && Number.isFinite(r.score)) scores.set(b.id, clampRating(r.score)); // first answer per index wins
        }
        const rows = [...scores].map(([bundle_id, score]) => ({ bundle_id, score }));
        if (rows.length > 0) await upsertRatings(planId, user_id, rows);
        for (const row of rows) ratings.push({ user_id, ...row });
      }),
    );
  }

  const vetoers = new Set(members.filter((m) => m.prefs.cuisines_avoid.length + m.prefs.dealbreakers.length > 0).map((m) => m.user_id));
  return { from_count: composed.length, survived_count: survivors.length, survivors, top3: shortlist(dropVetoed(candidates, ratings, vetoers), ratings, constraints) };
}

/** Loads the version's shortlist (app.bundles shortlist_rank), ballots, ratings and constraints → pickWinner. Active members only. */
export async function computeWinner(planId: string, version: number): Promise<string> {
  const [top, members] = await Promise.all([getShortlist(planId, version), listMembers(planId)]);
  if (top.length === 0) throw new Error("computeWinner: no shortlist for this version");
  const userIds = members.map((m) => m.user_id);
  const active = new Set(userIds);
  const [ballots, ratings, constraints] = await Promise.all([
    listBallots(planId, version),
    listRatings(
      planId,
      top.map((b) => b.id),
    ),
    privateConstraints.listForPlan(planId, userIds),
  ]);
  return pickWinner(
    top,
    ballots.filter((b) => active.has(b.user_id)),
    ratings,
    constraints,
  );
}
