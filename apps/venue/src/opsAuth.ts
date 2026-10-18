import { timingSafeEqual } from "node:crypto";
import { env } from "./env";

/** Bearer VENUE_OPS_KEY, constant time. Gates every venue /ops/* route (sweep, cybs-lookup). */
export function opsAuthorized(req: Request): boolean {
  const got = Buffer.from(req.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${env().VENUE_OPS_KEY}`);
  return got.length === want.length && timingSafeEqual(got, want);
}
