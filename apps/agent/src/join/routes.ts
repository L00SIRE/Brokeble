// Web entry API (A plan T4/T13, ux-flow §7.2): POST /start, POST /join, POST /plans, GET /plans/:code, GET /status.
// CORS for all of them is applied by app.ts (publicCors, cors.ts). No request-body logging anywhere (budget_usd, phones),
// and the status token rides in the query string, which the http logger never records (it logs the route pattern).
// Rate limits keyed on Fly-Client-IP: /start 5/min, /join 10/min, /plans 5/min, /plans/:code 60/min; /status 40/min
// per token plus a loose 600/min per-IP ceiling (a venue's shared Wi-Fi is one IP). Owner A.
import type { Context, Hono } from "hono";
import QRCode from "qrcode";
import { acceptBudget } from "../delegates/budget";
import { env } from "../env";
import { emit } from "../events";
import { stageAtLeast, TERMINAL_STAGES } from "../plan/machine";
import * as privateConstraints from "../repo/privateConstraints";
import { getParticipant, upsertParticipant } from "../repo/participants";
import { currentPlanForUser, getPlanByCode } from "../repo/plans";
import type { PlanRow } from "../repo/types";
import { findUserByPhone, upsertUserByPhone } from "../repo/users";
import { createPlanRecord } from "./createPlanRecord";
import { buildPlanPreview, JOINABLE_STATES, MAX_PLAN_PARTICIPANTS, planCounts } from "./preview";
import { createRateLimiter } from "./rateLimit";
import {
  CreatePlanBody, type CreatePlanResponse, JoinBody, type JoinError, type JoinResponse, type PlanPreview, StartBody, type StartResponse,
} from "./schemas";
import { CapacityError, ensureSeat, joinSeatScope, START_SEAT_SCOPE, type Seat } from "./seats";
import { getStatus, joinSmsBody, SMS_BODY, smsHref } from "./status";
import { issueStatusToken, type StatusRole, verifyStatusToken } from "./statusToken";

const MINUTE = 60_000;
const startLimiter = createRateLimiter({ limit: 5, windowMs: MINUTE });
const joinLimiter = createRateLimiter({ limit: 10, windowMs: MINUTE });
const plansLimiter = createRateLimiter({ limit: 5, windowMs: MINUTE });
const previewLimiter = createRateLimiter({ limit: 60, windowMs: MINUTE });
const statusTokenLimiter = createRateLimiter({ limit: 40, windowMs: MINUTE });
const statusIpLimiter = createRateLimiter({ limit: 600, windowMs: MINUTE });
// Ink modules on paper, matching apps/web/lib/qr.ts QR_COLORS, so the hand-off QR reads as printed on the stub.
const QR = { type: "svg", margin: 1, color: { dark: "#100e0aff", light: "#f6f1e6ff" } } as const;
const NO_STORE = { "Cache-Control": "no-store" };

/** Mounts the five web-entry routes. */
export function mountJoin(app: Hono): void {
  app.post("/start", handleStartRoute);
  app.post("/join", handleJoinRoute);
  app.post("/plans", handlePlansRoute);
  app.get("/plans/:code", handlePlanPreviewRoute);
  app.get("/status", handleStatusRoute);
}

const rateLimited = (c: Context): Response => c.json({ error: "rate_limited" } satisfies JoinError, 429, { "Retry-After": "60" });
const capacity = (c: Context): Response => c.json({ error: "capacity" } satisfies JoinError, 503);
const unauthorized = (c: Context): Response => c.json({ error: "unauthorized" }, 401, NO_STORE);

/** Zod issues → wire issues. Messages never echo input values, so a budget cannot leak through a 422. */
function invalid(c: Context, issues?: { path: PropertyKey[]; message: string }[]): Response {
  const body: JoinError = { error: "invalid", ...(issues && { issues: issues.map((i) => ({ path: i.path.map(String).join("."), message: i.message })) }) };
  return c.json(body, 422);
}

/** The hand-off fields every POST returns: number, first text, signed status token and the desktop QR to /t/<token>. */
async function handoff(seat: Seat, body: string, claims: { u: string; p: string | null; r: StatusRole }) {
  const status_token = issueStatusToken(claims);
  const handoff_url = `${new URL(env.WEB_ORIGIN).origin}/t/${status_token}`;
  return {
    assigned_number: seat.assignedPhoneNumber,
    sms_body: body,
    sms_href: smsHref(seat.assignedPhoneNumber, body),
    status_token,
    handoff_url,
    handoff_qr_svg: await QRCode.toString(handoff_url, { ...QR, width: 200 }),
  };
}

// ---------------------------------------------------------------------------------------------------------------- /start

