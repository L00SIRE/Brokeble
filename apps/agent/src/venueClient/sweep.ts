import { env } from "../env";

export type SweepResult = { ok: boolean; timeout_reversed: number; expired_cancelled: number; outbox_delivered: number; nonces_purged: number };

/** A schedules this as a due_job every 30 s. */
export async function callVenueSweep(): Promise<SweepResult> {
  const res = await fetch(new URL("/ops/sweep", env.VENUE_BASE_URL!), {
    method: "POST",
    headers: { authorization: `Bearer ${env.VENUE_OPS_KEY}` },
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new Error(`venue sweep failed: HTTP ${res.status}`);
  return (await res.json()) as SweepResult;
}
