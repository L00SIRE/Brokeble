// Runs only with TEST_DATABASE_URL (throwaway Postgres with db/migrations applied): the real transition SQL.
import { randomInt } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { sql } from "../src/db";
import { transition } from "../src/plan/machine";

describe.skipIf(!process.env.TEST_DATABASE_URL)("plan.transition (postgres)", () => {
  const ids: string[] = [];
  const newPlan = async (state = "VOTING") => {
    const code = String(randomInt(0, 10_000)).padStart(4, "0");
    const [r] = await sql<{ id: string }[]>`
      insert into app.plans (code, state, title, area, event_date, time_start, time_end, party_target)
      values (${code}, ${state}, 't', 'a', '2026-10-17', '18:30', '23:00', 3)
      on conflict (code) do nothing returning id::text as id`;
    if (!r) return newPlan(state);
    ids.push(r.id);
    return r.id;
  };
  afterAll(async () => {
    await sql`delete from app.events where plan_id = any(${sql.array(ids)}::uuid[])`;
    await sql`delete from app.plans where id = any(${sql.array(ids)}::uuid[])`;
    await sql.end({ timeout: 5 });
  });

  it("exactly one of two concurrent transitions wins, and only it emits plan.state", async () => {
    const id = await newPlan("VOTING");
    const results = await Promise.all([1, 2].map(() => transition(id, ["RESEARCHING", "VOTING"], "ORDERING", { version: 1 })));
    expect(results.filter(Boolean)).toEqual([{ id, version: 1, from_state: "VOTING" }]);
    const evs = await sql<{ data: unknown }[]>`select data from app.events where plan_id = ${id}`;
    expect(evs.map((e) => e.data)).toEqual([{ type: "plan.state", plan_id: id, from: "VOTING", to: "ORDERING", version: 1 }]);
  });

  it("version guard and bumpVersion; inTx failure rolls back the state change and the event", async () => {
    const id = await newPlan("VOTING");
    expect(await transition(id, "VOTING", "VOTING", { version: 7, bumpVersion: true })).toBeNull();
    expect(await transition(id, "VOTING", "VOTING", { version: 1, bumpVersion: true })).toEqual({ id, version: 2, from_state: "VOTING" });
    await expect(transition(id, "VOTING", "CANCELLED", { inTx: async () => { throw new Error("boom"); } })).rejects.toThrow("boom");
    const [p] = await sql<{ state: string; version: number }[]>`select state, version from app.plans where id = ${id}`;
    expect(p).toEqual({ state: "VOTING", version: 2 });
    const [n] = await sql<{ n: number }[]>`select count(*)::int as n from app.events where plan_id = ${id}`;
    expect(n!.n).toBe(1);
  });
});
