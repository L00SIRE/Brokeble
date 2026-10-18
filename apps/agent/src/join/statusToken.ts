// Signed status tokens for GET /status?t= (ux-flow §7.1). Format: base64url(JSON {u,p,r,iat}) "." base64url(HMAC-SHA256).
// The key is derived from PAYER_REF_SECRET with a domain label, so no new secret is needed and a status token can never
// double as a payer_ref (different input domain). A token is a bearer capability: never log it. Owner A.
import { createHmac, timingSafeEqual } from "node:crypto";
import * as z from "zod";
import { payerRefSecret } from "../repo/users";

export const STATUS_TOKEN_TTL_S = 7 * 24 * 60 * 60;
/** Clock skew tolerated for an iat in the future (one machine today, but cheap insurance). */
const MAX_FUTURE_SKEW_S = 60;

export type StatusRole = "organizer" | "guest";
export type StatusTokenClaims = { u: string; p: string | null; r: StatusRole; iat: number };

const Claims = z.strictObject({
  u: z.uuid(),
  p: z.uuid().nullable(),
  r: z.enum(["organizer", "guest"]),
  iat: z.number().int().nonnegative(),
});

let cachedKey: { root: string; key: Buffer } | null = null;
function signingKey(): Buffer {
  const root = payerRefSecret();
  if (cachedKey?.root !== root) cachedKey = { root, key: createHmac("sha256", root).update("status-token-v1").digest() };
  return cachedKey.key;
}

const sign = (payload: string): Buffer => createHmac("sha256", signingKey()).update(payload).digest();

/** Mints a token for user `u` (plan `p` or null, role `r`), issued now (seconds). */
export function issueStatusToken(c: { u: string; p: string | null; r: StatusRole }, nowMs = Date.now()): string {
  const claims: StatusTokenClaims = { u: c.u, p: c.p, r: c.r, iat: Math.floor(nowMs / 1000) };
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${payload}.${sign(payload).toString("base64url")}`;
}

/** The claims of a well-formed, correctly signed, unexpired token; null otherwise (never throws). */
export function verifyStatusToken(t: string | undefined | null, nowMs = Date.now()): StatusTokenClaims | null {
  if (typeof t !== "string" || t.length > 512) return null;
  const dot = t.indexOf(".");
  if (dot <= 0 || dot !== t.lastIndexOf(".")) return null;
  const payload = t.slice(0, dot);
  // Compare the canonical encodings, not decoded bytes: base64url decoding ignores stray characters and unused
  // trailing bits, so byte comparison would accept many spellings of one signature.
  const given = Buffer.from(t.slice(dot + 1));
  const expected = Buffer.from(sign(payload).toString("base64url"));
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;

  let claims: StatusTokenClaims;
  try {
    const parsed = Claims.safeParse(JSON.parse(Buffer.from(payload, "base64url").toString("utf8")));
    if (!parsed.success) return null;
    claims = parsed.data;
  } catch {
    return null;
  }
  const now = Math.floor(nowMs / 1000);
  if (claims.iat > now + MAX_FUTURE_SKEW_S || now - claims.iat > STATUS_TOKEN_TTL_S) return null;
  return claims;
}
