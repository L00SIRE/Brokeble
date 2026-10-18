// pnpm sim:plan: the end-to-end assertion harness. Boots the agent in-process with every port mocked (messaging,
// LLM, planner = cached fixtures, venue) against a REAL Postgres, then drives whole plans through POST /dev/inbound,
// POST /plans, POST /join and /dev/venue/authorize exactly as phones and the pay page would, and asserts:
//   infra      healthz, SSE auth/replay, due_jobs, each mock port, an unknown sender
//   happy path create → 4 joins → budgets (form, DM, tiers) → prefs → cached research → shortlist → ballots → winner →
//              order → holdGate → pay links → mock venue authorizes all → commit → CONFIRMED → Concierge started
//   decline    an "I'm out" after holds exist → every hold released, nobody captured, nobody named
//   privacy    asking for another member's budget is refused; budgets, pay URLs and DM text never reach SSE or a
//              second recipient; every text sent is a fixed template
// Needs DATABASE_URL (or TEST_DATABASE_URL) with db/migrations applied. Local database only: this process runs the
// due_jobs poller, so against a shared database it would claim other people's jobs and execute them with mock ports.
import { randomBytes, randomInt } from "node:crypto";
import { COPY, type SseEvent, type TemplateId } from "@tab/shared";

const dbUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!dbUrl) {
  console.error("sim:plan needs DATABASE_URL (or TEST_DATABASE_URL): a local Postgres with db/migrations applied (never prod).");
  process.exit(1);
}
const dbHost = (() => {
  try {
    return new URL(dbUrl).hostname;
  } catch {
    return "";
  }
})();
if (!["localhost", "127.0.0.1", "[::1]"].includes(dbHost) && process.env.SIM_ALLOW_REMOTE_DB !== "1") {
  console.error("sim:plan refuses a non-local database (its due_jobs poller would run other people's jobs on mock ports). Set SIM_ALLOW_REMOTE_DB=1 to override.");
  process.exit(1);
}

const CONSOLE_KEY = randomBytes(18).toString("hex");
Object.assign(process.env, {
  DATABASE_URL: dbUrl,
  MESSAGING_MODE: "mock", LLM_MODE: "mock", PLANNER_MODE: "cached", VENUE_MODE: "mock",
  PORT: "0", NODE_ENV: "development", CONSOLE_KEY,
  VENUE_HOOK_SECRET: randomBytes(24).toString("hex"), // lets /dev/venue/authorize post the signed hook to /venue/hook
  DEMO_TIMERS: "false", VOICE_ENABLED: "false",
  NOTION_TOKEN: "", NOTION_PARENT_PAGE_ID: "", // the Concierge fallback must never reach a real workspace
  LOG_LEVEL: process.env.SIM_LOG_LEVEL ?? "warn",
});

const { agent } = await import("../src/index");
const { enqueue, registerJob } = await import("../src/dueJobs");
const { emit, subscribe, subscriberCount } = await import("../src/events");
const { ports } = await import("../src/ports");
const { loadCachedOptions } = await import("../src/ports/cachedOptions");
const { ScoutSubmission } = await import("@tab/shared");
const { consentFromOrder } = await import("@tab/shared/tap");
const { getPlan, getPlanByCode } = await import("../src/repo/plans");
const { getParticipant } = await import("../src/repo/participants");
const { findUserByPhone } = await import("../src/repo/users");
const { getShortlist } = await import("../src/repo/bundles");
const { listOptions } = await import("../src/repo/options");
const { listRunsForPlan } = await import("../src/repo/researchRuns");
const { getHoldGate } = await import("../src/repo/holdGates");
const { bundleTitle } = await import("../src/plan/decision");
const { usd2 } = await import("../src/notify/render");

const run = randomBytes(4).toString("hex");
const base = agent.url;
let failures = 0;
let checks = 0;
const check = (ok: boolean, what: string) => {
  checks++;
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
const same = (a: readonly unknown[], b: readonly unknown[]) => JSON.stringify(a) === JSON.stringify(b);

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
  const find = (pred: (e: SseEvent) => boolean, ms = 8_000) => waitFor(() => events.find((e) => pred(e.data)), ms);
  return { events, opened, find, close: () => ac.abort() };
}
const isSystem = (msg: string) => (e: SseEvent) => e.type === "system" && e.msg.includes(msg);

// ---------- the phone side: DMs in through /dev/inbound, texts out through /dev/outbox ----------

type TextEntry = { kind: "text"; to: { userId: string; spaceId: string }; text: string; replyTo: string | null; idempotencyKey: string; messageId: string };
const sent: TextEntry[] = [];
let outboxCursor = 0;
async function pull(): Promise<void> {
  const r = await json<{ entries: { kind: string }[]; next: number }>(`/dev/outbox?since=${outboxCursor}`);
  outboxCursor = r.body.next;
  for (const e of r.body.entries) if (e.kind === "text") sent.push(e as TextEntry);
}
const mark = async () => (await pull(), sent.length);

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const TEMPLATES = Object.keys(COPY) as TemplateId[];
const tplRe = Object.fromEntries(TEMPLATES.map((id) => [id, new RegExp(`^${esc(COPY[id]).replace(/\\\{\w+\\\}/g, "[\\s\\S]+?")}$`)])) as Record<TemplateId, RegExp>;
const isTpl = (text: string, id: TemplateId) => tplRe[id].test(text);
const fill = (id: TemplateId, vars: Record<string, string | number>) => COPY[id].replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k]));

