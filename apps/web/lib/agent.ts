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

export const agent = {
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
