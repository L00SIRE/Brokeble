// Typed client for the agent API (PLAN §18). The flow request/response mirrors live in agentSchemas.ts and are
// re-exported here; the console's snapshot and ops calls stay in this module. This module never imports @tab/shared
// statically: pages that only need a flow schema (e.g. /j via joinForm.ts) would otherwise ship every shared schema
// (itinerary, TAP, SSE), which the SseEvent union references.
import type { SseEvent } from "@tab/shared";
import { z } from "zod";
import { CreatePlanRequest, CreatePlanResponse, JoinRequest, JoinResponse } from "./agentSchemas";

export * from "./agentSchemas";

const BASE = process.env.NEXT_PUBLIC_AGENT_URL ?? "";

export type SnapshotResponse = { last_id: number; events: { id: number; data: SseEvent }[] };

/** Built on first use; the console already holds @tab/shared (useConsoleStream), so this resolves without a fetch. */
let snapshotSchema: Promise<z.ZodType<SnapshotResponse>> | undefined;
const loadSnapshotSchema = () =>
  (snapshotSchema ??= import("@tab/shared").then(
    ({ SseEvent }) => z.object({ last_id: z.number().int(), events: z.array(z.object({ id: z.number().int(), data: SseEvent })) }),
    (err: unknown) => {
      snapshotSchema = undefined; // a failed chunk load must not poison every later reconnect
      throw err;
    },
  ));

export type OpsAction = "reset" | "replay" | "tap-test" | "live-scout" | "release-seats" | "release-untexted";

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

/** /ops/* reply. `released` is the seat count from release-seats and release-untexted. */
const OpsResult = z.object({ ok: z.boolean(), released: z.number().int().nonnegative().optional() });

/** POST /ops/tap-test reply: a verdict (200) or a readable refusal (4xx). Either way the body is parsed, never thrown away. */
export const TapTestReply = z.object({
  ok: z.boolean(),
  message: z.string().optional(),
  expected_step: z.number().int().optional(),
  failed_step: z.number().int().nullable().optional(),
  failed_name: z.string().nullable().optional(),
  reason: z.string().nullable().optional(),
  matched: z.boolean().optional(),
  captured: z.boolean().optional(),
});
export type TapTestReply = z.infer<typeof TapTestReply>;
/** GET /ops/cybersource: the venue's allowlisted, live-fetched Cybersource transactions for the latest order. */
const CybsTxn = z.object({
  operation: z.string(),
  status: z.string().nullable(),
  message: z.string().nullable(),
  reason_code: z.string().nullable(),
  amount: z.string().nullable(),
  currency: z.string().nullable(),
  card_type: z.string().nullable(),
  card_last4: z.string().nullable(),
  submit_time: z.string().nullable(),
  processor: z.string().nullable(),
  merchant_id: z.string().nullable(),
});
export const CybsRow = z.object({
  seq: z.number().int(),
  op: z.enum(["auth", "capture", "reverse", "timeout_reverse"]),
  attempt: z.number().int(),
  recorded: z.string(),
  cybs_id: z.string().nullable(),
  lookup: z.enum(["live", "pending", "unavailable", "simulated", "none"]),
  txn: CybsTxn.nullable(),
});
export const CybsResponse = z.discriminatedUnion("available", [
  z.object({ available: z.literal(false), reason: z.string() }),
  z.object({
    available: z.literal(true),
    order_id: z.string().nullable(),
    fetched_at: z.string(),
    source: z.object({ id: z.string(), label: z.string() }),
    environment: z.string().nullable(),
    rows: z.array(CybsRow),
  }),
]);
export type CybsRow = z.infer<typeof CybsRow>;
export type CybsResponse = z.infer<typeof CybsResponse>;

export const agent = {
  cybersource: (operatorKey: string, signal?: AbortSignal) =>
    request("/ops/cybersource", CybsResponse, { headers: { Authorization: `Bearer ${operatorKey}` }, signal, cache: "no-store" }),
  createPlan: (body: CreatePlanRequest) => request("/plans", CreatePlanResponse, post(CreatePlanRequest.parse(body))),
  join: (body: JoinRequest) => request("/join", JoinResponse, post(JoinRequest.parse(body))),
  snapshot: async (key: string) => request(`/events/snapshot?k=${encodeURIComponent(key)}`, await loadSnapshotSchema()),
  tapTest: async (operatorKey: string, kind: string): Promise<TapTestReply> => {
    const res = await fetch(`${BASE}/ops/tap-test`, post({ kind }, { Authorization: `Bearer ${operatorKey}` }));
    const parsed = TapTestReply.safeParse(await res.json().catch(() => null));
    if (parsed.success && (res.ok || parsed.data.message)) return parsed.data;
    throw new AgentError(res.status, "POST /ops/tap-test failed");
  },
  ops: (action: OpsAction, operatorKey: string, body: { kind?: string } = {}) =>
    request(`/ops/${action}`, OpsResult, post(body, { Authorization: `Bearer ${operatorKey}` })),
};