type Budget = { target: number; max: number };
type Member = { name: string; phone: string; space: string; userId: string; payerRef: string; budget: Budget; lane: number };
const phones = new Set<string>();
function member(name: string, budget: Budget): Member {
  let phone: string;
  do phone = `+1310555${String(100 + randomInt(100)).padStart(4, "0")}`;
  while (phones.has(phone));
  phones.add(phone);
  return { name, phone, space: `mock_spc_${phone.replace(/\D/g, "")}`, userId: "", payerRef: "", budget, lane: 0 };
}
const ownLine = (b: Budget) => fill("T_BUDGET_CONFIRM", { target: b.target, max: b.max });

/** One DM from `m`. Never logs the text (it may carry a budget). */
async function dm(m: Member, text: string): Promise<string> {
  const r = await json<{ message_id: string }>("/dev/inbound", post({ from_handle: m.phone, text }));
  if (r.status !== 200) check(false, `${m.name}: POST /dev/inbound → ${r.status}`);
  return r.body.message_id;
}
/** Waits for the n-th text to `m` rendered from template `id`, among texts sent at or after index `from`. */
async function got(m: Member, id: TemplateId, from: number, n = 1, ms = 15_000): Promise<TextEntry | undefined> {
  return waitFor(async () => {
    await pull();
    return sent.slice(from).filter((e) => e.to.spaceId === m.space && isTpl(e.text, id))[n - 1];
  }, ms);
}
/** Sends `text` and checks the reply is the `id` template. */
async function say(m: Member, text: string, id: TemplateId, what: string): Promise<TextEntry | undefined> {
  const from = await mark();
  await dm(m, text);
  const reply = await got(m, id, from);
  check(reply !== undefined, `${m.name}: ${what}`);
  return reply;
}
const textsTo = (m: Member, id: TemplateId, from = 0) => sent.slice(from).filter((e) => e.to.spaceId === m.space && isTpl(e.text, id));

// ---------- DB / SSE helpers ----------

const stageOf = async (planId: string, m: Member) => (await getParticipant(planId, m.userId))?.stage;
const waitStage = async (planId: string, m: Member, stage: string, ms = 15_000) =>
  (await waitFor(async () => ((await stageOf(planId, m)) === stage ? true : undefined), ms)) === true;
const waitPlan = async (planId: string, state: string, ms = 60_000) =>
  (await waitFor(async () => ((await getPlan(planId))?.state === state ? true : undefined), ms)) === true;

const sse = openSse();
const planEvents = (planId: string) => sse.events.map((e) => e.data).filter((e) => "plan_id" in e && e.plan_id === planId);
const trail = (planId: string) => planEvents(planId).flatMap((e) => (e.type === "plan.state" ? [`${e.from}>${e.to}`] : []));
const laneTrail = (planId: string, name: string) =>
  planEvents(planId).flatMap((e) => (e.type === "lane" && e.first_name === name ? [e.stage] : []));

const JOIN_BODY = (code: string, m: Member, budget?: Budget) => ({
  code, phone_e164: m.phone, first_name: m.name, consent: true,
  ...(budget && { budget_usd: { target: budget.target, hard_max: budget.max } }),
});
/** POST /join, then resolve the member's ids from the DB. */
async function joinForm(code: string, m: Member, withBudget = false): Promise<void> {
  const r = await json<{ assigned_number: string; sms_href: string; join_text: string }>("/join", post(JOIN_BODY(code, m, withBudget ? m.budget : undefined)));
  check(r.status === 200 && r.body.join_text === `JOIN ${code}` && r.body.sms_href.startsWith("sms:") && r.body.sms_href.includes(encodeURIComponent(`JOIN ${code}`)), `${m.name}: POST /join → 200 with sms link`);
  const user = await findUserByPhone(m.phone);
  m.userId = user?.id ?? "";
  m.payerRef = user?.payer_ref ?? "";
}
async function createPlan(title: string, party: number, organizer: Member): Promise<{ code: string; planId: string }> {
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  const r = await json<{ code: string; join_url: string; qr_svg: string }>("/plans", post({
    title, area: "Westwood / Sawtelle", date: tomorrow, time_start: "18:30", time_end: "23:00", party_target: party,
    organizer: { phone_e164: organizer.phone, first_name: organizer.name },
  }));
  const plan = await getPlanByCode(r.body.code ?? "");
  check(r.status === 200 && /^\d{4}$/.test(r.body.code) && r.body.join_url.endsWith(`/j/${r.body.code}`) && r.body.qr_svg.includes("<svg"), `POST /plans → code ${r.body.code}, join url, QR`);
  check(plan?.state === "COLLECTING" && plan.party_target === party, `plan is COLLECTING for ${party}`);
  return { code: r.body.code, planId: plan?.id ?? "" };
}

