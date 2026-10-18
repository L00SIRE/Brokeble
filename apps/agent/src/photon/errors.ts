// Photon problem codes (verified in the beta OpenAPI and @photon-ai/api@0.5.0 generated types; A plan T1 error map).
// Match on `code` only: the docs say title/detail change without notice. Owner A.
import { ApiError, ResponseValidationError } from "@photon-ai/api";

/** What the caller does with a Photon problem. */
export type ProblemAction =
  | "blocked_inbound" // SHARED_LINE_INBOUND_REQUIRED 403: never retry; user must text first
  | "not_assigned" // SHARED_LINE_NOT_ASSIGNED 403: seat released; system:error, user re-joins
  | "capacity" // SHARED_LINE_CAP_EXCEEDED 409 / SHARED_LINE_POOL_EXHAUSTED 503: join → 503 {error:"capacity"}
  | "assignment_exists" // ASSIGNMENT_EXISTS 409: join adopts the existing seat via assignments.list
  | "bug" // IDEMPOTENCY_KEY_REUSED, UNSUPPORTED_CONTENT, MESSAGE_TOO_LONG, INVALID_CONTENT 422: log error, never resend with a new key
  | "stale_route" // SPACE_NOT_SENDABLE, SENDER_NOT_SENDABLE 409: log warn + console warn; the dm_route is kept
  | "rate_limited" // RATE_LIMITED 429: SDK retried Retry-After ≤ 5 s; notify retries once more with the same key
  | "transient"; // transport errors, 5xx, anything unknown

const ACTIONS: Readonly<Record<string, ProblemAction>> = {
  SHARED_LINE_INBOUND_REQUIRED: "blocked_inbound",
  SHARED_LINE_NOT_ASSIGNED: "not_assigned",
  SHARED_LINE_CAP_EXCEEDED: "capacity",
  SHARED_LINE_POOL_EXHAUSTED: "capacity",
  ASSIGNMENT_EXISTS: "assignment_exists",
  // Request-shape problems: resending (with any key) fails the same way, so they surface as bugs.
  IDEMPOTENCY_KEY_REUSED: "bug",
  IDEMPOTENCY_KEY_INVALID: "bug",
  IDEMPOTENCY_KEY_REQUIRED: "bug",
  UNSUPPORTED_CONTENT: "bug",
  MESSAGE_TOO_LONG: "bug",
  INVALID_CONTENT: "bug",
  VALIDATION_FAILED: "bug",
  SHARED_LINE_GROUP_UNSUPPORTED: "bug", // shared lines send only in direct Spaces; we never address a group
  SPACE_NOT_SENDABLE: "stale_route",
  SENDER_NOT_SENDABLE: "stale_route",
  SPACE_NOT_FOUND: "stale_route",
  SENDER_NOT_FOUND: "stale_route",
  RATE_LIMITED: "rate_limited",
  HTTP_429: "rate_limited",
  // IDEMPOTENCY_REQUEST_IN_PROGRESS (409) and IDEMPOTENCY_UNAVAILABLE (503): a later retry with the same key is safe.
};

/**
 * `ApiError.body.code`, else `HTTP_<status>` for an ApiError without a code, `RESPONSE_INVALID` for a 2xx the SDK could
 * not decode, else "TRANSPORT". Safe to log (never contains text, URLs or ids).
 */
export function problemCode(e: unknown): string {
  if (e instanceof ApiError) {
    const code = typeof e.body === "object" && e.body !== null ? (e.body as { code?: unknown }).code : undefined;
    return typeof code === "string" && /^[A-Z0-9_]{1,64}$/.test(code) ? code : `HTTP_${e.status}`;
  }
  if (e instanceof ResponseValidationError) return "RESPONSE_INVALID";
  return "TRANSPORT";
}

/** Maps a problemCode() value to its action (table above). Unknown codes are transient. */
export function problemAction(code: string): ProblemAction {
  return ACTIONS[code] ?? "transient";
}

/**
 * The server-requested delay of a 429/503 ApiError in ms (Retry-After seconds or HTTP date), else null. The SDK
 * already waited out any Retry-After ≤ 5 s for keyed requests (client.ts), so a non-null value here means "back off
 * this long" (notify caps its single retry wait at 5 s).
 */
export function retryAfterMs(e: unknown, now = Date.now()): number | null {
  if (!(e instanceof ApiError)) return null;
  const raw = e.headers.get("retry-after")?.trim();
  if (!raw) return null;
  if (/^\d+$/.test(raw)) return Number(raw) * 1000;
  const at = Date.parse(raw);
  return Number.isNaN(at) ? null : Math.max(0, at - now);
}
