import type { InboundEvent, SseEvent } from "@tab/shared";
import type { Socket } from "socket.io-client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPhotonConsumer, type ConsumerDeps } from "../src/photon/consumer";

type Handler = (...args: any[]) => void;

/** Minimal socket.io-client Socket double: records subscribes, lets tests push server events. */
class FakeSocket {
  handlers = new Map<string, Handler[]>();
  subscribes: { startSeq: number; apiVersion: string }[] = [];
  connects = 0;
  engineCloses = 0;
  active = true;
  ackWith: unknown = { ok: true, connectionId: "c1", apiVersion: "2026-07-01" };
  io = { engine: { close: () => this.engineCloses++ } };
  on(ev: string, fn: Handler) {
    this.handlers.set(ev, [...(this.handlers.get(ev) ?? []), fn]);
    return this;
  }
  fire(ev: string, ...args: unknown[]) {
    for (const fn of this.handlers.get(ev) ?? []) fn(...args);
  }
  timeout() {
    return { emit: (ev: string, body: any, ack: Handler) => (ev === "subscribe" && this.subscribes.push(body), ack(null, this.ackWith)) };
  }
  connect() {
    this.connects++;
    this.fire("connect");
    return this;
  }
  disconnect() {
    return this;
  }
  removeAllListeners() {
    this.handlers.clear();
    return this;
  }
}

const msg = (id: string) => ({
  id,
  type: "message.received",
  data: {
    projectId: "pho_prj_x",
    object: {
      id: `pho_msg_${id}`,
      platform: "imessage",
      space: { id: "spc_1", kind: "direct" },
      sentBy: { id: "usr_h", handle: "+13105550100", kind: "human" },
      receivedBy: { id: "usr_a", handle: "+13105550199", kind: "agent" },
      content: { type: "text", format: "plain", text: "hi" },
      timestamps: { receivedAt: "2026-10-17T20:00:00Z" },
    },
  },
});

const flush = async () => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
};

function setup(over: Partial<ConsumerDeps> = {}, initialCursor = 0) {
  const sock = new FakeSocket();
  const state = { cursor: initialCursor, seen: new Set<string>(), handled: [] as InboundEvent[], saves: [] as number[], emitted: [] as SseEvent[] };
  const deps: ConsumerDeps = {
    onInbound: async (e) => void state.handled.push(e),
    connect: () => sock as unknown as Socket,
    loadCursor: async () => state.cursor,
    saveCursor: async (s) => void (state.saves.push(s), (state.cursor = s)),
    seen: async (id) => state.seen.has(id),
    markSeen: async (id) => void state.seen.add(id),
    lookupAgentUserId: async () => null,
    emit: async (ev) => void state.emitted.push(ev),
    onStatus: async () => {},
    ...over,
  };
  return { sock, state, consumer: createPhotonConsumer(deps) };
}

afterEach(() => vi.useRealTimers());

