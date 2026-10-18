import { describe, expect, it, vi } from "vitest";
import { backoffMs, createPoller, DEFAULT_LEASE_MS, type DueJob, type JobHandler, type JobStore } from "../src/dueJobs";

const job = (id: number, kind: string, attempts = 1): DueJob => ({
  id, kind, attempts, plan_id: null, dedupe_key: `k${id}`, due_at: new Date(0), payload: {},
});

function fakeStore(queue: DueJob[]) {
  const calls = { claim: [] as { kinds: string[]; limit: number; leaseMs: number }[], complete: [] as number[], fail: [] as { id: number; error: string; retryAt: Date | null }[] };
  const store: JobStore = {
    async claim(kinds, limit, leaseMs) {
      calls.claim.push({ kinds, limit, leaseMs });
      const picked = queue.filter((j) => kinds.includes(j.kind)).slice(0, limit);
      for (const j of picked) queue.splice(queue.indexOf(j), 1);
      return picked;
    },
    async complete(id) {
      calls.complete.push(id);
    },
    async fail(id, error, retryAt) {
      calls.fail.push({ id, error, retryAt });
    },
  };
  return { store, calls };
}

const handlers = (entries: Record<string, JobHandler>, maxAttempts = 3) =>
  new Map(Object.entries(entries).map(([k, handler]) => [k, { handler, leaseMs: DEFAULT_LEASE_MS, maxAttempts }]));

describe("due_jobs poller", () => {
  it("runs the handler for each claimed job and completes it", async () => {
    const seen: number[] = [];
    const { store, calls } = fakeStore([job(1, "a"), job(2, "a")]);
    const p = createPoller({ store, handlers: handlers({ a: async (j) => void seen.push(j.id) }) });
    expect(await p.tick()).toBe(2);
    await p.drain();
    expect(seen.sort()).toEqual([1, 2]);
    expect(calls.complete.sort()).toEqual([1, 2]);
    expect(calls.fail).toEqual([]);
  });

  it("claims only registered kinds and never claims when nothing is registered", async () => {
    const { store, calls } = fakeStore([job(1, "unknown")]);
    expect(await createPoller({ store, handlers: new Map() }).tick()).toBe(0);
    expect(calls.claim).toEqual([]);
    const p = createPoller({ store, handlers: handlers({ a: async () => {} }) });
    expect(await p.tick()).toBe(0);
    expect(calls.claim[0]!.kinds).toEqual(["a"]);
  });

  it("schedules a retry with backoff when a handler throws", async () => {
    const { store, calls } = fakeStore([job(7, "a", 2)]);
    const p = createPoller({ store, handlers: handlers({ a: async () => Promise.reject(new Error("boom")) }), now: () => 1_000_000 });
    await p.tick();
    await p.drain();
    expect(calls.complete).toEqual([]);
    expect(calls.fail).toEqual([{ id: 7, error: "boom", retryAt: new Date(1_000_000 + backoffMs(2)) }]);
  });

  it("gives up after maxAttempts and reports the dead job", async () => {
    const onDead = vi.fn(async () => {});
    const { store, calls } = fakeStore([job(9, "a", 3)]);
    const p = createPoller({ store, handlers: handlers({ a: async () => Promise.reject(new Error("nope")) }, 3), onDead });
    await p.tick();
    await p.drain();
    expect(calls.fail).toEqual([{ id: 9, error: "nope", retryAt: null }]);
    expect(onDead).toHaveBeenCalledOnce();
  });

  it("caps concurrency: a slow job leaves only the free slots for the next claim", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { store, calls } = fakeStore([job(1, "slow"), job(2, "slow"), job(3, "slow")]);
    const p = createPoller({ store, handlers: handlers({ slow: () => gate }), maxConcurrent: 2 });
    expect(await p.tick()).toBe(2);
    expect(await p.tick()).toBe(0); // no free slot → no claim at all
    expect(calls.claim).toHaveLength(1);
    release();
    await p.drain();
    expect(await p.tick()).toBe(1);
    await p.drain();
    expect(calls.complete.sort()).toEqual([1, 2, 3]);
  });

  it("backoff doubles from 2 s and caps at 5 min", () => {
    expect([1, 2, 3].map(backoffMs)).toEqual([2_000, 4_000, 8_000]);
    expect(backoffMs(20)).toBe(300_000);
  });

  it("start/stop loops on the interval and stop waits for in-flight jobs", async () => {
    const done: number[] = [];
    const { store } = fakeStore([job(1, "a")]);
    const p = createPoller({ store, handlers: handlers({ a: async (j) => void done.push(j.id) }), intervalMs: 5 });
    p.start();
    await vi.waitFor(() => expect(done).toEqual([1]));
    await p.stop();
    expect(p.inflight()).toBe(0);
  });
});
