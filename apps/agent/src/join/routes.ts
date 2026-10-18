// POST /join and POST /plans (A plan T4/T13). CORS for both is applied by app.ts (publicCors). No request-body
// logging anywhere (budget_usd). Rate limits keyed on Fly-Client-IP: /join 10/min, /plans 5/min. Owner A.
import { randomInt } from "node:crypto";
import type { Context, Hono } from "hono";
import QRCode from "qrcode";
import { acceptBudget } from "../delegates/budget";
import { jobs } from "../dueJobs";
import { env } from "../env";
import { emit } from "../events";
import { A_JOB_KINDS, aJobKeys } from "../jobs/kinds";
import { errInfo, log } from "../log";
import * as privateConstraints from "../repo/privateConstraints";
import { getPlanByCode, insertPlan } from "../repo/plans";
import { upsertParticipant } from "../repo/participants";
import { upsertUserByPhone } from "../repo/users";
import { createRateLimiter } from "./rateLimit";
import { CreatePlanBody, type CreatePlanResponse, JoinBody, type JoinError, type JoinResponse } from "./schemas";
import { CapacityError, ensureSeat } from "./seats";

const MINUTE = 60_000;
const joinLimiter = createRateLimiter({ limit: 10, windowMs: MINUTE });
const plansLimiter = createRateLimiter({ limit: 5, windowMs: MINUTE });
const JOINABLE = new Set(["COLLECTING", "RESEARCHING", "VOTING"]);
const ORG_JOIN_STATUS_DELAY_MS = (env.DEMO_TIMERS ? 3 : 20) * MINUTE;

/** Mounts POST /join → handleJoinRoute and POST /plans → handlePlansRoute. */
export function mountJoin(app: Hono): void {
  app.post("/join", handleJoinRoute);
  app.post("/plans", handlePlansRoute);
}

const rateLimited = (c: Context): Response => c.json({ error: "rate_limited" } satisfies JoinError, 429, { "Retry-After": "60" });

/** Zod issues → wire issues. Messages never echo input values, so a budget cannot leak through a 422. */
function invalid(c: Context, issues?: { path: PropertyKey[]; message: string }[]): Response {
  const body: JoinError = { error: "invalid", ...(issues && { issues: issues.map((i) => ({ path: i.path.map(String).join("."), message: i.message })) }) };
  return c.json(body, 422);
}

/** HTTP shell: rate limit (429) → JoinBody.safeParse (422 {error:"invalid", issues}) → join() → c.json(body, status). */
export async function handleJoinRoute(c: Context): Promise<Response> {
  if (!joinLimiter(clientIp(c))) return rateLimited(c);
  const parsed = JoinBody.safeParse(await c.req.json().catch(() => undefined));
  if (!parsed.success) return invalid(c, parsed.error.issues);
  const out = await join(parsed.data);
  return c.json(out.body, out.status);
}

/** HTTP shell: rate limit → CreatePlanBody.safeParse (422) → createPlan() → 200. */
export async function handlePlansRoute(c: Context): Promise<Response> {
  if (!plansLimiter(clientIp(c))) return rateLimited(c);
  const parsed = CreatePlanBody.safeParse(await c.req.json().catch(() => undefined));
  if (!parsed.success) return invalid(c, parsed.error.issues);
  return c.json(await createPlan(parsed.data), 200);
}

export type JoinOutcome = { status: 200; body: JoinResponse } | { status: 404 | 409 | 422 | 503; body: JoinError };

const toCents = (usd: number): number => Math.round(usd * 100);

/**
 * Plan by code: none → 404; state ∉ {COLLECTING, RESEARCHING, VOTING} → 409. A bad budget is rejected (422) before
 * any write; then upsertUserByPhone → ensureSeat (CapacityError → 503, no participant left behind) →
 * upsertParticipant (INVITED; emit `lane` if created) → privateConstraints.upsert (source 'form', confidence 'high').
 */
export async function join(body: JoinBody): Promise<JoinOutcome> {
  const plan = await getPlanByCode(body.code);
  if (!plan) return { status: 404, body: { error: "not_found" } };
  if (!JOINABLE.has(plan.state)) return { status: 409, body: { error: "plan_closed" } };

  let budget: { target_pp_cents: number; hard_max_pp_cents: number | null } | null = null;
  if (body.budget_usd) {
    const parse = { target_pp_cents: toCents(body.budget_usd.target), hard_max_pp_cents: body.budget_usd.hard_max === undefined ? null : toCents(body.budget_usd.hard_max), confidence: "high" as const };
    if (!acceptBudget(parse)) return { status: 422, body: { error: "invalid", issues: [{ path: "budget_usd", message: "budget out of range" }] } };
    budget = parse;
  }

  const user = await upsertUserByPhone({ phone_e164: body.phone_e164, first_name: body.first_name });
  let seat;
  try {
    seat = await ensureSeat(user, plan.id);
  } catch (e) {
    if (e instanceof CapacityError) return { status: 503, body: { error: "capacity" } };
    throw e;
  }

  const { row, created } = await upsertParticipant(plan.id, user.id);
  if (created) await emit({ type: "lane", plan_id: plan.id, lane: row.lane, first_name: user.first_name, stage: row.stage, amount_cents: null, cybs_id_short: null });
  if (budget) {
    await privateConstraints.upsert({ plan_id: plan.id, user_id: user.id, ...budget, source: "form", confidence: "high" });
  }

  const join_text = `JOIN ${body.code}`;
  return {
    status: 200,
    body: { assigned_number: seat.assignedPhoneNumber, sms_href: `sms:${seat.assignedPhoneNumber}&body=${encodeURIComponent(join_text)}`, join_text },
  };
}

const isUniqueViolation = (e: unknown): boolean => typeof e === "object" && e !== null && "code" in e && e.code === "23505";

/**
 * upsert organizer → insertPlan with a random 4-digit code (retry 23505 ≤10×) → enqueue org_join_status →
 * join_url = `${WEB_ORIGIN}/j/${code}`, qr_svg = await QRCode.toString(join_url, {type:"svg", margin:1, width:256}).
 */
export async function createPlan(body: CreatePlanBody): Promise<CreatePlanResponse> {
  const organizer = await upsertUserByPhone(body.organizer);
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = String(randomInt(10_000)).padStart(4, "0");
    if (code === env.DEMO_CODE) continue; // reserved for the seeded demo plan
    let plan;
    try {
      plan = await insertPlan({ code, title: body.title, area: body.area, event_date: body.date, time_start: body.time_start, time_end: body.time_end, party_target: body.party_target, organizer_id: organizer.id });
    } catch (e) {
      if (isUniqueViolation(e)) continue;
      throw e;
    }
    // Only the organizer nudge is lost if this fails; the plan itself is fine.
    await jobs
      .enqueue(A_JOB_KINDS.orgJoinStatus, aJobKeys.orgJoinStatus(plan.id), new Date(Date.now() + ORG_JOIN_STATUS_DELAY_MS), {}, { planId: plan.id })
      .catch((e) => log.warn({ plan_id: plan.id, ...errInfo(e) }, "org_join_status enqueue failed"));
    const join_url = `${new URL(env.WEB_ORIGIN).origin}/j/${plan.code}`;
    return { code: plan.code, join_url, qr_svg: await QRCode.toString(join_url, { type: "svg", margin: 1, width: 256 }) };
  }
  throw new Error("plan code allocation exhausted");
}

/** Fly-Client-IP header, else "local" (dev). */
export function clientIp(c: Context): string {
  return c.req.header("fly-client-ip") ?? "local";
}
