// app.preferences (no money fields: Preferences is enum/text only). Owner A.
import { Preferences } from "@tab/shared";
import type postgres from "postgres";
import { sql, type Db } from "../db";

/** The empty prefs stored when the delegate parse fails (PLAN: a null parse stores empty prefs). */
export const EMPTY_PREFERENCES: Preferences = {
  cuisines_like: [], cuisines_avoid: [], dietary: [], vibe: [], earliest_start: null, latest_end: null, dealbreakers: [],
};

/** Validates with Preferences.parse, then upserts on (plan_id, user_id). */
export async function upsertPreferences(planId: string, userId: string, prefs: Preferences, tx: Db = sql): Promise<void> {
  const v = Preferences.parse(prefs);
  await tx`
    insert into app.preferences (plan_id, user_id, prefs) values (${planId}, ${userId}, ${tx.json(v as postgres.JSONValue)})
    on conflict (plan_id, user_id) do update set prefs = excluded.prefs, updated_at = now()`;
}

/** One member's prefs, or null. */
export async function getPreferences(planId: string, userId: string, tx: Db = sql): Promise<Preferences | null> {
  const [row] = await tx<{ prefs: Preferences }[]>`
    select prefs from app.preferences where plan_id = ${planId} and user_id = ${userId}`;
  return row?.prefs ?? null;
}

/** Prefs per member (optionally only `userIds`), ordered by user_id. */
export async function listPreferences(planId: string, userIds?: readonly string[], tx: Db = sql): Promise<{ user_id: string; prefs: Preferences }[]> {
  return tx<{ user_id: string; prefs: Preferences }[]>`
    select user_id, prefs from app.preferences
    where plan_id = ${planId} ${userIds ? tx`and user_id = any(${tx.array([...userIds])}::uuid[])` : tx``}
    order by user_id`;
}

/** "forget me". */
export async function deletePreferencesForUser(userId: string, tx: Db = sql): Promise<void> {
  await tx`delete from app.preferences where user_id = ${userId}`;
}
