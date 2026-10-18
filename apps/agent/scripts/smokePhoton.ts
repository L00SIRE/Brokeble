// Live Photon smoke test: runs the real consumer (socket path, auth, subscribe, normalize) against PHOTON_PROJECT_ID
// with in-memory cursor/dedupe, printing only event types, seqs and classifications (never text, handles or keys).
// SMOKE_SEND=1 replies once to the first inbound DM. SMOKE_START_SEQ (default 0 = live) replays from a cursor.
// Run: pnpm --filter @tab/agent exec tsx --env-file-if-exists=../../.env.local scripts/smokePhoton.ts
if (!process.env.PHOTON_PROJECT_ID?.trim()) {
  console.log("smokePhoton: PHOTON_PROJECT_ID not set; skipping");
  process.exit(0);
}

// The smoke never touches the DB or other adapters; pin them so an unrelated .env.local value cannot fail env parsing.
Object.assign(process.env, {
  DATABASE_URL: "postgres://unused@127.0.0.1:9/unused",
  MESSAGING_MODE: "mock",
  LLM_MODE: "mock",
  PLANNER_MODE: "mock",
  VENUE_MODE: "mock",
  VOICE_ENABLED: "false",
  LOG_LEVEL: process.env.LOG_LEVEL || "info",
});

const { Photon } = await import("@photon-ai/api");
const { env } = await import("../src/env");
const { createPhotonConsumer, photonSocket } = await import("../src/photon/consumer");

const seconds = Number(process.env.SMOKE_SECONDS ?? 120);
const send = process.env.SMOKE_SEND === "1";
let cursor = Number(process.env.SMOKE_START_SEQ ?? 0);
let sent = false;
const seen = new Set<string>();
const name = (e: unknown) => (e instanceof Error ? e.name : typeof e);

const consumer = createPhotonConsumer({
  connect: () => {
    const s = photonSocket();
    s.on("connect", () => console.log(`connected; subscribing from seq ${cursor}`));
    s.on("delivery", (ev: { type?: unknown }, meta: { seq?: unknown; replyExpected?: unknown }) =>
      console.log(`delivery seq=${String(meta?.seq)} type=${String(ev?.type)} replyExpected=${String(meta?.replyExpected)}`),
    );
    s.on("delivery_error", (e: { code?: string; fatal?: boolean }) => console.log(`delivery_error code=${e?.code} fatal=${e?.fatal}`));
    return s;
  },
  loadCursor: async () => cursor,
  saveCursor: async (s) => void (cursor = s),
  seen: async (id) => seen.has(id),
  markSeen: async (id) => void seen.add(id),
  lookupAgentUserId: async () => null, // no dm_routes here: deliveries without receivedBy show as dropped
  emit: async (ev) => console.log(`sse ${ev.type}`),
  onStatus: async (messageId, status) => console.log(`status ${status} msg=…${messageId.slice(-6)}`),
  onInbound: async (e) => {
    console.log(`inbound content=${e.content_type} has_text=${e.text !== null} msg=…${e.message_id.slice(-6)} space_kind=${e.space_kind}`);
    if (!send || sent) return;
    sent = true;
    try {
      const photon = new Photon({ headers: { Authorization: `Bearer ${env.PHOTON_API_KEY}` }, timeoutMs: 10_000, retry: { maxAttempts: 2 } });
      const m = await photon.projects.sendMessage({
        path: { id: env.PHOTON_PROJECT_ID! },
        headers: { "idempotency-key": `smoke:${e.message_id}` },
        body: {
          spaceId: e.space_id,
          senderId: e.agent_user_id,
          parentMessageId: e.message_id,
          content: { type: "text", format: "plain", text: "Tab smoke test: got your message." },
        },
      });
      console.log(`sent reply msg=…${String(m.id).slice(-6)} status=${String(m.status)}`);
    } catch (err) {
      const code = (err as { code?: unknown; status?: unknown }) ?? {};
      console.log(`send failed: ${name(err)} code=${String(code.code ?? "")} status=${String(code.status ?? "")}`);
    }
  },
});

await consumer.start();
console.log(`listening ${seconds}s${send ? " (SMOKE_SEND=1: will reply once)" : ""}; text a Photon-assigned number now`);
setTimeout(() => {
  consumer.stop();
  console.log(`done; last cursor ${cursor}`);
  process.exit(0);
}, seconds * 1000);
