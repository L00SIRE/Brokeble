import { describe, expect, it } from "vitest";
import { createRateLimiter } from "./rateLimit";

describe("createRateLimiter", () => {
  it("allows `limit` calls per window, then blocks until the window rolls over", () => {
    const allow = createRateLimiter({ limit: 3, windowMs: 1000 });
    expect([1, 2, 3, 4].map(() => allow("ip", 0))).toEqual([true, true, true, false]);
    expect(allow("ip", 999)).toBe(false);
    expect(allow("ip", 1000)).toBe(true);
  });

  it("tracks keys independently", () => {
    const allow = createRateLimiter({ limit: 1, windowMs: 1000 });
    expect(allow("a", 0)).toBe(true);
    expect(allow("a", 1)).toBe(false);
    expect(allow("b", 1)).toBe(true);
  });
});
