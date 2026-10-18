// app.plans reads and non-state writes. State changes go ONLY through plan/machine.ts transition() (M5). Owner A.
import type postgres from "postgres";
import { sql, type Db } from "../db";
import { isUuid } from "./sql";
import type { NewPlanInput, PlanDeadlines, PlanRow, PlanState } from "./types";

/** Non-terminal states (SHOWCASE excluded; CONFIRMED and CANCELLED are terminal). */
export const ACTIVE_STATES: readonly PlanState[] = ["COLLECTING", "RESEARCHING", "VOTING", "ORDERING", "APPROVING", "COMMITTING", "CANCELLING"];

/** PlanRow columns of alias `p`, with date/time normalized to IsoDate/HHMM in SQL. Exported for plan/machine.ts. */
export const planCols = (db: Db) => db`
  p.id, p.ref, trim(p.code) as code, p.organizer_id, p.state, p.version, p.title, p.area,
  to_char(p.event_date, 'YYYY-MM-DD') as event_date, to_char(p.time_start, 'HH24:MI') as time_start,
  to_char(p.time_end, 'HH24:MI') as time_end, p.party_target, p.chosen_bundle_id, p.venue_order_id, p.deadlines,
  p.created_at, p.updated_at`;

const activeStates = (db: Db) => db.array([...ACTIVE_STATES]);

/** One plan by id, or null. */
export async function getPlan(planId: string, tx: Db = sql): Promise<PlanRow | null> {
  if (!isUuid(planId)) return null;
  const [row] = await tx<PlanRow[]>`select ${planCols(tx)} from app.plans p where p.id = ${planId}`;
  return row ?? null;
}

/** By 4-char join code (any state; callers check the state). */
export async function getPlanByCode(code: string, tx: Db = sql): Promise<PlanRow | null> {
  const [row] = await tx<PlanRow[]>`select ${planCols(tx)} from app.plans p where p.code = ${code}`;
  return row ?? null;
}

/** By opaque ref (CREAO plan_ref, venue plan_ref, /p/:planRef pages). */
export async function getPlanByRef(ref: string, tx: Db = sql): Promise<PlanRow | null> {
  if (!isUuid(ref)) return null;
  const [row] = await tx<PlanRow[]>`select ${planCols(tx)} from app.plans p where p.ref = ${ref}`;
  return row ?? null;
}

/** Inserts a plan (fresh ref from the column default). Throws postgres 23505 on a code collision: callers retry. */
export async function insertPlan(p: NewPlanInput, tx: Db = sql): Promise<PlanRow> {
  const [row] = await tx<PlanRow[]>`
    insert into app.plans as p (code, organizer_id, state, title, area, event_date, time_start, time_end, party_target)
    values (${p.code}, ${p.organizer_id}, ${p.state ?? "COLLECTING"}, ${p.title}, ${p.area}, ${p.event_date}::date,
      ${p.time_start}::time, ${p.time_end}::time, ${p.party_target})
    returning ${planCols(tx)}`;
  return row!;
}

/**
 * The user's most recent plan in ACTIVE_STATES where they have a participant row past INVITED, or null (router step 7).
 * INVITED rows are skipped: /join creates one from a phone number nobody has proven, and only the phone itself texting
 * "JOIN <code>" (onJoinText, which looks the plan up by code) moves it to JOINED. Otherwise a web join with someone
 * else's number to a newer plan would take over which plan that person's texts go to and show them its title.
 */
export async function currentPlanForUser(userId: string, tx: Db = sql): Promise<PlanRow | null> {
  const [row] = await tx<PlanRow[]>`
    select ${planCols(tx)} from app.plans p join app.participants pt on pt.plan_id = p.id
    where pt.user_id = ${userId} and pt.stage <> 'INVITED' and p.state = any(${activeStates(tx)}::text[])
    order by p.created_at desc, p.id limit 1`;
  return row ?? null;
}

/**
 * The user's newest CONFIRMED plan whose event date is today or yesterday in America/Los_Angeles, or null (router: with
 * no active plan, right after a booking is exactly when people text "what time is dinner?" or "status").
 * Membership is a HELD or CAPTURED lane, not CAPTURED alone: a CONFIRMED plan captured every share (the venue confirms
 * only after the last capture), so a lane still HELD only means that person's share.captured hook was lost or is late.
 * RELEASED/DECLINED lanes and plans the user never held a share in are never returned.
 */
export async function recentConfirmedPlan(userId: string, tx: Db = sql): Promise<PlanRow | null> {
  const [row] = await tx<PlanRow[]>`
    select ${planCols(tx)} from app.plans p join app.participants pt on pt.plan_id = p.id
    where pt.user_id = ${userId} and pt.stage in ('HELD', 'CAPTURED') and p.state = 'CONFIRMED'
      and p.event_date >= (now() at time zone 'America/Los_Angeles')::date - 1
    order by p.created_at desc, p.id limit 1`;
  return row ?? null;
}

/** Every plan in ACTIVE_STATES (ops reset). Never returns SHOWCASE. */
export async function listActivePlans(tx: Db = sql): Promise<PlanRow[]> {
  return tx<PlanRow[]>`
    select ${planCols(tx)} from app.plans p where p.state = any(${activeStates(tx)}::text[]) order by p.created_at, p.id`;
}

/** Most recent plan with a venue_order_id (ops tap-test target), or null. */
export async function latestPlanWithOrder(tx: Db = sql): Promise<PlanRow | null> {
  const [row] = await tx<PlanRow[]>`
    select ${planCols(tx)} from app.plans p where p.venue_order_id is not null order by p.updated_at desc limit 1`;
  return row ?? null;
}

/** The single SHOWCASE row (B's live-Scout demo), or null. */
export async function findShowcasePlan(tx: Db = sql): Promise<PlanRow | null> {
  const [row] = await tx<PlanRow[]>`
    select ${planCols(tx)} from app.plans p where p.state = 'SHOWCASE' order by p.created_at limit 1`;
  return row ?? null;
}

/** Sets chosen_bundle_id (the vote winner). */
export async function setChosenBundle(planId: string, bundleId: string, tx: Db = sql): Promise<void> {
  await tx`update app.plans set chosen_bundle_id = ${bundleId}, updated_at = now() where id = ${planId}`;
}

/** Sets venue_order_id and merges deadlines.approve_at. */
export async function setVenueOrder(planId: string, orderId: string, approveAt: Date, tx: Db = sql): Promise<void> {
  await tx`
    update app.plans
    set venue_order_id = ${orderId}, deadlines = deadlines || jsonb_build_object('approve_at', ${approveAt.toISOString()}::text),
      updated_at = now()
    where id = ${planId}`;
}

/** Merges keys into deadlines (jsonb ||). */
export async function mergeDeadlines(planId: string, d: PlanDeadlines, tx: Db = sql): Promise<void> {
  await tx`
    update app.plans set deadlines = deadlines || ${tx.json(d as postgres.JSONValue)}, updated_at = now()
    where id = ${planId}`;
}

/** Reset: renames the plan holding `fromCode` to `toCode`. False if no plan held it; throws 23505 on collision. */
export async function renameCode(fromCode: string, toCode: string, tx: Db = sql): Promise<boolean> {
  const rows = await tx`update app.plans set code = ${toCode}, updated_at = now() where code = ${fromCode} returning id`;
  return rows.length > 0;
}
