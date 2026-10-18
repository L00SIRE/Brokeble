// In-memory fixed-window rate limiter (one Fly machine, so process memory is the whole truth). Owner A.

/** Returns allow(key, now?) → true while `key` has made ≤ `limit` calls in the current `windowMs` window. */
export function createRateLimiter(o: { limit: number; windowMs: number }): (key: string, now?: number) => boolean {
  const hits = new Map<string, { start: number; n: number }>();
  return (key, now = Date.now()) => {
    // Bounded memory: a spray of distinct IPs cannot grow the map past one sweep's worth of live windows.
    if (hits.size >= 10_000) for (const [k, h] of hits) if (now - h.start >= o.windowMs) hits.delete(k);
    const h = hits.get(key);
    if (!h || now - h.start >= o.windowMs) {
      hits.set(key, { start: now, n: 1 });
      return true;
    }
    return ++h.n <= o.limit;
  };
}
