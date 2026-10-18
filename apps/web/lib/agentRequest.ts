// Fetch wrapper for POST /join and POST /plans. Unlike agent.ts's `request`, it keeps the status and the JoinError body,
// which the forms need to pick the right state. Never logs bodies (they can hold a private budget).
import type { z } from "zod";
import { type CreatePlanRequest, CreatePlanResponse, JoinError, type JoinRequest, JoinResponse } from "./agent";

const BASE = process.env.NEXT_PUBLIC_AGENT_URL ?? "";
const TIMEOUT_MS = 15_000;

export type Rejected = { kind: "rejected"; status: number; error: JoinError["error"] | "unknown"; issues: { path: string; message: string }[] };
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

export const joinPlan = (body: JoinRequest, f?: typeof fetch) => postJson("/join", body, JoinResponse, f);
export const createPlan = (body: CreatePlanRequest, f?: typeof fetch) => postJson("/plans", body, CreatePlanResponse, f);
