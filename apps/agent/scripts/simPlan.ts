// pnpm sim:plan — boots the agent in-process with every port mocked, drives a scripted DM sequence through
// POST /dev/inbound, and checks the plumbing end to end: inbound → handler, due_jobs poller → handler,
// emit → SSE (live and Last-Event-ID replay), and each mock port. Needs DATABASE_URL (local Postgres with
// db/migrations applied). Owner A grows SCRIPT and the checks into the full mocked plan (join → CONFIRMED).
import { randomBytes } from "node:crypto";
import type { SseEvent } from "@tab/shared";

if (!process.env.DATABASE_URL) {
  console.error("sim:plan needs DATABASE_URL: a local/test Postgres with db/migrations/001+002 applied (never prod).");
  process.exit(1);
}
const CONSOLE_KEY = randomBytes(18).toString("hex");
Object.assign(process.env, { MESSAGING_MODE: "mock", LLM_MODE: "mock", PLANNER_MODE: "mock", VENUE_MODE: "mock", PORT: "0", NODE_ENV: "development", CONSOLE_KEY, LOG_LEVEL: process.env.SIM_LOG_LEVEL ?? "warn" });

// Fictional numbers (555-01xx). Each member texts JOIN, a budget, prefs, then a ballot.
const MEMBERS = ["+13105550101", "+13105550102", "+13105550103"];
const SCRIPT = ["JOIN 4821", "honestly 30 tops tonight", "veggie, nothing after 10pm", "2, but not if it ends after 10"];

const { agent } = await import("../src/index");
const { enqueue, registerJob } = await import("../src/dueJobs");
const { emit, subscriberCount } = await import("../src/events");
const { ports } = await import("../src/ports");
const { loadCachedOptions } = await import("../src/ports/cachedOptions");
const { ScoutSubmission } = await import("@tab/shared");
const { consentFromOrder } = await import("@tab/shared/tap");