/** HTTP shell: rate limit (429) → StartBody (422) → start() (503 capacity). */
export async function handleStartRoute(c: Context): Promise<Response> {
  if (!startLimiter(clientIp(c))) return rateLimited(c);
  const parsed = StartBody.safeParse(await c.req.json().catch(() => undefined));
  if (!parsed.success) return invalid(c, parsed.error.issues);
  try {
    return c.json(await start(parsed.data), 200, NO_STORE);
  } catch (e) {
    if (e instanceof CapacityError) return capacity(c);
    throw e;
  }
}

/**
 * upsertUserByPhone (a blank name never overwrites) → ensureSeat(scope "start") → organizer token with p = null. The
 * response is the same shape and sms_body for every number, whether or not it is already in a plan: the number is
 * unverified, so any difference would leak plan membership. /status reveals the plan after the owner's own text.
 */
export async function start(body: StartBody): Promise<StartResponse> {
  const user = await upsertUserByPhone({ phone_e164: body.phone_e164, first_name: "" });
  const seat = await ensureSeat(user, START_SEAT_SCOPE);
  return handoff(seat, SMS_BODY.start, { u: user.id, p: null, r: "organizer" });
}

// ----------------------------------------------------------------------------------------------------------------- /join

/** HTTP shell: rate limit (429) → JoinBody.safeParse (422 {error:"invalid", issues}) → join() → c.json(body, status). */
export async function handleJoinRoute(c: Context): Promise<Response> {
  if (!joinLimiter(clientIp(c))) return rateLimited(c);
  const parsed = JoinBody.safeParse(await c.req.json().catch(() => undefined));
  if (!parsed.success) return invalid(c, parsed.error.issues);
  const out = await join(parsed.data);
  return c.json(out.body, out.status, NO_STORE);
}

export type JoinOutcome = { status: 200; body: JoinResponse } | { status: 404 | 409 | 422 | 503; body: JoinError };

const toCents = (usd: number): number => Math.round(usd * 100);

/**
 * True when joining `plan` would strand the user: inbound texts go to their most recent active plan (router loadContext
 * → currentPlanForUser), so a live seat in another plan means either this join's first text lands there (the other
 * plan is newer) or the other plan never hears from them again. A stale INVITED row in an older plan is harmless (they
 * never texted it, and this newer plan wins the routing), so it does not block.
 */
async function inOtherPlan(userId: string, plan: PlanRow): Promise<boolean> {
  const other = await currentPlanForUser(userId);
  if (!other || other.id === plan.id) return false;
  const seat = await getParticipant(other.id, userId);
  if (!seat || TERMINAL_STAGES.includes(seat.stage)) return false;
  return stageAtLeast(seat.stage, "JOINED") || other.created_at >= plan.created_at;
}

/**
 * Plan by code: none → 404; state ∉ JOINABLE → 409 plan_closed. A bad budget is rejected (422) before any write.
 * Full (8 seated and the caller is not already a participant) → 409 plan_full; a live seat in another active plan
 * (inOtherPlan) → 409 in_other_plan; both before any write. One active plan per person is what the router assumes
 * (ux-flow §6). Like already_joined, in_other_plan answers for an unverified number: an accepted membership oracle. Then
 * upsertUserByPhone → ensureSeat(`join:<planId>`; CapacityError → 503, no participant left behind) →
 * upsertParticipant (INVITED; emit `lane` if created) → privateConstraints.upsert (source 'form', confidence 'high')
 * when an older client sent a budget. The 8-seat cap is soft under a race (two joins at 7 can both pass).
 */
export async function join(body: JoinBody): Promise<JoinOutcome> {
  const plan = await getPlanByCode(body.code);
  if (!plan) return { status: 404, body: { error: "not_found" } };
  if (!JOINABLE_STATES.has(plan.state)) return { status: 409, body: { error: "plan_closed" } };

  let budget: { target_pp_cents: number; hard_max_pp_cents: number | null } | null = null;
  if (body.budget_usd) {
    const parse = { target_pp_cents: toCents(body.budget_usd.target), hard_max_pp_cents: body.budget_usd.hard_max === undefined ? null : toCents(body.budget_usd.hard_max), confidence: "high" as const };
    if (!acceptBudget(parse)) return { status: 422, body: { error: "invalid", issues: [{ path: "budget_usd", message: "budget out of range" }] } };
    budget = parse;
  }

  const known = await findUserByPhone(body.phone_e164);
  const alreadyParticipant = known !== null && (await getParticipant(plan.id, known.id)) !== null;
  if (!alreadyParticipant && (await planCounts(plan.id)).seated >= MAX_PLAN_PARTICIPANTS) return { status: 409, body: { error: "plan_full" } };
  if (known && (await inOtherPlan(known.id, plan))) return { status: 409, body: { error: "in_other_plan" } };

  const user = await upsertUserByPhone({ phone_e164: body.phone_e164, first_name: body.first_name });
  let seat: Seat;
  try {
    seat = await ensureSeat(user, joinSeatScope(plan.id));
  } catch (e) {
    if (e instanceof CapacityError) return { status: 503, body: { error: "capacity" } };
    throw e;
  }

  const { row, created } = await upsertParticipant(plan.id, user.id);
  if (created) await emit({ type: "lane", plan_id: plan.id, lane: row.lane, first_name: user.first_name, stage: row.stage, amount_cents: null, cybs_id_short: null });
  if (budget) {
    await privateConstraints.upsert({ plan_id: plan.id, user_id: user.id, ...budget, source: "form", confidence: "high" });
  }

  // DECLINED and RELEASED rank below INVITED, so they never count as "already joined".
  const already_joined = stageAtLeast(row.stage, "JOINED");
  const sms_body = already_joined ? SMS_BODY.inPlan : joinSmsBody(plan.title);
  const [h, preview] = await Promise.all([handoff(seat, sms_body, { u: user.id, p: plan.id, r: "guest" }), buildPlanPreview(plan)]);
  return { status: 200, body: { ...h, join_text: sms_body, already_joined, plan: preview } };
}

