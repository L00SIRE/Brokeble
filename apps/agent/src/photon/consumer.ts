// Socket.IO consumer with a persisted replay cursor (PLAN §10, A plan T2). Owner A.
// Contract (Beta websocket docs: connect, session, cursors, errors, example): on every `connect`, emit
// subscribe {startSeq: cursor, apiVersion}; deliveries are processed strictly in order; dedupe is checked first and
// recorded only after success; the cursor is saved only after success; a stale-epoch or seq ≤ cursor delivery is
// skipped; a failure stops the stream (engine close → Socket.IO reconnects → replay from the cursor); the same
// event.id failing `poisonAfter` times is skipped with a system:error event (deliberate deviation for demo liveness).
import type { InboundEvent, SseEvent } from "@tab/shared";
import { io, type Socket } from "socket.io-client";
import { env } from "../env";
import { emit } from "../events";
import { errInfo, log } from "../log";
import { findAgentUserIdByPhotonUser } from "../repo/dmRoutes";
import { markInboundSeen, seenInbound } from "../repo/inboundEvents";
import { findOutboundByPhotonMessageId } from "../repo/outbound";
import { getParticipant } from "../repo/participants";
import { loadCursor, saveCursor } from "../repo/photonCursor";
import { deliveryEventId, normalizeDelivery, type DeliveryStatus } from "./normalize";

export const PHOTON_ORIGIN = "https://api.photon.codes";

export type ConsumerDeps = {
  onInbound: (e: InboundEvent) => Promise<void>;
  /** Default photonSocket(); tests inject a fake. */
  connect?: () => Socket;
  /** Defaults: repo/photonCursor loadCursor/saveCursor. */
  loadCursor?: () => Promise<number>;
  saveCursor?: (seq: number) => Promise<void>;
  /** Defaults: repo/inboundEvents seenInbound/markInboundSeen with source "photon". */
  seen?: (eventId: string) => Promise<boolean>;
  markSeen?: (eventId: string) => Promise<void>;
  /** Default: map messageId via repo/outbound and emit a `delivery` SSE (message_id_short = last 6 chars); unknown ids ignored. */
  onStatus?: (messageId: string, status: DeliveryStatus) => Promise<void>;
  /** Default repo/dmRoutes findAgentUserIdByPhotonUser (used when a delivery lacks receivedBy). */
  lookupAgentUserId?: (photonUserId: string) => Promise<string | null>;
  /** Default events.emit (poison-skip system event). */
  emit?: (ev: SseEvent) => Promise<unknown>;
  /** Default 45_000 (LLM 10 s × 2 + send 10 s × 2). */
  handlerTimeoutMs?: number;
  /** Default 128: above this many queued deliveries, close the engine and resubscribe from the cursor. */
  maxPending?: number;
  /** Default 3. */
  poisonAfter?: number;
  /** Backoff for server-initiated disconnects, which Socket.IO does not retry itself. Default 1_000 (doubles to 30 s). */
  reconnectBaseMs?: number;
};

export type PhotonConsumer = { start(): Promise<void>; stop(): void };

type SubscribeAck = { ok: true; connectionId?: string; apiVersion?: string } | { ok: false; error?: { code?: string } };
type DeliveryError = { code?: string; fatal?: boolean; retryable?: boolean };

/** socket.io-client error messages can embed request URLs; keep the gist, drop anything URL-shaped. */
const scrub = (s: unknown): string => String(s ?? "").replace(/\S+:\/\/\S*/g, "[url]").slice(0, 120);

/**
 * The default socket: io("https://api.photon.codes", { path: `/v1/projects/${id}/events/ws`, addTrailingSlash: false,
 * transports: ["websocket"], extraHeaders: { Authorization: Bearer key }, autoConnect: false }).
 */