/** The mock venue's order for a plan, with each share mapped to its member by payer_ref. */
async function orderOf(planId: string, members: readonly Member[]) {
  const orderId = (await getPlan(planId))?.venue_order_id;
  if (!orderId) return null;
  const order = await ports.venue.getOrder(orderId);
  return { order, shareOf: (m: Member) => order.shares.find((s) => s.payer_ref === m.payerRef), members };
}
async function authorize(m: Member, shareId: string): Promise<void> {
  const r = await json<{ ok: boolean; hook_status: number | null }>(`/dev/venue/authorize/${shareId}`, post({}));
  check(r.status === 200 && r.body.hook_status === 200, `${m.name}: mock venue authorizes the hold; /venue/hook accepts it`);
}

// ---------- scenarios ----------

async function infra(): Promise<void> {
  console.log("\ninfra");
  check((await fetch(`${base}/healthz`)).status === 200, "GET /healthz");
  check((await fetch(`${base}/events`)).status === 401, "GET /events without CONSOLE_KEY → 401");
  const snap = await json<{ last_id: number }>(`/events/snapshot?k=${CONSOLE_KEY}`);
  check(snap.status === 200, `GET /events/snapshot (last_id ${snap.body.last_id})`);

  // A stranger texting the shared line is told to use a join link, and the message is marked read.
  // 0000-0099 is never given to a member (those use 0100-0199), and an unknown sender never gets a user row.
  const strangerPhone = `+1310555${String(randomInt(100)).padStart(4, "0")}`;
  const stranger = { ...member("Stranger", { target: 0, max: 0 }), phone: strangerPhone, space: `mock_spc_${strangerPhone.replace(/\D/g, "")}` };
  const from = await mark();
  const strangerMsg = await dm(stranger, "hello?");
  const hit = await waitFor(async () => (await pull(), sent.slice(from).find((e) => e.to.spaceId === stranger.space && e.text === COPY.T_NOT_IN_PLAN)), 8_000);
  check(hit !== undefined, "unknown sender → T_NOT_IN_PLAN");
  const read = (await json<{ entries: { kind: string; messageId?: string }[] }>("/dev/outbox?since=0")).body.entries;
  check(read.some((e) => e.kind === "read" && e.messageId === strangerMsg), "inbound DM marked read");

  // due_jobs: enqueue → poller claims → handler emits → SSE.
  registerJob("sim.ping", async (job) => void (await emit({ type: "system", level: "info", msg: `sim job ${job.dedupe_key}` })));
  check(await enqueue("sim.ping", `sim:${run}`, new Date()), "enqueue sim.ping");
  check(!(await enqueue("sim.ping", `sim:${run}`, new Date())), "duplicate enqueue ignored");
  check((await sse.find(isSystem(`sim job sim:${run}`))) !== undefined, "poller ran the job; its event arrived over SSE");

  // LLMPort mock.
  const budget = await ports.llm.parseBudget({ user_first_name: "Sim", stage: "budget", message_text: "honestly 30 tops tonight" });
  check(budget.target_pp_cents === 3000 && budget.hard_max_pp_cents === 3000, "LLMPort.parseBudget (mock)");

  // PlannerPort mock: both Scout runs complete with valid submissions; progress reaches SSE.
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

  // VenuePort mock: order → holds → tamper rejected → commit captured.
  const [dinner, show] = await Promise.all([loadCachedOptions("dinner"), loadCachedOptions("show")]);
  const d = dinner.options[0]!;
  const s = show.options.find((o): o is Extract<typeof o, { category: "show" }> => o.category === "show")!;
  const payerRefs = [1, 2, 3].map(() => randomBytes(16).toString("hex"));
  const order = await ports.venue.createOrder({
    plan_ref: planRef, plan_version: 1, party_size: 3, deadline_at: new Date(Date.now() + 600_000).toISOString(), payer_refs: payerRefs,
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
}

/** Every member's budget DM text, to prove none of them ever reaches SSE. */
const privateTexts: string[] = [];
const allMembers: Member[] = [];

async function happyPath(): Promise<void> {
  console.log("\nhappy path: create → join → budgets → prefs → research → vote → order → holds → CONFIRMED");
  const A = member("Alice", { target: 100, max: 140 });
  const B = member("Bruno", { target: 110, max: 150 });
  const C = member("Carmen", { target: 500, max: 500 }); // replaced by the no-cap tier; never rendered
  const D = member("Dmitri", { target: 100, max: 135 }); // budget given on the join form
  const team = [A, B, C, D];
  allMembers.push(...team);
  const { code, planId } = await createPlan(`Sim night ${run}`, 4, A);

  // Join form (the QR landing page): invalid and unknown requests are rejected before any write.
  const bad = await json<{ error: string }>("/join", post({ ...JOIN_BODY(code, A), consent: false }));
  check(bad.status === 422 && bad.body.error === "invalid", "POST /join without consent → 422");
  let unknown = "0000";
  while (await getPlanByCode(unknown)) unknown = String(randomInt(10_000)).padStart(4, "0");
  const nf = await json<{ error: string }>("/join", post(JOIN_BODY(unknown, A)));
  check(nf.status === 404 && nf.body.error === "not_found", "POST /join with an unknown code → 404");
  for (const m of team) await joinForm(code, m, m === D);
  const plan0 = await getPlan(planId);
  const invited = await Promise.all(team.map((m) => stageOf(planId, m)));
  check(invited.every((s) => s === "INVITED") && team.every((m) => m.userId !== ""), "4 participants INVITED after the join form");
  for (const m of team) m.lane = (await getParticipant(planId, m.userId))?.lane ?? 0;
  check(new Set(team.map((m) => m.lane)).size === 4, "each participant has its own lane");
  check(plan0?.state === "COLLECTING", "plan still COLLECTING");

  // JOIN texts open the DM thread. D already gave a budget on the form, so skips the budget question.
  for (const m of [A, B, C]) {
    await say(m, `JOIN ${code}`, "T_JOIN_WELCOME", "JOIN → T_JOIN_WELCOME");
    check((await got(m, "T_BUDGET_ASK", 0)) !== undefined && (await stageOf(planId, m)) === "JOINED", `${m.name}: asked for a budget, lane JOINED`);
  }
  await say(D, `JOIN ${code}`, "T_JOIN_WELCOME", "JOIN → T_JOIN_WELCOME");
  const dForm = await got(D, "T_BUDGET_CONFIRM", 0);
  check(dForm?.text === ownLine(D.budget) && (await got(D, "T_PREFS_ASK", 0)) !== undefined, `${D.name}: form budget confirmed back privately, then asked for preferences`);
  check(await waitStage(planId, D, "BUDGET_LOCKED"), `${D.name}: BUDGET_LOCKED straight from the form`);

  // Budgets over DM: a number and a ceiling, a number range, and an unparseable reply that falls back to tiers.
  const aText = "aiming for 100, 140 tops";
  const bText = "110 to 150";
  privateTexts.push(aText, bText);
  const a = await say(A, aText, "T_BUDGET_CONFIRM", "budget DM → T_BUDGET_CONFIRM");
  check(a?.text === ownLine(A.budget), `${A.name}: confirmation echoes only her own budget`);
  const b = await say(B, bText, "T_BUDGET_CONFIRM", "budget DM → T_BUDGET_CONFIRM");
  check(b?.text === ownLine(B.budget), `${B.name}: confirmation echoes only his own budget`);
  await say(C, "no idea honestly", "T_BUDGET_TIERS", "unclear budget → T_BUDGET_TIERS");
  await say(C, "4", "T_BUDGET_CONFIRM_NOCAP", "tier 4 → T_BUDGET_CONFIRM_NOCAP");
  for (const m of [A, B, C]) check(await waitStage(planId, m, "BUDGET_LOCKED"), `${m.name}: BUDGET_LOCKED`);
  check([A, B, C].every((m) => textsTo(m, "T_PREFS_ASK").length >= 1), "everyone asked for preferences after their budget");

  // Preferences. The plan waits for all four (party_target) before researching.
  const prefs: [Member, string][] = [
    [A, "love thai or ramen, casual vibe"],
    [B, "italian please, lively, nothing after 11pm"],
    [C, "no sushi, I'm easy"],
  ];
  for (const [m, text] of prefs) {
    privateTexts.push(text);
    await dm(m, text);
    check(await waitStage(planId, m, "PREFS_DONE"), `${m.name}: prefs → PREFS_DONE`);
  }
  check((await getPlan(planId))?.state === "COLLECTING", "3 of 4 ready: plan still COLLECTING");

  // Privacy: asking for another member's budget is refused with the fixed template, threaded under the question.
  const mark1 = await mark();
  const askId = await dm(C, `what's ${A.name}'s budget?`);
  const refusal = await got(C, "T_ONLY_YOURS", mark1);
  check(refusal?.text === COPY.T_ONLY_YOURS && refusal.replyTo === askId, `${C.name} asks for ${A.name}'s budget → T_ONLY_YOURS (threaded)`);

  // The fourth ready member starts research.
  privateTexts.push("mexican tacos, casual");
  await dm(D, "mexican tacos, casual");
  check(await waitStage(planId, D, "PREFS_DONE"), `${D.name}: prefs → PREFS_DONE`);
  check((await sse.find((e) => e.type === "plan.state" && e.plan_id === planId && e.to === "RESEARCHING", 10_000)) !== undefined, "all 4 ready → RESEARCHING (automatic, no GO needed)");

  // Cached research → shortlist.
  check(await waitPlan(planId, "VOTING"), "cached Scout results in → VOTING");
  const scouts = await listRunsForPlan(planId, { kind: "scout" });
  check(scouts.length === 2 && scouts.every((r) => r.status === "completed" && r.source === "cached"), "2 Scout runs (dinner, show) completed from cached fixtures");
  check((await listOptions(planId)).length >= 12, "options stored for both categories");
  for (const category of ["dinner", "show"] as const) {
    check(
      (await sse.find((e) => e.type === "creao.run" && e.kind === "scout" && e.category === category && e.status === "completed" && e.source === "cached")) !== undefined,
      `console sees the ${category} Scout run complete (cached)`,
    );
  }
  const xrayNames = sse.events.flatMap((e) => (e.data.type === "xray" ? e.data.contexts : []));
  check(xrayNames.some((c) => c.name === "scout_input:dinner") && xrayNames.some((c) => c.name === "scout_input:show"), "X-ray shows both Scout inputs");

  const vPlan = (await getPlan(planId))!;
  const shortlist = await getShortlist(planId, vPlan.version);
  const shortEvent = planEvents(planId).find((e) => e.type === "shortlist");
  check(shortlist.length === 3 && shortEvent?.type === "shortlist" && shortEvent.bundles.length === 3 && same(shortEvent.bundles.map((x) => x.id), shortlist.map((x) => x.id)), "3 bundles stored and announced on the console");
  const cap = Math.min(A.budget.max, B.budget.max, D.budget.max) * 100;
  check(shortlist.every((x) => x.all_in_pp_cents <= cap), "every pick fits the lowest hard max in the group (checked here from known inputs)");
  check(shortEvent?.type === "shortlist" && shortEvent.survived_count >= 3 && shortEvent.survived_count <= shortEvent.from_count, "shortlist event carries from/survived counts");
  const bundleIds = new Set(shortlist.map((x) => x.id));
  check(new Set(shortlist.map((x) => x.dinner.id)).size === 3 && new Set(shortlist.map((x) => x.show.id)).size === 3, "the 3 picks share no dinner or show");
  for (const m of team) {
    const picks = await got(m, "T_PICKS", 0);
    check(picks !== undefined && picks.text.includes(shortlist[0]!.dinner.data.name) && picks.text.includes(`$${Math.floor(shortlist[0]!.all_in_pp_cents / 100)} pp all-in`), `${m.name}: T_PICKS lists the shortlist with all-in prices`);
  }

  // Privacy again, now in the voting thread (free text goes through the ballot delegate).
  const mark2 = await mark();
  await dm(B, "how much can everyone afford?");
  check((await got(B, "T_ONLY_YOURS", mark2)) !== undefined, `${B.name} asks what everyone can afford → T_ONLY_YOURS`);
  check((await getPlan(planId))?.state === "VOTING" && (await stageOf(planId, B)) === "PREFS_DONE", "a refused question casts no vote");

  // Ballots: digits and free text. Everyone approves #1, so #1 must win.
  await dm(A, "1 2");
  check(await waitStage(planId, A, "VOTED"), `${A.name}: digits ballot → VOTED`);
  await dm(B, "1");
  check(await waitStage(planId, B, "VOTED"), `${B.name}: digits ballot → VOTED`);
  const cText = "option 1 sounds great";
  privateTexts.push(cText);
  await dm(C, cText);
  check(await waitStage(planId, C, "VOTED"), `${C.name}: free-text ballot (delegate) → VOTED`);
  check((await getPlan(planId))?.state === "VOTING", "3 of 4 voted: still VOTING");
  await dm(D, "1 3");
  check((await sse.find((e) => e.type === "plan.state" && e.plan_id === planId && e.to === "ORDERING", 15_000)) !== undefined, "last ballot closes the vote early → ORDERING");
  await waitFor(() => (planEvents(planId).filter((e) => e.type === "vote.tally").length >= 4 ? true : undefined), 5_000);
  const voted = planEvents(planId).flatMap((e) => (e.type === "vote.tally" ? [e.voted] : []));
  check(same(voted, [1, 2, 3, 4]) && planEvents(planId).every((e) => e.type !== "vote.tally" || e.total === 4), "vote.tally events count 1, 2, 3, 4 of 4");
  check((await got(A, "T_VOTE_TALLY", 0, 4)) !== undefined, "voters get 'k of n voted' texts, counts only");

  const chosen = (await getPlan(planId))?.chosen_bundle_id;
  check(chosen === shortlist[0]!.id && bundleIds.has(chosen ?? ""), "unanimous pick #1 is the chosen bundle");
  const title = bundleTitle(shortlist[0]!);
  for (const m of team) check((await got(m, "T_WINNER", 0))?.text === fill("T_WINNER", { title }), `${m.name}: T_WINNER names the winning plan`);

  // Order → hold gate → pay links.
  check(await waitPlan(planId, "APPROVING", 30_000), "create_order job ran → APPROVING");
  const o = await orderOf(planId, team);
  const price = shortlist[0]!.all_in_pp_cents;
  check(o !== null && o.order.status === "OPEN" && o.order.shares.length === 4 && o.order.shares.every((s) => s.amount_cents === price && s.status === "PENDING"), "venue order OPEN: 4 shares at the bundle's all-in price, all PENDING");
  check(o !== null && team.every((m) => o.shareOf(m) !== undefined), "each share maps to one member by payer_ref only");
  const links = new Map<string, string>();
  for (const m of team) {
    const t = await got(m, "T_PAY_LINK", 0);
    const url = t && /(https?:\/\/\S+)/.exec(t.text)?.[1];
    if (url) links.set(m.name, url);
    check(t !== undefined && t.text.includes(`$${usd2(price)}`) && t.text.includes(title) && /^https:\/\/mock-venue\.invalid\/pay\//.test(url ?? ""), `${m.name}: T_PAY_LINK with their share and a hold link`);
    check(await waitStage(planId, m, "LINK_SENT"), `${m.name}: LINK_SENT`);
  }
  check(new Set(links.values()).size === 4, "each pay link is unique");

  // holdGate: D lowers their limit below the share. The link stops being safe to use until D says YES, privately.
  await say(D, "change budget", "T_BUDGET_ASK", "'change budget' → T_BUDGET_ASK");
  const mark3 = await mark();
  await dm(D, "20");
  const gate = await got(D, "T_HOLD_GATE", mark3);
  check(gate?.text === fill("T_HOLD_GATE", { amount: usd2(price) }), `${D.name}: share is above the new limit → T_HOLD_GATE asks privately (amount only)`);
  check(await waitStage(planId, D, "GATED"), `${D.name}: lane GATED`);
  check((await getHoldGate(planId, D.userId, vPlan.version))?.status === "pending", "hold gate row is pending");
  const mark4 = await mark();
  await dm(D, "hmm maybe");
  check((await got(D, "T_HOLD_GATE", mark4)) !== undefined, `${D.name}: an unclear reply repeats the question`);
  const mark5 = await mark();
  await dm(D, "YES");
  const relink = await got(D, "T_PAY_LINK", mark5);
  check(relink !== undefined && /(https?:\/\/\S+)/.exec(relink.text)?.[1] === links.get(D.name), `${D.name}: YES → the same pay link is sent`);
  check(await waitStage(planId, D, "LINK_SENT"), `${D.name}: back to LINK_SENT`);
  check((await getHoldGate(planId, D.userId, vPlan.version))?.status === "approved", "hold gate row approved");
  check(textsTo(A, "T_HOLD_GATE").length === 0, "nobody else was asked anything about money");
  check(!planEvents(planId).some((e) => e.type === "lane" && e.stage === "GATED"), "the console never sees GATED (P8: a share above someone's max stays private)");

  // The mock venue authorizes every hold. Nothing is captured until the last one lands.
  for (const [i, m] of team.entries()) {
    const share = o?.shareOf(m);
    if (!share) continue;
    if (i === team.length - 1) {
      await sleep(5_000); // two poller ticks: a premature commit would have happened by now
      const mid = await ports.venue.getOrder(o!.order.order_id);
      check((await getPlan(planId))?.state === "APPROVING" && mid.status === "OPEN" && mid.shares.filter((s) => s.status === "AUTHORIZED").length === 3, "3 of 4 held: still APPROVING, nothing captured");
    }
    await authorize(m, share.share_id);
    check(await waitStage(planId, m, "HELD"), `${m.name}: HELD`);
    const held = await got(m, "T_HELD", 0);
    check(held?.text === fill("T_HELD", { amount: usd2(price), brand: "Visa", last4: "1111" }), `${m.name}: T_HELD (brand and last4 from the venue)`);
  }
  check((await got(A, "T_IN_COUNT", 0, 4))?.text === fill("T_IN_COUNT", { k: 4, n: 4 }), "'4 of 4 are in' went to the group");

  // Commit → CONFIRMED → Concierge.
  check(await waitPlan(planId, "CONFIRMED", 45_000), "all holds in → commit job → CONFIRMED");
  const done = o ? await ports.venue.getOrder(o.order.order_id) : null;
  check(done?.status === "CAPTURED" && done.shares.length === 4 && done.shares.every((s) => s.status === "CAPTURED"), "venue order CAPTURED, every share CAPTURED");
  for (const m of team) check((await got(m, "T_CAPTURED", 0))?.text === fill("T_CAPTURED", { title, amount: usd2(price) }), `${m.name}: T_CAPTURED with exactly their share`);
  const concierge = await waitFor(async () => {
    const rows = await listRunsForPlan(planId, { kind: "concierge" });
    return rows.length ? rows : undefined;
  }, 15_000);
  check(concierge?.length === 1, "Concierge run started after CONFIRMED (exactly one)");
  await waitFor(() => (trail(planId).includes("COMMITTING>CONFIRMED") ? true : undefined), 5_000);
  check(same(trail(planId), ["COLLECTING>RESEARCHING", "RESEARCHING>VOTING", "VOTING>ORDERING", "ORDERING>APPROVING", "APPROVING>COMMITTING", "COMMITTING>CONFIRMED"]), "plan.state events: the exact happy-path chain over SSE");
  const base5 = ["INVITED", "JOINED", "BUDGET_LOCKED", "PREFS_DONE", "VOTED", "LINK_SENT", "HELD"];
  for (const m of [A, B, C]) check(same(laneTrail(planId, m.name), base5), `${m.name}: lane events ${base5.join(" → ")}`);
  check(same(laneTrail(planId, D.name), ["INVITED", "JOINED", "BUDGET_LOCKED", "PREFS_DONE", "VOTED", "LINK_SENT", "GATED", "LINK_SENT", "HELD"]), `${D.name}: lane events include the hold-gate detour`);
  check(planEvents(planId).some((e) => e.type === "lane" && e.stage === "HELD" && e.amount_cents === price), "HELD lane events carry the (public) share amount");

  // The Concierge (mock planner) finishes in ~20 s: its fallback itinerary must reach every member.
  pendingItinerary = Promise.all(team.map((m) => got(m, "T_ITINERARY", 0, 1, 60_000))).then(async (all) => {
    check(all.every((t) => t !== undefined && /\/p\/[0-9a-f-]{36}\/itinerary/.test(t.text)), "Concierge delivered T_ITINERARY (itinerary + calendar links) to all 4");
    check((await sse.find((e) => e.type === "creao.run" && e.kind === "concierge" && e.status === "completed", 10_000)) !== undefined, "console sees the Concierge run complete");
  });
}
let pendingItinerary: Promise<void> = Promise.resolve();

async function declinePath(): Promise<void> {
  console.log("\ndecline path: 'I'm out' once holds exist → everything released, nobody named");
  const E = member("Erin", { target: 90, max: 125 });
  const F = member("Felix", { target: 95, max: 130 });
  const G = member("Gwen", { target: 105, max: 145 });
  const team = [E, F, G];
  allMembers.push(...team);
  const { code, planId } = await createPlan(`Sim decline ${run}`, 3, E);
  for (const m of team) await joinForm(code, m, true);
  for (const m of team) {
    await dm(m, `JOIN ${code}`);
    check(await waitStage(planId, m, "BUDGET_LOCKED"), `${m.name}: JOIN text + form budget → BUDGET_LOCKED`);
  }
  for (const m of team) {
    await dm(m, "thai or italian is great");
    check(await waitStage(planId, m, "PREFS_DONE"), `${m.name}: PREFS_DONE`);
  }
  check(await waitPlan(planId, "VOTING"), "3 of 3 ready → research → VOTING");
  for (const m of team) {
    await dm(m, "1");
    check(await waitStage(planId, m, "VOTED"), `${m.name}: VOTED`);
  }
  check(await waitPlan(planId, "APPROVING", 45_000), "vote closed → order → APPROVING");
  const o = await orderOf(planId, team);
  check(o !== null && o.order.shares.length === 3, "venue order has 3 shares");
  for (const m of team) check(await waitStage(planId, m, "LINK_SENT"), `${m.name}: pay link sent`);
  const orderId = o?.order.order_id ?? "";

  // Erin and Felix put their holds up; Gwen has not paid yet and bows out.
  for (const m of [E, F]) {
    const share = o?.shareOf(m);
    if (share) await authorize(m, share.share_id);
    check(await waitStage(planId, m, "HELD"), `${m.name}: HELD`);
  }
  for (const m of [E, F]) await got(m, "T_IN_COUNT", 0, 2); // let the hold texts land before the 'out'
  const before = await mark();
  const outMsg = await dm(G, "I'm out");
  const ack = await got(G, "T_OUT_ACK", before);
  check(ack !== undefined && ack.replyTo === outMsg && isTpl(ack.text, "T_OUT_ACK"), `${G.name}: 'I'm out' → T_OUT_ACK (threaded)`);
  check(await waitPlan(planId, "CANCELLED", 30_000), "plan CANCELLED");
  const after = orderId ? await ports.venue.getOrder(orderId) : null;
  check(after?.status === "CANCELLED", "venue order CANCELLED");
  check(after?.shares.length === 3 && after.shares.every((s) => s.status === "RELEASED" || s.status === "VOID"), "every hold released (authorized → RELEASED, unpaid → VOID)");
  check(after?.shares.filter((s) => s.status === "RELEASED").length === 2, "the two real holds were RELEASED");
  for (const m of [E, F]) {
    const c = await got(m, "T_CANCELLED", before);
    check(c?.text === COPY.T_CANCELLED, `${m.name}: T_CANCELLED (no names, no reason)`);
  }
  check(textsTo(G, "T_CANCELLED", before).length === 0, `${G.name} (who left) gets only her own ack`);
  const sinceOut = sent.slice(before).filter((t) => team.some((m) => m.space === t.to.spaceId));
  check(
    sinceOut.every((t) => !team.some((m) => t.text.includes(m.name))) && sinceOut.filter((t) => t.to.spaceId !== G.space).every((t) => t.text === COPY.T_CANCELLED),
    "after the 'out', the others only receive the group T_CANCELLED: nobody named",
  );
  check(team.every((m) => textsTo(m, "T_CAPTURED").length === 0), "nobody was told they were charged");
  const t = trail(planId);
  check(same(t, ["COLLECTING>RESEARCHING", "RESEARCHING>VOTING", "VOTING>ORDERING", "ORDERING>APPROVING", "APPROVING>CANCELLING", "CANCELLING>CANCELLED"]), "plan.state events: …APPROVING → CANCELLING → CANCELLED, never COMMITTING");
  check((await stageOf(planId, G)) === "DECLINED" && planEvents(planId).some((e) => e.type === "lane" && e.first_name === G.name && e.stage === "DECLINED"), `${G.name}'s lane is DECLINED`);
}

/** Invariants over the whole run: what was sent, what the console saw. */
async function invariants(): Promise<void> {
  console.log("\nprivacy invariants (whole run)");
  await pull();
  const texts = sent.filter((e) => allMembers.some((m) => m.space === e.to.spaceId));
  check(texts.length > 0 && texts.every((e) => TEMPLATES.some((id) => isTpl(e.text, id))), `all ${texts.length} texts sent to members are fixed templates (no free-form LLM text)`);
  check(texts.every((e) => !allMembers.some((m) => e.text.includes(m.name))), "no text to anyone contains any member's name");
  const lines = allMembers.filter((m) => m.budget.target !== 500).map((m) => [m, ownLine(m.budget)] as const);
  check(lines.every(([m, line]) => sent.filter((e) => e.text === line).every((e) => e.to.spaceId === m.space)), "each budget confirmation went only to its owner");
  const blob = JSON.stringify(sse.events.map((e) => e.data));
  const leaks = ["mock-venue.invalid", "hard_max", "target_pp", ...allMembers.map((m) => m.phone), ...privateTexts].filter((s) => blob.includes(s));
  check(leaks.length === 0, `SSE never carried a pay URL, a budget field, a phone number or any DM text${leaks.length ? ` (found ${leaks.length})` : ""}`);
  const delegates = sse.events.flatMap((e) => (e.data.type === "xray" ? e.data.contexts.filter((c) => c.name.startsWith("delegate:")) : []));
  check(delegates.length > 0 && delegates.every((c) => c.locked && c.preview === null), "X-ray shows delegate contexts as locked, with no preview");
  const scoutPreviews = sse.events.flatMap((e) => (e.data.type === "xray" ? e.data.contexts.filter((c) => c.name.startsWith("scout_input:")) : []));
  check(scoutPreviews.every((c) => !c.locked && !allMembers.some((m) => (c.preview ?? "").includes(m.name) || (c.preview ?? "").includes(m.phone))), "Scout inputs on the X-ray carry no names or phone numbers");
}

async function replay(): Promise<void> {
  console.log("\nSSE reconnect");
  const baselineSubs = subscriberCount() - 1;
  const lastSeen = Math.max(...sse.events.map((e) => e.id)); // ids can commit out of order
  sse.close();
  check((await waitFor(() => (subscriberCount() === baselineSubs ? true : undefined), 3_000)) === true, "SSE disconnect releases its subscription");
  // Reconnect only once the event has been broadcast in-process; otherwise the replay query and the late NOTIFY both deliver it.
  const broadcast = new Promise<void>((resolve) => {
    const off = subscribe((e) => e.data.type === "system" && e.data.msg.includes(`sim replay ${run}`) && (off(), resolve()));
  });
  await emit({ type: "system", level: "info", msg: `sim replay ${run}` });
  await Promise.race([broadcast, sleep(3_000)]);
  const again = openSse(lastSeen);
  await again.opened;
  check((await again.find(isSystem(`sim replay ${run}`))) !== undefined, "Last-Event-ID replay delivered the missed event");
  check(new Set(again.events.map((e) => e.id)).size === again.events.length && again.events.every((e) => e.id > lastSeen), "replay sent each id once, all after Last-Event-ID");
  again.close();
}

const t0 = Date.now();
try {
  console.log(`sim:plan → ${base} (messaging, LLM, planner=cached, venue all mocked; db ${dbHost})`);
  const baselineSubs = subscriberCount();
  await sse.opened;
  check(subscriberCount() > baselineSubs || (await waitFor(() => (subscriberCount() > baselineSubs ? true : undefined), 2_000)) === true, "SSE connected");
  await infra();
  await happyPath();
  await declinePath();
  await pendingItinerary;
  await invariants();
  await replay();
} catch (e) {
  check(false, `crashed: ${e instanceof Error ? `${e.name}: ${e.message}` : "unknown error"}`);
}

await agent.stop();
console.log(`\n${failures ? `sim:plan FAILED (${failures} of ${checks} checks)` : `sim:plan passed (${checks} checks)`} in ${Math.round((Date.now() - t0) / 1000)}s`);
process.exit(failures ? 1 : 0);
