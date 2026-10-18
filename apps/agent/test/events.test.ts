import { describe, expect, it } from "vitest";
import type { SseEvent } from "@tab/shared";
import { emit, eventsRoutes, parseLastId, pumpEvents, type StoredEvent } from "../src/events";

const ev = (id: number): StoredEvent => ({ id, data: { type: "system", level: "info", msg: `e${id}` } });
const tickOnce = () => new Promise((r) => setTimeout(r, 0));

function harness(history: StoredEvent[]) {
  const listeners = new Set<(e: StoredEvent) => void>();
  const written: number[] = [];
  let close!: () => void;
  const closed = new Promise<void>((r) => (close = r));
  return {
    listeners,
    written,
    close,
    closed,
    publish: (e: StoredEvent) => listeners.forEach((l) => l(e)),
    subscribe: (fn: (e: StoredEvent) => void) => {
      listeners.add(fn);
      return () => void listeners.delete(fn);
    },
    fetchAfter: async (after: number, limit: number) => history.filter((e) => e.id > after).slice(0, limit),
    write: async (e: StoredEvent) => void written.push(e.id),
  };
}

describe("SSE replay (pumpEvents)", () => {
  it("replays everything after Last-Event-ID across pages, then streams live events", async () => {
    const h = harness([1, 2, 3, 4, 5].map(ev));
    const done = pumpEvents({ ...h, lastId: 1, pageSize: 2 });
    await tickOnce();
    h.publish(ev(6));
    await tickOnce();
    h.close();
    await done;
    expect(h.written).toEqual([2, 3, 4, 5, 6]);
    expect(h.listeners.size).toBe(0); // unsubscribed on close
  });

  it("buffers live events that arrive during replay and sends each id once", async () => {
    const h = harness([10, 11, 12].map(ev));
    const racingFetch = async (after: number, limit: number) => {
      h.publish(ev(12)); // committed while the replay query runs: also returned by the query
      h.publish(ev(13)); // committed after the query's snapshot
      return h.fetchAfter(after, limit);
    };
    const done = pumpEvents({ ...h, fetchAfter: racingFetch, lastId: 9 });
    await tickOnce();
    h.close();
    await done;
    expect(h.written).toEqual([10, 11, 12, 13]);
  });

  it("without Last-Event-ID streams live events only", async () => {
    const h = harness([1, 2].map(ev));
    const done = pumpEvents({ ...h, lastId: null });
    await tickOnce();
    h.publish(ev(3));
    await tickOnce();
    h.close();
    await done;
    expect(h.written).toEqual([3]);
  });

  it("keeps going after a failed write until the stream closes", async () => {
    const h = harness([1, 2].map(ev));
    let n = 0;
    const write = async (e: StoredEvent) => {
      if (++n === 1) throw new Error("EPIPE");
      h.written.push(e.id);
    };
    const done = pumpEvents({ ...h, write, lastId: 0 });
    await tickOnce();
    h.close();
    await done;
    expect(h.written).toEqual([2]);
  });
});

describe("parseLastId", () => {
  it("accepts only non-negative integers", () => {
    expect(parseLastId("42")).toBe(42);
    expect(parseLastId("0")).toBe(0);
    expect(parseLastId(undefined)).toBeNull();
    expect(parseLastId("-1")).toBeNull();
    expect(parseLastId("1; drop")).toBeNull();
  });
});

describe("GET /events auth", () => {
  it("rejects a missing or wrong console key before touching the DB", async () => {
    expect((await eventsRoutes.request("/events")).status).toBe(401);
    expect((await eventsRoutes.request("/events?k=wrong-key-wrong-key")).status).toBe(401);
    expect((await eventsRoutes.request("/events", { headers: { authorization: "Bearer wrong-key-wrong-key" } })).status).toBe(401);
    expect((await eventsRoutes.request("/events/snapshot")).status).toBe(401);
  });
});

describe("emit (P8)", () => {
  it("rejects anything outside the strict SseEvent union before any SQL", async () => {
    const withBudget = {
      type: "lane", plan_id: "00000000-0000-4000-8000-000000000000", lane: 1, first_name: "A", stage: "JOINED",
      amount_cents: null, cybs_id_short: null, target_pp_cents: 3117,
    };
    await expect(emit(withBudget as unknown as SseEvent)).rejects.toThrow(/Unrecognized key/);
  });
});