// ---------------------------------------------------------------------------------------------------------------- /plans

/** HTTP shell: rate limit → CreatePlanBody.safeParse (422) → createPlan() (503 capacity) → 200. */
export async function handlePlansRoute(c: Context): Promise<Response> {
  if (!plansLimiter(clientIp(c))) return rateLimited(c);
  const parsed = CreatePlanBody.safeParse(await c.req.json().catch(() => undefined));
  if (!parsed.success) return invalid(c, parsed.error.issues);
  try {
    return c.json(await createPlan(parsed.data), 200, NO_STORE);
  } catch (e) {
    if (e instanceof CapacityError) return capacity(c);
    throw e;
  }
}

/**
 * The fallback creation path. upsert organizer → ensureSeat(scope "start") first (CapacityError → 503 with no plan
 * left behind) → createPlanRecord(INVITED): the organizer is a participant from the start, and their first text goes
 * through the forgiving join. Returns the hand-off fields with an organizer token for this plan, plus the deprecated
 * qr_svg (the live pre-redesign web requires it until the new web deploys).
 */
export async function createPlan(body: CreatePlanBody): Promise<CreatePlanResponse> {
  const organizer = await upsertUserByPhone(body.organizer);
  const seat = await ensureSeat(organizer, START_SEAT_SCOPE);
  const { plan, join_url } = await createPlanRecord(
    organizer,
    { title: body.title, area: body.area, date: body.date, time_start: body.time_start, time_end: body.time_end, party_target: body.party_target },
    { organizerStage: "INVITED" },
  );
  const [h, qr_svg] = await Promise.all([
    handoff(seat, SMS_BODY.plansFallback, { u: organizer.id, p: plan.id, r: "organizer" }),
    QRCode.toString(join_url, { ...QR, width: 256 }),
  ]);
  return { code: plan.code, join_url, qr_svg, ...h };
}

// ---------------------------------------------------------------------------------------------------- GET /plans/:code

/**
 * Public invite preview: 404 for a malformed or unknown code. Whitelisted fields only (preview.ts). Cached 15 s: the
 * Next server fetches it with revalidate 10, and Vercel's egress shares one rate-limit bucket.
 */
export async function handlePlanPreviewRoute(c: Context): Promise<Response> {
  if (!previewLimiter(clientIp(c))) return rateLimited(c);
  const code = c.req.param("code") ?? "";
  const plan = /^\d{4}$/.test(code) ? await getPlanByCode(code) : null;
  // SHOWCASE is B's live-Scout row, never an invitable plan.
  if (!plan || plan.state === "SHOWCASE") return c.json({ error: "not_found" } satisfies JoinError, 404);
  return c.json((await buildPlanPreview(plan)) satisfies PlanPreview, 200, { "Cache-Control": "public, max-age=15" });
}

// --------------------------------------------------------------------------------------------------------- GET /status

/** 429 past the IP ceiling → 401 bad/expired token → 429 past 40/min for this token → getStatus (401 if the user is gone). */
export async function handleStatusRoute(c: Context): Promise<Response> {
  if (!statusIpLimiter(clientIp(c))) return rateLimited(c);
  const claims = verifyStatusToken(c.req.query("t"));
  if (!claims) return unauthorized(c);
  if (!statusTokenLimiter(`${claims.u}:${claims.iat}`)) return rateLimited(c);
  const status = await getStatus(claims);
  return status ? c.json(status, 200, NO_STORE) : unauthorized(c);
}

/** Fly-Client-IP header, else "local" (dev). */
export function clientIp(c: Context): string {
  return c.req.header("fly-client-ip") ?? "local";
}
