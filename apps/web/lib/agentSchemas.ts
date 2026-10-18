// Flow-only mirrors of the agent's /start, /join, /plans, /plans/:code and /status shapes (ux-flow §7.3). They mirror
// apps/agent/src/join/schemas.ts: keep both in sync. This module imports only `zod`, never `@tab/shared`: the landing
// and invite pages load it, and @tab/shared's SseEvent union pulls every schema (itinerary, TAP, SSE) into the bundle.
// Response mirrors are non-strict z.object on purpose, so fields the agent adds later never break the live web.
import { z } from "zod";

/** Fields every seat-issuing endpoint returns (/start, /join, /plans): what the hand-off and live status need. */
const Handoff = {
  assigned_number: z.string(),
  sms_body: z.string(),
  sms_href: z.string(),
  status_token: z.string().min(1),
  handoff_url: z.string(),
  handoff_qr_svg: z.string(),
};

export const StartRequest = z.strictObject({ phone_e164: z.e164(), consent: z.literal(true) });
export type StartRequest = z.infer<typeof StartRequest>;
/** Identical for a new number and one already in a plan: the number is unverified (ux-flow §6, §7.2). */
export const StartResponse = z.object(Handoff);
export type StartResponse = z.infer<typeof StartResponse>;

/** Public plan preview (GET /plans/:code). A whitelist: never budgets, never friends' names. */
export const PlanPreview = z.object({
  code: z.string(),
  title: z.string(),
  date_label: z.string(),
  time_label: z.string(),
  area: z.string(),
  organizer_first_name: z.string().nullable(),
  joined: z.number().int().nonnegative(),
  party_target: z.number().int(),
  status: z.enum(["open", "closed", "full"]),
});
export type PlanPreview = z.infer<typeof PlanPreview>;

export const StatusPhase = z.enum(["waiting", "texted", "plan_ready", "joined", "closed"]);
export type StatusPhase = z.infer<typeof StatusPhase>;
export const StatusRole = z.enum(["organizer", "guest"]);
export type StatusRole = z.infer<typeof StatusRole>;

/**
 * GET /status?t=. While `phase` is "waiting" the proof-of-possession gate holds: `first_name`, `plan` and `steps` are
 * null until the number's owner has texted since the token was issued (ux-flow §7.2).
 */
export const StatusResponse = z.object({
  phase: StatusPhase,
  role: StatusRole,
  phone_last4: z.string(),
  /** Null once the seat was released (an untexted seat is freed after 15 min): the person starts again. */
  assigned_number: z.string().nullable(),
  sms_body: z.string(),
  first_name: z.string().nullable(),
  plan: PlanPreview.extend({ join_url: z.string() }).nullable(),
  steps: z.object({ budget: z.boolean(), prefs: z.boolean() }).nullable(),
});
export type StatusResponse = z.infer<typeof StatusResponse>;
export type StatusPlan = NonNullable<StatusResponse["plan"]>;

export const JoinRequest = z.strictObject({
  code: z.string().regex(/^\d{4}$/),
  phone_e164: z.e164(),
  /** Optional since the chat-first flow: SquadTab asks for the name by text. */
  first_name: z.string().trim().max(40).optional(),
  /** Kept for backward compatibility; the web no longer sends it (budgets are asked only in private chat). */
  budget_usd: z.strictObject({ target: z.number().positive().max(1000), hard_max: z.number().positive().max(1000).optional() }).optional(),
  consent: z.literal(true),
});
export type JoinRequest = z.infer<typeof JoinRequest>;
export const JoinResponse = z.object({ ...Handoff, join_text: z.string(), already_joined: z.boolean(), plan: PlanPreview });
export type JoinResponse = z.infer<typeof JoinResponse>;

export const CreatePlanRequest = z.strictObject({
  title: z.string(),
  area: z.string(),
  date: z.string(),
  time_start: z.string(),
  time_end: z.string(),
  party_target: z.number().int(),
  /** first_name may be "" (unknown): SquadTab asks by text. */
  organizer: z.strictObject({ phone_e164: z.e164(), first_name: z.string().max(40) }),
});
export type CreatePlanRequest = z.infer<typeof CreatePlanRequest>;
/** `qr_svg` is being dropped by the agent once this web is live (ux-flow §7.3), so it is optional and unused here. */
export const CreatePlanResponse = z.object({ ...Handoff, code: z.string(), join_url: z.string(), qr_svg: z.string().optional() });
export type CreatePlanResponse = z.infer<typeof CreatePlanResponse>;

/** Error body of /start, /join and /plans (404 not_found, 409 plan_closed | plan_full | in_other_plan, 422 invalid, 429 rate_limited, 503 capacity). */
export const JoinError = z.object({
  error: z.enum(["not_found", "plan_closed", "plan_full", "in_other_plan", "invalid", "rate_limited", "capacity"]),
  issues: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
});
export type JoinError = z.infer<typeof JoinError>;
