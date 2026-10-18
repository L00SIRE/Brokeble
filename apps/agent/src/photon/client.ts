// @photon-ai/api@0.5.0 client (PLAN §10, A plan T1). Lazy so mock mode never needs PHOTON_* set. Owner A.
import { Photon } from "@photon-ai/api";
import { env } from "../env";

let client: Photon | undefined;

/**
 * The process-wide SDK client, created on first call. timeoutMs is per attempt and retries apply only to GET and keyed
 * requests, so maxAttempts 2 bounds a keyed send at ~20 s (the consumer's 45 s handler budget assumes this). The SDK
 * would otherwise wait out any Retry-After up to 60 s (its default maximumRetryAfterMs); capping it at 5 s keeps that
 * bound, and a longer Retry-After comes back as the 429 itself (notify retries it once, briefly, with the same key).
 * Throws if PHOTON_API_KEY is unset.
 */
export function photonClient(): Photon {
  if (client) return client;
  const key = env.PHOTON_API_KEY;
  if (!key) throw new Error("PHOTON_API_KEY is not set (required when MESSAGING_MODE=photon)");
  client = new Photon({ headers: { Authorization: `Bearer ${key}` }, timeoutMs: 10_000, retry: { maxAttempts: 2, maximumRetryAfterMs: 5_000 } });
  return client;
}

/** PHOTON_PROJECT_ID (pho_prj_…); throws if unset. */
export function projectId(): string {
  const id = env.PHOTON_PROJECT_ID;
  if (!id) throw new Error("PHOTON_PROJECT_ID is not set (required when MESSAGING_MODE=photon)");
  return id;
}
