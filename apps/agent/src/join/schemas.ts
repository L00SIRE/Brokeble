// Wire contracts for POST /join and POST /plans (PLAN §18). Not in @tab/shared (§8 is frozen), so apps/web/lib/agent.ts
// mirrors them: keep both in sync. Owner A.
import * as z from "zod";
import { HHMM, IsoDate } from "@tab/shared";

export const JoinBody = z.strictObject({
  code: z.string().regex(/^\d{4}$/),
  phone_e164: z.e164(),
  first_name: z.string().trim().min(1).max(40),
  // Dollars; converted to cents and checked with the delegate acceptance rules before any write. Never logged.
  budget_usd: z.strictObject({ target: z.number().positive().max(1000), hard_max: z.number().positive().max(1000).optional() }).optional(),
  consent: z.literal(true),
});
export type JoinBody = z.infer<typeof JoinBody>;

export const JoinResponse = z.strictObject({ assigned_number: z.string(), sms_href: z.string(), join_text: z.string() });
export type JoinResponse = z.infer<typeof JoinResponse>;

/** Error bodies: 404 not_found, 409 plan_closed, 422 invalid (+issues), 429 rate_limited, 503 capacity. */
export type JoinErrorCode = "not_found" | "plan_closed" | "invalid" | "rate_limited" | "capacity";
export type JoinError = { error: JoinErrorCode; issues?: { path: string; message: string }[] };

export const CreatePlanBody = z.strictObject({
  title: z.string().trim().min(1).max(80),
  area: z.string().trim().min(2).max(60),
  date: IsoDate,
  time_start: HHMM,
  time_end: HHMM,
  party_target: z.number().int().min(2).max(8),
  organizer: z.strictObject({ phone_e164: z.e164(), first_name: z.string().trim().min(1).max(40) }),
});
export type CreatePlanBody = z.infer<typeof CreatePlanBody>;

export const CreatePlanResponse = z.strictObject({ code: z.string(), join_url: z.url(), qr_svg: z.string() });
export type CreatePlanResponse = z.infer<typeof CreatePlanResponse>;
