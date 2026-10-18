// Typed client for the agent API (PLAN §18). Request/response shapes for /join and /plans are not in @tab/shared (§8),
// so they mirror apps/agent/src/join/schemas.ts: keep both in sync.
import { SseEvent } from "@tab/shared";
import { z } from "zod";

const BASE = process.env.NEXT_PUBLIC_AGENT_URL ?? "";

export const JoinRequest = z.strictObject({
  code: z.string().regex(/^\d{4}$/),
  phone_e164: z.e164(),
  first_name: z.string().trim().min(1).max(40),
  budget_usd: z.strictObject({ target: z.number().positive().max(1000), hard_max: z.number().positive().max(1000).optional() }).optional(),
  consent: z.literal(true),
});
export type JoinRequest = z.infer<typeof JoinRequest>;
export const JoinResponse = z.object({ assigned_number: z.string(), sms_href: z.string(), join_text: z.string() });
export type JoinResponse = z.infer<typeof JoinResponse>;

export const CreatePlanRequest = z.strictObject({
  title: z.string(),
  area: z.string(),
  date: z.string(),
  time_start: z.string(),
  time_end: z.string(),
  party_target: z.number().int(),
  organizer: z.strictObject({ phone_e164: z.e164(), first_name: z.string() }),
});
export type CreatePlanRequest = z.infer<typeof CreatePlanRequest>;
export const CreatePlanResponse = z.object({ code: z.string(), join_url: z.string(), qr_svg: z.string() });
export type CreatePlanResponse = z.infer<typeof CreatePlanResponse>;

/** Error body of /join (404 not_found, 409 plan_closed, 422 invalid, 429 rate_limited, 503 capacity). */
export const JoinError = z.object({
  error: z.enum(["not_found", "plan_closed", "invalid", "rate_limited", "capacity"]),
  issues: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
});
export type JoinError = z.infer<typeof JoinError>;

export const SnapshotResponse = z.object({ last_id: z.number().int(), events: z.array(z.object({ id: z.number().int(), data: SseEvent })) });
export type SnapshotResponse = z.infer<typeof SnapshotResponse>;

export type OpsAction = "reset" | "replay" | "tap-test" | "live-scout" | "release-seats";

export class AgentError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function eventsUrl(key: string): string {
  return `${BASE}/events?k=${encodeURIComponent(key)}`;
}

async function request<T>(path: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, init);
  if (!res.ok) throw new AgentError(res.status, `${init?.method ?? "GET"} ${path} failed`);
  return schema.parse(await res.json());
}

const post = (body: unknown, headers?: HeadersInit): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json", ...headers },
  body: JSON.stringify(body),
});

export const agent = {
  createPlan: (body: CreatePlanRequest) => request("/plans", CreatePlanResponse, post(CreatePlanRequest.parse(body))),
  join: (body: JoinRequest) => request("/join", JoinResponse, post(JoinRequest.parse(body))),
  snapshot: (key: string) => request(`/events/snapshot?k=${encodeURIComponent(key)}`, SnapshotResponse),
  ops: (action: OpsAction, operatorKey: string, body: { kind?: string } = {}) =>
    request(`/ops/${action}`, z.object({ ok: z.boolean() }), post(body, { Authorization: `Bearer ${operatorKey}` })),
};
