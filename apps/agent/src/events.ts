// app.events is the SSE source of truth (PLAN §6, P8). emit() validates against the strict SseEvent union,
// inserts, and NOTIFYs in the same statement. Postgres delivers NOTIFY only on commit, so an event emitted
// inside a rolled-back transaction is never broadcast, and events emitted by other processes (seed:demo) reach the console.
import { EventEmitter } from "node:events";
import { Hono, type MiddlewareHandler } from "hono";
import { streamSSE } from "hono/streaming";
import { SseEvent } from "@tab/shared";
import { env } from "./env";
import { sql, type Db } from "./db";
import { hasKey } from "./auth";
import { errInfo, log } from "./log";

export type StoredEvent = { id: number; data: SseEvent };

const CHANNEL = "tab_events";
const PAGE = 500;
const HEARTBEAT_MS = 15_000; // under Fly's proxy idle timeout

/** The only way to write app.events. Pass `tx` to make the event part of the caller's transaction. Returns the event id. */
export async function emit(ev: SseEvent, tx?: Db): Promise<number> {
  const data = SseEvent.parse(ev);
  const planId = "plan_id" in data ? data.plan_id : null;
  const db = tx ?? sql;
  const [row] = await db<{ id: string }[]>`
    with ins as (
      insert into app.events (plan_id, type, data) values (${planId}, ${data.type}, ${db.json(data)}) returning id)
    select id::text as id, pg_notify(${CHANNEL}, id::text) from ins`;
  return Number(row!.id);
}

// ---------- in-process fan-out ----------
const bus = new EventEmitter().setMaxListeners(0);
const recent = new Set<number>(); // dedupe between NOTIFY delivery and the catch-up read after a LISTEN reconnect

function publish(e: StoredEvent): void {
  if (recent.has(e.id)) return;
  recent.add(e.id);
  if (recent.size > 2000) recent.delete(recent.values().next().value!);
  bus.emit("event", e);
}

export function subscribe(fn: (e: StoredEvent) => void): () => void {
  bus.on("event", fn);
  return () => void bus.off("event", fn);
}
export const subscriberCount = (): number => bus.listenerCount("event");

export async function fetchEventsAfter(afterId: number, limit = PAGE): Promise<StoredEvent[]> {
  const rows = await sql<{ id: string; data: SseEvent }[]>`
    select e.id::text as id, e.data from app.events e where e.id > ${afterId} order by e.id limit ${limit}`; // e.id: a bare `id` would sort the text alias
  return rows.map((r) => ({ id: Number(r.id), data: r.data }));
}

/** LISTENs for committed events and republishes them in-process. Returns a stop function. */
export async function startEventBroadcaster(): Promise<() => Promise<void>> {
  const [m] = await sql<{ max: string }[]>`select coalesce(max(id), 0)::text as max from app.events`;
  let highWater = Number(m!.max);
  let chain = Promise.resolve();
  const serial = (f: () => Promise<void>) => {
    chain = chain.then(f).catch((e) => log.error(errInfo(e), "events.broadcast"));
  };
  const take = (rows: StoredEvent[]) => {
    for (const r of rows) {
      highWater = Math.max(highWater, r.id);
      publish(r);
    }
  };
  const { unlisten } = await sql.listen(
    CHANNEL,
    (payload) =>
      serial(async () => {
        const rows = await sql<{ id: string; data: SseEvent }[]>`select id::text as id, data from app.events where id = ${Number(payload)}`;
        take(rows.map((r) => ({ id: Number(r.id), data: r.data })));
      }),
    // Runs on every (re)LISTEN: pick up anything committed while the listen connection was down.
    () => serial(async () => take(await fetchEventsAfter(highWater, 5000))),
  );
  return unlisten;
}

// ---------- SSE ----------
type PumpOptions = {
  lastId: number | null;
  write: (e: StoredEvent) => Promise<void>;
  fetchAfter: (afterId: number, limit: number) => Promise<StoredEvent[]>;
  subscribe: (fn: (e: StoredEvent) => void) => () => void;
  closed: Promise<void>;
  pageSize?: number;
};

/**
 * Replays events after `lastId` (Last-Event-ID), then streams live ones, each id at most once and in order.
 * Live events are buffered from before the replay query starts, so nothing committed in between is lost.
 * Caveat: bigserial ids can commit out of order, so a reconnect can skip an event whose id is below one already
 * sent. The console reducer tolerates this; a fresh snapshot repairs it.
 */
export async function pumpEvents(o: PumpOptions): Promise<void> {
  const size = o.pageSize ?? PAGE;
  let chain = Promise.resolve();
  const send = (e: StoredEvent) => {
    chain = chain.then(() => o.write(e)).catch(() => {}); // a failed write means the client left; `closed` resolves
  };
  const buffered: StoredEvent[] = [];
  let live = false;
  const unsubscribe = o.subscribe((e) => (live ? send(e) : buffered.push(e)));
  try {
    const sent = new Set<number>();
    if (o.lastId !== null) {
      for (let cursor = o.lastId; ; ) {
        const page = await o.fetchAfter(cursor, size);
        for (const e of page) {
          send(e);
          sent.add(e.id);
        }
        if (page.length < size) break;
        cursor = page[page.length - 1]!.id;
      }
    }
    for (const e of buffered) if (!sent.has(e.id)) send(e);
    buffered.length = 0;
    live = true;
    await o.closed;
  } finally {
    unsubscribe();
  }
}

export const parseLastId = (v: string | undefined): number | null => (v && /^\d{1,15}$/.test(v) ? Number(v) : null);

/** GET /events (SSE, `?k=CONSOLE_KEY`, Last-Event-ID or `?last_id=` replay) and GET /events/snapshot. */
export const eventsRoutes = new Hono();

const consoleOnly: MiddlewareHandler = async (c, next) => {
  if (!env.CONSOLE_KEY) return c.json({ error: "console_disabled" }, 503);
  if (!hasKey(c, env.CONSOLE_KEY, { query: true })) return c.json({ error: "unauthorized" }, 401);
  await next();
};

eventsRoutes.get("/events", consoleOnly, (c) => {
  const lastId = parseLastId(c.req.header("last-event-id") ?? c.req.query("last_id"));
  return streamSSE(c, async (stream) => {
    const closed = new Promise<void>((resolve) => stream.onAbort(resolve));
    const heartbeat = setInterval(() => void stream.write(": ping\n\n").catch(() => {}), HEARTBEAT_MS);
    try {
      await stream.write(": connected\n\n"); // flush headers so EventSource opens immediately
      // Unnamed frames (no `event:`) so the console's `onmessage` receives every type; `data` is one SseEvent.
      await pumpEvents({
        lastId,
        write: (e) => stream.writeSSE({ id: String(e.id), data: JSON.stringify(e.data) }),
        fetchAfter: fetchEventsAfter,
        subscribe,
        closed,
      });
    } finally {
      clearInterval(heartbeat);
    }
  });
});

/** Recent history for a console that just opened. Shape per B's proposal (C-6); A owns the final contract. */
eventsRoutes.get("/events/snapshot", consoleOnly, async (c) => {
  const rows = await sql<{ id: string; data: SseEvent }[]>`
    select t.id::text as id, t.data from (select id, data from app.events order by id desc limit ${PAGE}) t order by t.id`;
  const events = rows.map((r) => ({ id: Number(r.id), data: r.data }));
  return c.json({ last_id: events.length ? events[events.length - 1]!.id : 0, events });
});
