// Live-status logic (ux-flow §4.3). Pure: the poll reducer, the phase shown to the person and the polling cadence.
// The hook in useStatus.ts wires these to timers and the network.
import type { StatusResponse } from "./agentSchemas";

/** The server phase, plus `waiting_long`: still no text 45 s after the token was issued. */
export type ViewPhase = "waiting" | "waiting_long" | "texted" | "plan_ready" | "joined" | "closed";

export const LONG_WAIT_MS = 45_000;
export const FAST_POLL_MS = 2_000;
export const SLOW_POLL_MS = 10_000;
export const SLOW_AFTER_MS = 2 * 60_000;
/** Stop after 15 min: narrows the residual risk of a token minted for someone else's number (ux-flow §7.2). */
export const STOP_AFTER_MS = 15 * 60_000;
const MAX_BACKOFF_MS = 30_000;

export function viewPhase(s: StatusResponse | null, sinceIssuedMs: number): ViewPhase {
  if (!s || s.phase === "waiting") return sinceIssuedMs >= LONG_WAIT_MS ? "waiting_long" : "waiting";
  // Never claim a plan the response didn't carry (the gate keeps `plan` null until the owner texts).
  if (s.phase === "plan_ready" && !s.plan) return "texted";
  return s.phase;
}

export type PollState = {
  data: StatusResponse | null;
  /** 401: invalid or expired token. Terminal; the caller clears the session and returns to the phone step. */
  expired: boolean;
  /** Consecutive failed polls (network, 5xx, malformed); drives the backoff. */
  failures: number;
  rateLimited: boolean;
};

export type PollEvent = { type: "ok"; data: StatusResponse } | { type: "expired" } | { type: "rate_limited" } | { type: "failed" } | { type: "reset" };

export const initialPoll: PollState = { data: null, expired: false, failures: 0, rateLimited: false };

export function pollReducer(state: PollState, e: PollEvent): PollState {
  switch (e.type) {
    case "ok":
      return { data: e.data, expired: false, failures: 0, rateLimited: false };
    case "expired":
      return { ...state, expired: true };
    case "rate_limited":
      return { ...state, rateLimited: true };
    case "failed":
      // Keep the last good data: a dropped poll must never flip the page back to "waiting".
      return { ...state, failures: state.failures + 1 };
    case "reset":
      return initialPoll;
  }
}

/**
 * Milliseconds until the next poll, or null to stop. Every 2 s while visible, every 10 s after 2 minutes, never while
 * the tab is hidden (a visibilitychange back to visible polls at once), and nothing after 15 minutes, a 401 or a closed
 * plan. Failures back off exponentially, capped at 30 s.
 */
export function nextPollDelay(state: PollState, elapsedMs: number, visible: boolean): number | null {
  if (state.expired || state.data?.phase === "closed") return null;
  if (elapsedMs >= STOP_AFTER_MS || !visible) return null;
  let delay = elapsedMs >= SLOW_AFTER_MS ? SLOW_POLL_MS : FAST_POLL_MS;
  if (state.rateLimited) delay = Math.max(delay, SLOW_POLL_MS);
  if (state.failures > 0) delay = Math.min(MAX_BACKOFF_MS, delay * 2 ** Math.min(state.failures, 4));
  return delay;
}
