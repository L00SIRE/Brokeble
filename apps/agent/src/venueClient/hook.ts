// Verifies a venue → agent webhook. The HMAC covers the RAW body bytes: pass `await c.req.text()`, never re-serialized JSON.
import { createHmac, timingSafeEqual } from "node:crypto";
import { VenueEvent } from "@tab/shared";

export function verifyVenueHook(
  rawBody: string,
  headers: Headers,
  secret: string,
  now: () => number = () => Math.floor(Date.now() / 1000),
): VenueEvent | null {
  try {
    const ts = headers.get("x-tab-timestamp");
    const sig = headers.get("x-tab-signature");
    if (!ts || !sig || !/^\d+$/.test(ts) || !sig.startsWith("sha256=")) return null;
    if (Math.abs(now() - Number(ts)) > 300) return null;
    const want = createHmac("sha256", secret).update(`${ts}.${rawBody}`).digest();
    const got = Buffer.from(sig.slice(7), "hex");
    if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
    return VenueEvent.parse(JSON.parse(rawBody));
  } catch {
    return null;
  }
}
