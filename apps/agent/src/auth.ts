import { createHash, timingSafeEqual } from "node:crypto";
import type { Context } from "hono";

/** Constant-time string compare. Hashing first gives equal-length buffers, so length is not leaked either. */
export function safeEqual(a: string, b: string): boolean {
  const h = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(h(a), h(b));
}

/** The Bearer token from the Authorization header, or null. */
export function bearer(c: Context): string | null {
  const m = /^Bearer\s+(.+)$/i.exec(c.req.header("authorization") ?? "");
  return m?.[1]?.trim() ?? null;
}

/** True when `expected` is configured and the request carries it as a Bearer token (or `?k=` when allowed). */
export function hasKey(c: Context, expected: string | undefined, opts: { query?: boolean } = {}): boolean {
  if (!expected) return false;
  const given = bearer(c) ?? (opts.query ? c.req.query("k") ?? null : null);
  return given !== null && safeEqual(given, expected);
}
