import { env } from "../env";

/** The venue's /ops/cybs-lookup body, passed through to the operator console unchanged (allowlisted fields only). */
export type CybsLookup = {
  order_id: string | null;
  fetched_at: string;
  source: { id: string; label: string };
  environment: string | null;
  rows: unknown[];
};

/** GET venue /ops/cybs-lookup?order=… with the venue ops key. Short timeout: the console polls this. Throws on any non-200. */
export async function fetchCybsLookup(orderId: string): Promise<CybsLookup> {
  const url = new URL("/ops/cybs-lookup", env.VENUE_BASE_URL!);
  url.searchParams.set("order", orderId);
  const res = await fetch(url, { headers: { authorization: `Bearer ${env.VENUE_OPS_KEY}` }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`venue cybs-lookup failed: HTTP ${res.status}`);
  return (await res.json()) as CybsLookup;
}
