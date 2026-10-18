// app.due_jobs poller (PLAN §6). Owners register handlers by kind; jobs are claimed with FOR UPDATE SKIP LOCKED
// and a lease, run concurrently, and retried with backoff. Exactly-once *effects* are the handlers' job:
// a unique (kind, dedupe_key) stops duplicate enqueues, and state-guarded UPDATEs stop duplicate actions (M5).
import type postgres from "postgres";
import { sql, type Db } from "./db";
import { emit } from "./events";
import { errInfo, log } from "./log";

export type DueJob = {
  id: number;
  plan_id: string | null;
  kind: string;
  dedupe_key: string;
  due_at: Date;
  payload: Record<string, unknown>;
  attempts: number; // includes the current attempt
};
export type JobHandler = (job: DueJob) => Promise<void>;
type Registered = { handler: JobHandler; leaseMs: number; maxAttempts: number };

export const DEFAULT_LEASE_MS = 120_000; // > the slowest handler (venue commit/cancel use a 90 s timeout)
export const DEFAULT_MAX_ATTEMPTS = 6;
const registry = new Map<string, Registered>();

/** Register the handler for a job kind (once per kind, at boot). Only registered kinds are ever claimed. */
export function registerJob(kind: string, handler: JobHandler, opts: { leaseMs?: number; maxAttempts?: number } = {}): void {
  if (registry.has(kind)) throw new Error(`due_jobs kind already registered: ${kind}`);
  registry.set(kind, { handler, leaseMs: opts.leaseMs ?? DEFAULT_LEASE_MS, maxAttempts: opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS });
}

/** Insert-or-ignore on (kind, dedupe_key). Returns true if this call created the job. */
export async function enqueue(
  kind: string,
  dedupeKey: string,
  dueAt: Date,
  payload: Record<string, unknown> = {},
  opts: { planId?: string | null; tx?: Db } = {},
): Promise<boolean> {
  const db = opts.tx ?? sql;
  const rows = await db`
    insert into app.due_jobs (plan_id, kind, dedupe_key, due_at, payload)
    values (${opts.planId ?? null}, ${kind}, ${dedupeKey}, ${dueAt}, ${db.json(payload as postgres.JSONValue)})
    on conflict (kind, dedupe_key) do nothing returning id`;
  return rows.length > 0;
}

// ---------- store (SQL), injectable for tests ----------
export interface JobStore {
  /** Atomically lease up to `limit` ready jobs of the given kinds; bumps attempts. */
  claim(kinds: string[], limit: number, leaseMs: number): Promise<DueJob[]>;
  complete(id: number): Promise<void>;
  /** `retryAt` null = give up (done_at set, last_error kept for the console/ops). */
  fail(id: number, error: string, retryAt: Date | null): Promise<void>;
}

export const pgJobStore: JobStore = {
  async claim(kinds, limit, leaseMs) {
    if (kinds.length === 0 || limit <= 0) return [];
    // One statement: the CTE's row locks hold until the UPDATE commits, so concurrent pollers never share a job.
    const rows = await sql<(Omit<DueJob, "id"> & { id: string })[]>`
      with ready as (
        select id from app.due_jobs
        where done_at is null and due_at <= now() and (locked_until is null or locked_until < now())
          and kind = any(${sql.array(kinds)})
        order by due_at limit ${limit}
        for update skip locked)
      update app.due_jobs j
        set locked_until = now() + make_interval(secs => ${leaseMs / 1000}), attempts = j.attempts + 1
      from ready where j.id = ready.id
      returning j.id::text as id, j.plan_id, j.kind, j.dedupe_key, j.due_at, j.payload, j.attempts`;
    return rows.map((r) => ({ ...r, id: Number(r.id) }));
  },
  async complete(id) {
    await sql`update app.due_jobs set done_at = now(), locked_until = null, last_error = null where id = ${id}`;
  },
  async fail(id, error, retryAt) {
    await sql`
      update app.due_jobs
      set last_error = ${error.slice(0, 500)}, locked_until = ${retryAt}, done_at = ${retryAt ? null : sql`now()`}
      where id = ${id}`;
  },
};

/** 2 s, 4 s, 8 s … capped at 5 min. */
export const backoffMs = (attempts: number): number => Math.min(2_000 * 2 ** (attempts - 1), 300_000);

export type PollerOptions = {
  store?: JobStore;
  handlers?: ReadonlyMap<string, Registered>;
  intervalMs?: number;
  maxConcurrent?: number;
  onDead?: (job: DueJob, error: string) => Promise<void>;
  now?: () => number;
};

export function createPoller(o: PollerOptions = {}) {
  const store = o.store ?? pgJobStore;
  const handlers = o.handlers ?? registry;
  const intervalMs = o.intervalMs ?? 2_000;
  const maxConcurrent = o.maxConcurrent ?? 10;
  const now = o.now ?? Date.now;
  const onDead = o.onDead ?? ((job) => emit({ type: "system", level: "error", msg: `job ${job.kind} failed permanently` }).then(() => {}));
  const inflight = new Set<Promise<void>>();
  let timer: NodeJS.Timeout | undefined;
  let stopped = true;

  async function run(job: DueJob): Promise<void> {
    const reg = handlers.get(job.kind);
    try {
      if (!reg) throw new Error(`no handler for kind ${job.kind}`);
      await reg.handler(job);
      await store.complete(job.id);
    } catch (e) {
      const { err } = errInfo(e);
      const dead = job.attempts >= (reg?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);
      log.warn({ job_id: job.id, kind: job.kind, attempts: job.attempts, dead, err }, "due_job failed");
      try {
        await store.fail(job.id, err, dead ? null : new Date(now() + backoffMs(job.attempts)));
        if (dead) await onDead(job, err);
      } catch (e2) {
        log.error({ job_id: job.id, ...errInfo(e2) }, "due_job fail bookkeeping"); // lease expiry retries it
      }
    }
  }

  /** One claim round. Resolves once the claimed jobs are *started*; use drain() to await them. */
  async function tick(): Promise<number> {
    const free = maxConcurrent - inflight.size;
    const kinds = [...handlers.keys()];
    if (free <= 0 || kinds.length === 0) return 0;
    const lease = Math.max(...kinds.map((k) => handlers.get(k)!.leaseMs));
    const jobs = await store.claim(kinds, free, lease);
    for (const job of jobs) {
      const p = run(job).finally(() => inflight.delete(p));
      inflight.add(p);
    }
    return jobs.length;
  }

  const loop = async () => {
    try {
      await tick();
    } catch (e) {
      log.error(errInfo(e), "due_jobs claim");
    }
    if (!stopped) timer = setTimeout(loop, intervalMs);
  };

  return {
    tick,
    drain: async () => {
      while (inflight.size) await Promise.allSettled([...inflight]);
    },
    inflight: () => inflight.size,
    start() {
      if (!stopped) return;
      stopped = false;
      void loop();
    },
    async stop() {
      stopped = true;
      clearTimeout(timer);
      while (inflight.size) await Promise.allSettled([...inflight]);
    },
  };
}
export type Poller = ReturnType<typeof createPoller>;
