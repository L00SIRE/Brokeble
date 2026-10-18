// In-memory per-user awaiting flags (router step 6). Lost on restart: the user just re-sends. Owner A.
// For 'holdgate' the pending app.hold_gates row is the source of truth; the flag is only a fast path.
export type AwaitingFlag = "holdgate" | "tiers" | "budget";

const flags = new Map<string, AwaitingFlag>();

/** The user's current flag, or null. */
export function getAwaiting(userId: string): AwaitingFlag | null {
  return flags.get(userId) ?? null;
}

/** Sets (replaces) the user's flag. */
export function setAwaiting(userId: string, flag: AwaitingFlag): void {
  flags.set(userId, flag);
}

/** Clears the user's flag (no-op if none). */
export function clearAwaiting(userId: string): void {
  flags.delete(userId);
}
