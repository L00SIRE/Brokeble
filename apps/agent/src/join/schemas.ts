// Wire contracts for POST /start, POST /join, POST /plans, GET /plans/:code and GET /status (PLAN §18, ux-flow §7.3).
// Not in @tab/shared (§8 is frozen), so apps/web/lib/agent.ts mirrors them: keep both in sync. Response schemas are
// strict, so a test that parses a response pins its exact key set (nothing private can ride along). Owner A.
import * as z from "zod";
import { HHMM, IsoDate } from "@tab/shared";

/**
 * A US (NANP) number in E.164, the same rule as the web's normalizePhone for 10-digit input. z.e164() alone accepts
 * "+1310555", and every accepted number costs one of the 25 Photon Free seats.
 */
const UsPhone = z.e164().regex(/^\+1[2-9]\d{2}[2-9]\d{6}$/);

/** First name as typed; '' means unknown (the web no longer asks, the chat name step fills it in). */
const OptionalFirstName = z.string().trim().max(40).default("");

export const JoinBody = z.strictObject({
  code: z.string().regex(/^\d{4}$/),
  phone_e164: UsPhone,
  first_name: OptionalFirstName,
  // Dollars; converted to cents and checked with the delegate acceptance rules before any write. Never logged.
  // Kept for older clients only: the web asks for the budget in the private chat now.
  budget_usd: z.strictObject({ target: z.number().positive().max(1000), hard_max: z.number().positive().max(1000).optional() }).optional(),
  consent: z.literal(true),
});
export type JoinBody = z.infer<typeof JoinBody>;

export const StartBody = z.strictObject({ phone_e164: UsPhone, consent: z.literal(true) });
export type StartBody = z.infer<typeof StartBody>;

/** Public plan card: whitelist only (no budgets, no member names). Built by join/preview.ts. */
export const PlanPreview = z.strictObject({
  code: z.string(),
  title: z.string(),
  date_label: z.string(), // "Sat, Oct 24"
  time_label: z.string(), // "7:00 PM"
  area: z.string(),
  organizer_first_name: z.string().nullable(),
  joined: z.number().int().nonnegative(), // stage ≥ JOINED, DECLINED/RELEASED excluded
  party_target: z.number().int(),
  status: z.enum(["open", "closed", "full"]),
});
export type PlanPreview = z.infer<typeof PlanPreview>;

/** Every hand-off response: the seat's number, the pre-filled first text, and the signed status token. */
const Handoff = {
  assigned_number: z.string(),
  sms_body: z.string(),
  sms_href: z.string(), // iOS form `sms:<n>&body=<enc>`, kept for older clients; new clients build it from the two above
  status_token: z.string(),
  handoff_url: z.url(), // `${WEB_ORIGIN}/t/<status_token>`: the phone side of the desktop QR
  handoff_qr_svg: z.string(),
};

/** Identical shape and sms_body for every number (unverified input): never reveals whether it is already in a plan. */
export const StartResponse = z.strictObject(Handoff);
export type StartResponse = z.infer<typeof StartResponse>;

export const JoinResponse = z.strictObject({
  ...Handoff,
  join_text: z.string(), // = sms_body; older clients read it
  already_joined: z.boolean(),
  plan: PlanPreview,
});
export type JoinResponse = z.infer<typeof JoinResponse>;

/** Error bodies: 404 not_found, 409 plan_closed | plan_full | in_other_plan, 422 invalid (+issues), 429 rate_limited, 503 capacity. */
export type JoinErrorCode = "not_found" | "plan_closed" | "plan_full" | "in_other_plan" | "invalid" | "rate_limited" | "capacity";
export type JoinError = { error: JoinErrorCode; issues?: { path: string; message: string }[] };

export const CreatePlanBody = z.strictObject({
  title: z.string().trim().min(1).max(80),
  area: z.string().trim().min(2).max(60),
  date: IsoDate,
  time_start: HHMM,
  time_end: HHMM,
  party_target: z.number().int().min(2).max(8),
  organizer: z.strictObject({ phone_e164: UsPhone, first_name: OptionalFirstName }),
});
export type CreatePlanBody = z.infer<typeof CreatePlanBody>;

export const CreatePlanResponse = z.strictObject({
  code: z.string(),
  join_url: z.url(),
  // Deprecated: only the pre-redesign CreatePlanForm reads it. Drop once the new web is live (ux-flow §7.3 deploy order).
  qr_svg: z.string(),
  ...Handoff,
});
export type CreatePlanResponse = z.infer<typeof CreatePlanResponse>;

export const StatusPhase = z.enum(["waiting", "texted", "plan_ready", "joined", "closed"]);
export type StatusPhase = z.infer<typeof StatusPhase>;

/**
 * GET /status. While the number's owner has not texted since the token was issued (phase "waiting" from the gate),
 * first_name, plan and steps are null. Never carries member names or any budget.
 */
export const StatusResponse = z.strictObject({
  phase: StatusPhase,
  role: z.enum(["organizer", "guest"]),
  phone_last4: z.string(),
  assigned_number: z.string().nullable(), // null once the seat was released (start again)
  sms_body: z.string(),
  first_name: z.string().nullable(),
  plan: PlanPreview.extend({ join_url: z.url() }).nullable(),
  steps: z.strictObject({ budget: z.boolean(), prefs: z.boolean() }).nullable(),
});
export type StatusResponse = z.infer<typeof StatusResponse>;