export function photonSocket(): Socket {
  const { PHOTON_API_KEY: key, PHOTON_PROJECT_ID: projectId } = env;
  if (!key || !projectId) throw new Error("photonSocket: PHOTON_API_KEY and PHOTON_PROJECT_ID are required");
  return io(PHOTON_ORIGIN, {
    path: `/v1/projects/${projectId}/events/ws`,
    addTrailingSlash: false,
    transports: ["websocket"],
    extraHeaders: { Authorization: `Bearer ${key}` },
    autoConnect: false,
  });
}

async function defaultOnStatus(messageId: string, status: DeliveryStatus, emitFn: (ev: SseEvent) => Promise<unknown>): Promise<void> {
  // setTyping/markRead also produce action Messages; only ids we recorded as outbound sends are surfaced.
  const row = await findOutboundByPhotonMessageId(messageId);
  if (!row) return;
  const lane = row.plan_id && row.user_id ? ((await getParticipant(row.plan_id, row.user_id))?.lane ?? null) : null;
  await emitFn({ type: "delivery", lane, message_id_short: messageId.slice(-6), status });
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error(`handler timed out after ${ms}ms`), { code: "HANDLER_TIMEOUT" })), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

/** Builds the consumer; start() loads the cursor, wires handlers and connects; stop() disconnects. */
export function createPhotonConsumer(deps: ConsumerDeps): PhotonConsumer {
  const emitFn = deps.emit ?? emit;
  const d = {
    connect: deps.connect ?? photonSocket,
    loadCursor: deps.loadCursor ?? (() => loadCursor()),
    saveCursor: deps.saveCursor ?? ((seq: number) => saveCursor(seq)),
    seen: deps.seen ?? ((id: string) => seenInbound("photon", id)),
    markSeen: deps.markSeen ?? ((id: string) => markInboundSeen("photon", id)),
    onStatus: deps.onStatus ?? ((id: string, s: DeliveryStatus) => defaultOnStatus(id, s, emitFn)),
    lookup: deps.lookupAgentUserId ?? ((id: string) => findAgentUserIdByPhotonUser(id)),
    timeoutMs: deps.handlerTimeoutMs ?? 45_000,
    maxPending: deps.maxPending ?? 128,
    poisonAfter: deps.poisonAfter ?? 3,
    backoffBase: deps.reconnectBaseMs ?? 1_000,
  };

  let socket: Socket | null = null;
  let cursor = 0;
  let epoch = 0;
  let pending = 0;
  let queue: Promise<void> = Promise.resolve();
  let stopped = false;
  let backoffMs = d.backoffBase;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let lastError: DeliveryError | null = null;
  const failures = new Map<string, number>();

  /** Drops the transport; Socket.IO's manager reconnects and the `connect` handler resubscribes from `cursor`. */
  const restart = () => {
    epoch++;
    socket?.io.engine?.close();
  };

  /** Classify and dispatch one delivery. Throws to stop the stream. */
  async function handle(event: unknown, seq: number): Promise<void> {
    const c = await normalizeDelivery(event, seq, d.lookup);
    if (c.kind === "message") return deps.onInbound(c.event);
    if (c.kind === "status") return d.onStatus(c.messageId, c.status);
    if (c.reason === "no_agent_user_id") log.error({ event_id: deliveryEventId(event), seq }, "photon delivery without agent user id dropped");
    else log.debug({ seq, reason: c.reason }, "photon delivery ignored");
  }

  async function processDelivery(event: unknown, seq: number): Promise<void> {
    const eventId = deliveryEventId(event);
    if (eventId && !(await d.seen(eventId))) {
      try {
        await withTimeout(handle(event, seq), d.timeoutMs);
        failures.delete(eventId);
      } catch (e) {
        const n = (failures.get(eventId) ?? 0) + 1;
        failures.set(eventId, n);
        log.error({ event_id: eventId, seq, attempt: n, ...errInfo(e) }, "photon delivery handler failed");
        if (n < d.poisonAfter) throw e;
        failures.delete(eventId);
        log.error({ event_id: eventId, seq }, "photon poison delivery skipped");
        await emitFn({ type: "system", level: "error", msg: "inbound message skipped after repeated failures" }).catch((err) =>
          log.warn(errInfo(err), "poison system event emit failed"),
        );
      }
      await d.markSeen(eventId);
    }
    await d.saveCursor(seq);
    cursor = seq;
  }

  function onDelivery(event: unknown, meta: { seq?: unknown } | undefined) {
    const seq = meta?.seq;
    if (typeof seq !== "number" || !Number.isSafeInteger(seq)) {
      log.warn({ seq_type: typeof seq }, "photon delivery without a valid seq ignored");
      return;
    }
    const gen = epoch;
    if (++pending > d.maxPending) {
      pending--;
      log.warn({ pending }, "photon queue full; restarting stream from cursor");
      restart();
      return;
    }
    queue = queue
      .then(async () => {
        if (gen !== epoch || seq <= cursor) return;
        await processDelivery(event, seq);
      })
      .catch((e) => {
        log.warn({ seq, ...errInfo(e) }, "photon stream stopped; resuming from cursor");
        if (gen === epoch) restart();
      })
      .finally(() => {
        pending--;
      });
  }

  function scheduleReconnect() {
    if (stopped || retryTimer) return;
    // A non-retryable fatal code means our bug; retry slowly anyway rather than going permanently deaf mid-demo.
    const delay = lastError?.fatal && lastError.retryable === false ? 30_000 : backoffMs;
    backoffMs = Math.min(backoffMs * 2, 30_000);
    retryTimer = setTimeout(() => {
      retryTimer = undefined;
      if (!stopped) socket?.connect();
    }, delay);
  }

  function wire(s: Socket) {
    s.on("connect", () => {
      const startSeq = cursor;
      s.timeout(10_000).emit("subscribe", { startSeq, apiVersion: env.PHOTON_API_VERSION }, (err: Error | null, res: SubscribeAck) => {
        if (err) {
          log.warn({ startSeq }, "photon subscribe ack timed out; reconnecting");
          s.io.engine?.close();
          return;
        }
        if (!res?.ok) {
          log.error({ code: res?.error?.code ?? "unknown" }, "photon subscribe rejected");
          return;
        }
        backoffMs = d.backoffBase;
        lastError = null;
        log.info({ startSeq, connection_id: res.connectionId, api_version: res.apiVersion }, "photon subscribed");
      });
    });
    s.on("disconnect", (reason: string) => {
      epoch++;
      log.warn({ reason }, "photon socket disconnected");
      // Socket.IO only auto-reconnects transport-level drops; server-initiated disconnects (server_draining etc.) need a nudge.
      if (reason === "io server disconnect") scheduleReconnect();
    });
    s.on("delivery", onDelivery);
    s.on("delivery_error", (e: DeliveryError) => {
      lastError = e ?? null;
      log.warn({ code: e?.code, fatal: e?.fatal, retryable: e?.retryable }, "photon delivery_error");
    });
    s.on("connect_error", (e: Error) => {
      log.error({ name: e?.name, m: scrub(e?.message), active: s.active }, "photon connect_error");
      // s.active=false means the handshake was refused (auth/project): the docs say fix the credential, not retry.
      if (!s.active) void emitFn({ type: "system", level: "error", msg: "Photon connection refused; check API key and project" }).catch(() => {});
    });
  }

  return {
    async start() {
      if (socket) return;
      stopped = false;
      cursor = await d.loadCursor();
      socket = d.connect();
      wire(socket);
      log.info({ cursor }, "photon consumer starting");
      socket.connect();
    },
    stop() {
      stopped = true;
      clearTimeout(retryTimer);
      retryTimer = undefined;
      epoch++;
      socket?.removeAllListeners();
      socket?.disconnect();
      socket = null;
    },
  };
}