const run = randomBytes(4).toString("hex");
const base = agent.url;
let failures = 0;
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? "  ok  " : "  FAIL"} ${what}`);
  if (!ok) failures++;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor<T>(f: () => T | undefined | Promise<T | undefined>, ms: number): Promise<T | undefined> {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(100)) {
    const v = await f();
    if (v !== undefined) return v;
  }
  return undefined;
}
const json = async <T>(path: string, init?: RequestInit): Promise<{ status: number; body: T }> => {
  const res = await fetch(base + path, init);
  return { status: res.status, body: (await res.json()) as T };
};
const post = (body: unknown): RequestInit => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

/** Minimal SSE client over fetch (Node has no EventSource): collects `{id, data}` frames. */
function openSse(lastEventId?: number) {
  const events: { id: number; data: SseEvent }[] = [];
  const ac = new AbortController();
  const headers: Record<string, string> = lastEventId === undefined ? {} : { "last-event-id": String(lastEventId) };
  const opened = fetch(`${base}/events?k=${CONSOLE_KEY}`, { headers, signal: ac.signal }).then(async (res) => {
    if (res.status !== 200 || !res.body) throw new Error(`SSE status ${res.status}`);
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    void (async () => {
      let buf = "";
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) return;
          buf += value;
          for (let i; (i = buf.indexOf("\n\n")) >= 0; ) {
            const frame = buf.slice(0, i);
            buf = buf.slice(i + 2);
            const id = /^id: (\d+)$/m.exec(frame)?.[1];
            const data = /^data: (.*)$/m.exec(frame)?.[1];
            if (id && data) events.push({ id: Number(id), data: JSON.parse(data) as SseEvent });
          }
        }
      } catch {
        /* aborted */
      }
    })();
  });
  const find = (pred: (e: SseEvent) => boolean) => waitFor(() => events.find((e) => pred(e.data)), 8_000);
  return { events, opened, find, close: () => ac.abort() };
}
const isSystem = (msg: string) => (e: SseEvent) => e.type === "system" && e.msg.includes(msg);

try {
  console.log(`sim:plan → ${base} (all ports mocked)`);
  check((await fetch(`${base}/healthz`)).status === 200, "GET /healthz");
  check((await fetch(`${base}/events`)).status === 401, "GET /events without CONSOLE_KEY → 401");

  const snap = await json<{ last_id: number }>(`/events/snapshot?k=${CONSOLE_KEY}`);
  check(snap.status === 200, `GET /events/snapshot (last_id ${snap.body.last_id})`);
  const baselineSubs = subscriberCount();
  const sse = openSse(snap.body.last_id);
  await sse.opened;
  check(subscriberCount() > baselineSubs || (await waitFor(() => (subscriberCount() > baselineSubs ? true : undefined), 2_000)) === true, "SSE connected");

  // 1. Scripted DMs through POST /dev/inbound → the registered inbound handler.
  const before = (await json<{ next: number }>("/dev/outbox?since=0")).body.next;
  const messageIds: string[] = [];
  for (const text of SCRIPT)
    for (const from_handle of MEMBERS) {
      const r = await json<{ ok: boolean; message_id: string }>("/dev/inbound", post({ from_handle, text }));
      if (r.status !== 200) check(false, `POST /dev/inbound ${from_handle} → ${r.status}`);
      messageIds.push(r.body.message_id);
    }
  const outbox = (await json<{ entries: { kind: string; messageId?: string }[] }>(`/dev/outbox?since=${before}`)).body.entries;
  const read = new Set(outbox.filter((e) => e.kind === "read").map((e) => e.messageId));
  check(messageIds.length === MEMBERS.length * SCRIPT.length && messageIds.every((id) => read.has(id)), `${messageIds.length} inbound DMs handled (each marked read)`);

  // 2. due_jobs: enqueue → poller claims → handler emits → SSE.
  registerJob("sim.ping", async (job) => void (await emit({ type: "system", level: "info", msg: `sim job ${job.dedupe_key}` })));
  check(await enqueue("sim.ping", `sim:${run}`, new Date()), "enqueue sim.ping");
  check(!(await enqueue("sim.ping", `sim:${run}`, new Date())), "duplicate enqueue ignored");
  check((await sse.find(isSystem(`sim job sim:${run}`))) !== undefined, "poller ran the job; its event arrived over SSE");

  // 3. LLMPort mock.
  const budget = await ports.llm.parseBudget({ user_first_name: "Sim", stage: "budget", message_text: SCRIPT[1]! });
  check(budget.target_pp_cents === 3000 && budget.hard_max_pp_cents === 3000, "LLMPort.parseBudget (mock)");

  // 4. PlannerPort mock: both Scout runs complete with valid submissions; progress reaches SSE.
  const planRef = crypto.randomUUID();
  const brief = (category: "dinner" | "show") => ({
    category, area: "Westwood / Sawtelle", date: "2026-10-18", time_window: { start: "18:30", end: "23:00" }, party_size: 3,
    dietary_tags: [], vibe: [], price_tiers: ["<$25", "$25-50", "$50+"] as ["<$25", "$25-50", "$50+"], count_per_tier: 4 as const,
  });
  const runs = await Promise.all((["dinner", "show"] as const).map((c) => ports.planner.startScout(planRef, brief(c), 1)));
  const subs = await Promise.all(
    runs.map(({ runId }) =>
      waitFor(async () => {
        const r = await ports.planner.getRun(runId);
        if (r.status !== "completed") return undefined;
        return ScoutSubmission.parse(JSON.parse(/```json\n([\s\S]*)\n```/.exec(r.result?.text ?? "")?.[1] ?? "null"));
      }, 10_000),
    ),
  );
  check(subs.every((s) => s?.plan_ref === planRef), "PlannerPort.startScout ×2 → completed with valid ScoutSubmissions");
  check((await sse.find((e) => e.type === "creao.progress" && e.run_id === runs[0]!.runId)) !== undefined, "creao.progress arrived over SSE");

  // 5. VenuePort mock: order → holds (via /dev/venue/authorize) → tamper rejected → commit captured.
  const [dinner, show] = await Promise.all([loadCachedOptions("dinner"), loadCachedOptions("show")]);
  const d = dinner.options[0]!;
  const s = show.options.find((o): o is Extract<typeof o, { category: "show" }> => o.category === "show")!;
  const order = await ports.venue.createOrder({
    plan_ref: planRef, plan_version: 1, party_size: 3, deadline_at: new Date(Date.now() + 600_000).toISOString(),
    payer_refs: MEMBERS.map(() => randomBytes(16).toString("hex")),
    bundle: {
      bundle_key: `bnd_sim_${run}`, date: "2026-10-18",
      dinner: { name: d.name, address: d.address, time: "18:30", est_high_pp_usd: d.est_high_pp_usd },
      show: { name: s.name, address: s.address, time: s.show_start, est_high_pp_usd: s.est_high_pp_usd },
    },
  });
  for (const sh of order.shares) {
    const r = await json<{ ok: boolean }>(`/dev/venue/authorize/${sh.share_id}`, post({}));
    if (r.status !== 200) check(false, `authorize ${sh.share_id} → ${r.status}`);
  }
  const held = await ports.venue.getOrder(order.order_id);
  check(held.shares.every((x) => x.status === "AUTHORIZED"), `VenuePort.createOrder + ${held.shares.length} mock holds`);
  const consent = consentFromOrder(held);
  const tampered = await ports.venue.commit(order.order_id, consent, "tamper");
  check(tampered.result === "rejected" && (await ports.venue.getOrder(order.order_id)).status === "OPEN", "commit(tamper) rejected, nothing captured");
  const committed = await ports.venue.commit(order.order_id, consent);
  check(committed.result === "captured", "commit(consent) captured all shares");
  await emit({ type: "tap.verify", order_id: order.order_id, report: committed.tap });
  check((await sse.find((e) => e.type === "tap.verify" && e.order_id === order.order_id)) !== undefined, "tap.verify arrived over SSE");

  // 6. Reconnect: an event emitted while disconnected is replayed via Last-Event-ID; the old stream unsubscribes.
  const lastSeen = sse.events.at(-1)!.id;
  sse.close();
  check((await waitFor(() => (subscriberCount() === baselineSubs ? true : undefined), 3_000)) === true, "SSE disconnect releases its subscription");
  await emit({ type: "system", level: "info", msg: `sim replay ${run}` });
  const again = openSse(lastSeen);
  await again.opened;
  check((await again.find(isSystem(`sim replay ${run}`))) !== undefined, "Last-Event-ID replay delivered the missed event");
  check(new Set(again.events.map((e) => e.id)).size === again.events.length && again.events.every((e) => e.id > lastSeen), "replay sent each id once, all after Last-Event-ID");
  again.close();
} catch (e) {
  check(false, `crashed: ${e instanceof Error ? e.message : String(e)}`);
}

await agent.stop();
console.log(failures ? `sim:plan FAILED (${failures})` : "sim:plan passed");
process.exit(failures ? 1 : 0);
