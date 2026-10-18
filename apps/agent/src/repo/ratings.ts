// app.ratings: per-member bundle ratings (from that member's prefs only, P2). Owner A.
import type postgres from "postgres";
import { sql, type Db } from "../db";
import type { RatingRow } from "./types";

/** Upserts one member's scores on (plan_id, user_id, bundle_id). Scores are already clamped by B. */
export async function upsertRatings(planId: string, userId: string, scores: readonly { bundle_id: string; score: number }[], tx: Db = sql): Promise<void> {
  // Dedupe (last wins): one INSERT … ON CONFLICT DO UPDATE cannot touch the same row twice.
  const rows = [...new Map(scores.map((s) => [s.bundle_id, { bundle_id: s.bundle_id, score: s.score }])).values()];
  if (rows.some((r) => !Number.isFinite(r.score))) throw new Error("upsertRatings: non-finite score");
  if (rows.length === 0) return;
  await tx`
    insert into app.ratings (plan_id, user_id, bundle_id, score)
    select ${planId}, ${userId}, e->>'bundle_id', (e->>'score')::real
    from jsonb_array_elements(${tx.json(rows as postgres.JSONValue)}) e
    on conflict (plan_id, user_id, bundle_id) do update set score = excluded.score`;
}

/** Ratings for the plan, optionally only for `bundleIds`. */
export async function listRatings(planId: string, bundleIds?: readonly string[], tx: Db = sql): Promise<RatingRow[]> {
  return tx<RatingRow[]>`
    select user_id, bundle_id, score from app.ratings
    where plan_id = ${planId} ${bundleIds ? tx`and bundle_id = any(${tx.array([...bundleIds])}::text[])` : tx``}
    order by user_id, bundle_id`;
}

/** "forget me". */
export async function deleteRatingsForUser(userId: string, tx: Db = sql): Promise<void> {
  await tx`delete from app.ratings where user_id = ${userId}`;
}