describe("photon consumer", () => {
  it("subscribes with the persisted cursor and resubscribes with the advanced cursor on reconnect", async () => {
    const { sock, state, consumer } = setup({}, 7);
    await consumer.start();
    expect(sock.subscribes).toEqual([{ startSeq: 7, apiVersion: "2026-07-01" }]);
    sock.fire("delivery", msg("e8"), { seq: 8, replyExpected: false });
    await flush();
    expect(state.handled.map((e) => e.event_id)).toEqual(["e8"]);
    expect(state.saves).toEqual([8]);
    sock.fire("disconnect", "transport close");
    sock.fire("connect"); // Socket.IO's own reconnect
    expect(sock.subscribes.at(-1)?.startSeq).toBe(8);
    consumer.stop();
  });

  it("saves the cursor and marks seen only after the handler succeeds; failure restarts the stream", async () => {
    let fail = true;
    const { sock, state, consumer } = setup({
      onInbound: async (e) => {
        if (fail) throw new Error("boom");
        state.handled.push(e);
      },
    });
    await consumer.start();
    sock.fire("delivery", msg("e1"), { seq: 1 });
    sock.fire("delivery", msg("e2"), { seq: 2 });
    await flush();
    expect(state.saves).toEqual([]);
    expect(state.seen.size).toBe(0);
    expect(sock.engineCloses).toBe(1); // e2 was not processed after e1 failed (stale epoch)
    // Replay after reconnect redelivers both.
    fail = false;
    sock.fire("disconnect", "transport close");
    sock.fire("connect");
    expect(sock.subscribes.at(-1)?.startSeq).toBe(0);
    sock.fire("delivery", msg("e1"), { seq: 1 });
    sock.fire("delivery", msg("e2"), { seq: 2 });
    await flush();
    expect(state.handled.map((e) => e.event_id)).toEqual(["e1", "e2"]);
    expect(state.saves).toEqual([1, 2]);
    expect([...state.seen]).toEqual(["e1", "e2"]);
    consumer.stop();
  });

  it("handles a duplicate event.id once and skips seq ≤ cursor", async () => {
    const { sock, state, consumer } = setup({}, 5);
    await consumer.start();
    sock.fire("delivery", msg("old"), { seq: 5 });
    sock.fire("delivery", msg("dup"), { seq: 6 });
    sock.fire("delivery", msg("dup"), { seq: 7 }); // same event under a new seq
    await flush();
    expect(state.handled.map((e) => e.event_id)).toEqual(["dup"]);
    expect(state.saves).toEqual([6, 7]);
    consumer.stop();
  });

  it("skips deliveries queued before a disconnect (stale epoch)", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { sock, state, consumer } = setup({
      onInbound: async (e) => {
        if (e.event_id === "slow") await gate;
        state.handled.push(e);
      },
    });
    await consumer.start();
    sock.fire("delivery", msg("slow"), { seq: 1 });
    sock.fire("delivery", msg("queued"), { seq: 2 });
    await flush();
    sock.fire("disconnect", "transport close");
    release();
    await flush();
    expect(state.handled.map((e) => e.event_id)).toEqual(["slow"]);
    expect(state.saves).toEqual([1]);
    consumer.stop();
  });

  it("skips a poison event after 3 failures with a system event", async () => {
    const { sock, state, consumer } = setup({ onInbound: async () => Promise.reject(new Error("always")) });
    await consumer.start();
    for (let i = 0; i < 3; i++) {
      sock.fire("delivery", msg("poison"), { seq: 1 });
      await flush();
      if (i < 2) {
        sock.fire("disconnect", "transport close");
        sock.fire("connect");
      }
    }
    expect(state.saves).toEqual([1]);
    expect(state.seen.has("poison")).toBe(true);
    expect(state.emitted).toEqual([{ type: "system", level: "error", msg: expect.any(String) }]);
    expect(sock.engineCloses).toBe(2);
    consumer.stop();
  });

  it("times out a hung handler and restarts", async () => {
    vi.useFakeTimers();
    const { sock, state, consumer } = setup({ onInbound: () => new Promise(() => {}), handlerTimeoutMs: 1000 });
    await consumer.start();
    sock.fire("delivery", msg("hang"), { seq: 1 });
    await vi.advanceTimersByTimeAsync(1001);
    expect(sock.engineCloses).toBe(1);
    expect(state.saves).toEqual([]);
    consumer.stop();
  });

  it("restarts from the cursor when the queue overflows", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { sock, consumer } = setup({ onInbound: () => gate, maxPending: 2 });
    await consumer.start();
    for (let s = 1; s <= 3; s++) sock.fire("delivery", msg(`e${s}`), { seq: s });
    expect(sock.engineCloses).toBe(1);
    release();
    await flush();
    consumer.stop();
  });

  it("routes status events to onStatus; ignored event types still advance the cursor", async () => {
    const onStatus = vi.fn(async () => {});
    const { sock, state, consumer } = setup({ onStatus });
    await consumer.start();
    sock.fire("delivery", { id: "s1", type: "message.delivered", data: { object: { id: "pho_msg_out123456" } } }, { seq: 1 });
    sock.fire("delivery", { id: "t1", type: "space.typing.updated", data: { object: {} } }, { seq: 2 });
    await flush();
    expect(onStatus).toHaveBeenCalledWith("pho_msg_out123456", "delivered");
    expect(state.saves).toEqual([1, 2]);
    consumer.stop();
  });

  it("closes the engine when the subscribe ack times out, and reconnects after a server disconnect", async () => {
    vi.useFakeTimers();
    const { sock, consumer } = setup({ reconnectBaseMs: 500 });
    sock.timeout = () => ({ emit: (_e: string, _b: unknown, ack: Handler) => ack(new Error("operation has timed out")) });
    await consumer.start();
    expect(sock.engineCloses).toBe(1);
    sock.fire("disconnect", "io server disconnect");
    expect(sock.connects).toBe(1);
    await vi.advanceTimersByTimeAsync(500);
    expect(sock.connects).toBe(2);
    consumer.stop();
  });
});
