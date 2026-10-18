// Runs only with TEST_DATABASE_URL (a throwaway Postgres with db/migrations/001+002 applied; never prod data).
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "../src/db";
import { enqueue, pgJobStore } from "../src/dueJobs";
import { emit, eventsRoutes, fetchEventsAfter, startEventBroadcaster, subscribe, type StoredEvent } from "../src/events";

const run = randomUUID().slice(0, 8);
const kind = `test.${run}`;

describe.skipIf(!process.env.TEST_DATABASE_URL)("postgres integration", () => {
  let stopBroadcaster: () => Promise<void>;
  beforeAll(async () => {
    stopBroadcaster = await startEventBroadcaster();
  });
  afterAll(async () => {
    await sql`delete from app.due_jobs where kind = ${kind}`;
    await sql`delete from app.events where data->>'msg' like ${`%${run}%`}`;
    await stopBroadcaster();
    await sql.end({ timeout: 5 });
  });

  it("enqueue is insert-or-ignore on (kind, dedupe_key)", async () => {
    expect(await enqueue(kind, "dup", new Date())).toBe(true);
    expect(await enqueue(kind, "dup", new Date())).toBe(false);
  });

  it("claim leases each ready job to exactly one caller, even concurrently", async () => {
    for (let i = 0; i < 6; i++) await enqueue(kind, `c${i}`, new Date(Date.now() - 1000), { i });
    await enqueue(kind, "future", new Date(Date.now() + 3_600_000));
    const [a, b] = await Promise.all([pgJobStore.claim([kind], 4, 60_000), pgJobStore.claim([kind], 4, 60_000)]);
    const ids = [...a, ...b].map((j) => j.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBe(7); // 6 + "dup"; "future" is not due
    expect([...a, ...b].every((j) => j.attempts === 1)).toBe(true);
    expect(await pgJobStore.claim([kind], 10, 60_000)).toEqual([]); // leased

    await pgJobStore.complete(ids[0]!);
    await pgJobStore.fail(ids[1]!, "boom", new Date(Date.now() - 1)); // retry immediately
    await pgJobStore.fail(ids[2]!, "dead", null);
    const again = await pgJobStore.claim([kind], 10, 60_000);
    expect(again.map((j) => j.id)).toEqual([ids[1]]);
    expect(again[0]!.attempts).toBe(2);
    const [dead] = await sql<{ done_at: Date | null; last_error: string }[]>`select done_at, last_error from app.due_jobs where id = ${ids[2]!}`;
    expect(dead!.done_at).not.toBeNull();
    expect(dead!.last_error).toBe("dead");
  });

  it("replay pages are in numeric id order (regression: text alias sorted '10' before '9')", async () => {
    for (let i = 0; i < 11; i++) await emit({ type: "system", level: "info", msg: `order ${run} ${i}` });
    const ids = (await fetchEventsAfter(0, 100_000)).map((e) => e.id);
    expect(ids.length).toBeGreaterThanOrEqual(11);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
  });

  it("GET /events/snapshot returns { last_id, events: { id, data }[] }: the last 500, oldest first", async () => {
    for (let i = 0; i < 3; i++) await emit({ type: "system", level: "info", msg: `snap ${run} ${i}` });
    const res = await eventsRoutes.request(`/events/snapshot?k=${process.env.CONSOLE_KEY}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { last_id: number; events: StoredEvent[] };
    const ids = body.events.map((e) => e.id);
    expect(body.events.length).toBeLessThanOrEqual(500);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
    expect(body.last_id).toBe(ids.at(-1));
    // Other DB-gated files may emit concurrently into the same database, so match this run's rows only.
    const mine = body.events.filter((e) => e.data.type === "system" && e.data.msg.startsWith(`snap ${run} `));
    expect(mine.map((e) => e.data)).toEqual([0, 1, 2].map((i) => ({ type: "system", level: "info", msg: `snap ${run} ${i}` })));
    expect(Object.keys(body.events[0]!).sort()).toEqual(["data", "id"]);
  });

  it("emit broadcasts committed events and never rolled-back ones", async () => {
    const got: StoredEvent[] = [];
    const unsubscribe = subscribe((e) => got.push(e));
    await sql
      .begin(async (tx) => {
        await emit({ type: "system", level: "info", msg: `rolled back ${run}` }, tx);
        throw new Error("rollback");
      })
      .catch(() => {});
    const id = await emit({ type: "system", level: "info", msg: `committed ${run}` });
    // Only this test's two messages: the previous test's "snap <run> n" NOTIFYs can still be arriving.
    const mineNow = () => got.filter((e) => e.data.type === "system" && (e.data.msg === `rolled back ${run}` || e.data.msg === `committed ${run}`));
    // NOTIFY delivery can lag under a parallel suite: wait for the committed event, then a short grace for strays.
    for (let t = 0; t < 50 && mineNow().length === 0; t++) await new Promise((r) => setTimeout(r, 100));
    await new Promise((r) => setTimeout(r, 300));
    unsubscribe();
    const mine = mineNow();
    expect(mine.map((e) => e.id)).toEqual([id]);
    expect((await fetchEventsAfter(id - 1, 1))[0]).toEqual({ id, data: { type: "system", level: "info", msg: `committed ${run}` } });
  });
});
