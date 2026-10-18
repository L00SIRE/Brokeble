// Fetch wrappers for the browser-side calls: POST /start, /join, /plans and GET /status. Unlike agent.ts's `request`,
// they keep the status and the JoinError body, which the flow needs to pick the right state. Never logs bodies (they
// carry phone numbers and status tokens).
import type { z } from "zod";
import {
  type CreatePlanRequest,
  CreatePlanResponse,
  JoinError,
  type JoinRequest,
  JoinResponse,
  type StartRequest,
  StartResponse,
  StatusResponse,
} from "./agentSchemas";

const BASE = process.env.NEXT_PUBLIC_AGENT_URL ?? "";
/** Assignment create latency is undocumented; the agent allows 10 s × 2 attempts (ux-flow §12). */
const TIMEOUT_MS = 15_000;
const STATUS_TIMEOUT_MS = 8_000;

export type RejectedError = JoinError["error"] | "unknown";
export type Rejected = { kind: "rejected"; status: number; error: RejectedError; issues: { path: string; message: string }[] };
export type Outcome<T> = { kind: "ok"; data: T } | Rejected | { kind: "network" };

export async function postJson<T>(path: string, body: unknown, schema: z.ZodType<T>, fetchImpl: typeof fetch = fetch): Promise<Outcome<T>> {
  let res: Response;
  try {
    res = await fetchImpl(`${BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      credentials: "omit",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return { kind: "network" };
  }
  const json: unknown = await res.json().catch(() => undefined);
  if (res.ok) {
    const parsed = schema.safeParse(json);
    return parsed.success ? { kind: "ok", data: parsed.data } : { kind: "rejected", status: res.status, error: "unknown", issues: [] };
  }
  const err = JoinError.safeParse(json);
  return { kind: "rejected", status: res.status, error: err.success ? err.data.error : "unknown", issues: err.success ? (err.data.issues ?? []) : [] };
}

export const startOrganizer = (body: StartRequest, f?: typeof fetch) => postJson("/start", body, StartResponse, f);
export const joinPlan = (body: JoinRequest, f?: typeof fetch) => postJson("/join", body, JoinResponse, f);
export const createPlan = (body: CreatePlanRequest, f?: typeof fetch) => postJson("/plans", body, CreatePlanResponse, f);

/** GET /status outcome. `expired` (401) is terminal: the token is invalid or past its 7-day TTL. */
export type StatusOutcome = { kind: "ok"; data: StatusResponse } | { kind: "expired" } | { kind: "rate_limited" } | { kind: "failed" };

export async function fetchStatus(token: string, opts: { signal?: AbortSignal; fetchImpl?: typeof fetch } = {}): Promise<StatusOutcome> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const timeout = AbortSignal.timeout(STATUS_TIMEOUT_MS);
  const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;
  let res: Response;
  try {
    res = await fetchImpl(`${BASE}/status?t=${encodeURIComponent(token)}`, { credentials: "omit", cache: "no-store", signal });
  } catch {
    return { kind: "failed" };
  }
  if (res.status === 401) return { kind: "expired" };
  if (res.status === 429) return { kind: "rate_limited" };
  if (!res.ok) return { kind: "failed" };
  const parsed = StatusResponse.safeParse(await res.json().catch(() => undefined));
  return parsed.success ? { kind: "ok", data: parsed.data } : { kind: "failed" };
}
