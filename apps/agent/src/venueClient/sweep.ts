import { env } from "../env";

export type SweepResult = {
  ok: boolean;
  timeout_reversed: number;
  expired_cancelled: number;
  outbox_delivered: number;
  nonces_purged: number;
  needs_attention?: number;
  failed?: string[];
  codes?: Record<string, string>;
};

/**
 * Step names from a venue sweep error body (`{failed: [...], codes: {step: code}}`), each as `step` or `step=CODE`.
 * Anything that is not a plain step name or error-code token is dropped, so no data reaches the log.
 */
export function failedSteps(body: unknown): string[] {
  const b = body as { failed?: unknown; codes?: unknown } | null;
  const f = b?.failed;
  if (!Array.isArray(f)) return [];
  const codes = b?.codes && typeof b.codes === "object" ? (b.codes as Record<string, unknown>) : {};
  return f
    .filter((s): s is string => typeof s === "string" && /^[a-z0-9_]{1,40}$/.test(s))
    .map((s) => {
      const c = Object.hasOwn(codes, s) ? codes[s] : undefined;
      return typeof c === "string" && /^[A-Za-z0-9_]{1,40}$/.test(c) ? `${s}=${c}` : s;
    });
}

/** A schedules this as a due_job every 30 s. A 500 names the venue steps that failed and their error codes (no data). */
export async function callVenueSweep(): Promise<SweepResult> {
  const res = await fetch(new URL("/ops/sweep", env.VENUE_BASE_URL!), {
    method: "POST",
    headers: { authorization: `Bearer ${env.VENUE_OPS_KEY}` },
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) {
    const failed = failedSteps(await res.json().catch(() => null));
    throw new Error(`venue sweep failed: HTTP ${res.status}${failed.length ? ` (steps: ${failed.join(", ")})` : ""}`);
  }
  return (await res.json()) as SweepResult;
}
