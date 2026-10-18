// Typed client for the agent API (PLAN §18). Request/response shapes for /join and /plans
// are not in @tab/shared (§8), so they are declared here.
import { z } from "zod";

const BASE = process.env.NEXT_PUBLIC_AGENT_URL ?? "";

export const JoinRequest = z.strictObject({
  code: z.string(),
  phone_e164: z.e164(),
  first_name: z.string().min(1),
  budget_usd: z.strictObject({ target: z.number(), hard_max: z.number().optional() }).optional(),
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
  // Snapshot shape is owned by A (C-6); untyped until agreed.
  snapshot: (key: string) => request(`/events/snapshot?k=${encodeURIComponent(key)}`, z.unknown()),
  ops: (action: OpsAction, operatorKey: string, body: { kind?: string } = {}) =>
    request(`/ops/${action}`, z.object({ ok: z.boolean() }), post(body, { Authorization: `Bearer ${operatorKey}` })),
};
