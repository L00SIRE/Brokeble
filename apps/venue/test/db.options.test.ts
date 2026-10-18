// The venue runs on Vercel (serverless) behind Supabase's transaction pooler: no prepared statements, one connection per
// instance, and idle connections must close so a frozen or recycled instance never pins a pooler client slot.
import { describe, expect, it, vi } from "vitest";

const postgres = vi.hoisted(() => vi.fn((_url: string, _opts: Record<string, unknown>) => ({})));
vi.mock("postgres", () => ({ default: postgres }));
vi.mock("../src/env", () => ({ env: () => ({ DATABASE_URL: "postgres://u:p@localhost:6543/db" }) }));

describe("venue db client", () => {
  it("is created once with serverless-safe options", async () => {
    const { sql } = await import("../src/db");
    expect(sql()).toBe(sql());
    expect(postgres).toHaveBeenCalledOnce();
    expect(postgres.mock.calls[0]![1]).toEqual({ prepare: false, max: 1, idle_timeout: 20, connect_timeout: 10 });
  });
});
