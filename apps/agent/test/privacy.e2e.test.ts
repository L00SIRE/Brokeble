// P7 (PLAN §4, B plan T13; never cut): value-specific payload test. A full mocked plan (join → budgets → prefs → research
// → vote → order → holds → commit → itinerary) runs through the real app, poller and Postgres with every port wrapped by a
// recorder. Four members have distinctive budgets; each value, in every spelling, may appear ONLY in that member's own
// delegate calls and in outbound texts to that member. It must appear in no other delegate call, no rate/repair input,
// no planner input, no fan-out text, no event row, no SSE frame, no log line, no venue request and no other table.
// P1 grep covers test/**: this file never imports the private-constraints module and never names its SQL table.
// DB-gated like the other integration tests: set TEST_DATABASE_URL (a throwaway Postgres with db/migrations applied).
import type { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { LLMPort, PlannerPort } from "../src/ports";
import { COPY, TemplateId } from "@tab/shared/templates";
import { priceBundle } from "@tab/shared/pricing";

// Logs go to a capture stream (real redaction config), at debug so nothing a handler logs is hidden from the test.
const captured = vi.hoisted(() => ({ logs: [] as string[] }));
vi.mock("../src/log", async (orig) => {
  const real = await orig<typeof import("../src/log")>();
  const { Writable } = await import("node:stream");
  const sink = new Writable({
    write(chunk, _enc, cb) {
      captured.logs.push(String(chunk));
      cb();
    },
  });
  return { ...real, log: real.createLogger(sink) };
});
Object.assign(process.env, {
  LOG_LEVEL: "debug",
  PUBLIC_BASE_URL: "http://127.0.0.1:8080",
  PAYER_REF_SECRET: "privacy-e2e-payer-ref-secret-0123456789",
  VENUE_HOOK_SECRET: "privacy-e2e-venue-hook-secret-0123456789",
});

// ───────────────────────────── the cast ─────────────────────────────
type Budget = { first: string; say: string; target: number; max: number | null; effMax: number };
/** Cents. L3 gave no ceiling, so its effective max is round(6343 × 1.10) (HARD_MAX_SLACK). */
const BUDGETS: readonly Budget[] = [
  { first: "Lia", say: "I'm good with $31.17, but never more than $40.00", target: 3117, max: 4000, effMax: 4000 },
  { first: "Mo", say: "$47.29 is ideal, $52.11 is my hard limit", target: 4729, max: 5211, effMax: 5211 },
  { first: "Nat", say: "around $63.43 works for me", target: 6343, max: null, effMax: Math.round(6343 * 1.1) },
  { first: "Ori", say: "$88.61 target and $91.03 max", target: 8861, max: 9103, effMax: 9103 },
];
const PREFS = ["love tacos and ramen, keep it casual", "italian sounds great, a lively spot", "nothing fancy, no sushi please", "happy with anything, vegetarian friendly"];
const PLAN = { title: "Dinner + show", area: "Westwood / Sawtelle", date: "2026-10-18", time_start: "18:30", time_end: "23:00" };

/** Fixture rewrite: prices are chosen so that no bundle's all-in dollars equal any tested value (a price would be a false positive). */
export const TEST_DINNER_USD = [6, 8, 9, 11, 21, 29] as const;
export const TEST_SHOW_USD = [7, 10, 12, 14, 26, 39] as const;
const SHOW_START = ["20:00", "20:15", "20:30", "20:30", "20:45", "21:00"] as const;
const endOf = (start: string) => {
  const [h, m] = start.split(":").map(Number) as [number, number];
  const t = h * 60 + m + 90;
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
};

// ───────────────────── value detector (shared by tests and helpers) ─────────────────────
const FORBIDDEN_DOLLARS = [31, 40, 47, 52, 63, 69, 88, 91];
/** Every way a value could be spelled: cents, 31.17, $31.17, and the floored whole dollars (word-boundary guarded). */
export function formsOf(cents: number): { name: string; re: RegExp }[] {
  const dollars = Math.floor(cents / 100);
  const dec = (cents / 100).toFixed(2);
  return [
    { name: `${cents}`, re: new RegExp(`(?<![\\w.-])${cents}(?![\\w.-])`) },
    { name: dec, re: new RegExp(`(?<![\\d.:])${dec.replace(".", "\\.")}(?!\\d)`) },
    { name: `$${dollars}`, re: new RegExp(`\\$${dollars}(?!\\d|\\.\\d)`) },
  ];
}
const scrub = (s: string) =>
  s
    .replace(/"(?:[a-z_]*_)?(?:ms|id|seq)":\s*\d+/g, '"n":0') // durations and serial ids are plain integers that can collide by chance
    .replace(/^id:\s*\d+$/gm, "id: 0"); // SSE event ids
const valuesOf = (b: Budget): number[] => [b.target, b.effMax];
const allForms = (b: Budget) => valuesOf(b).flatMap(formsOf);
const hits = (text: string, b: Budget): string[] => {
  const t = scrub(text);
  return allForms(b).filter((f) => f.re.test(t)).map((f) => f.name);
};

// ───────────────────────────── preconditions (no DB) ─────────────────────────────
describe("P7 preconditions", () => {
  it("the detector matches every spelling and ignores look-alikes", () => {
    const forms = formsOf(3117);
    const probe = (s: string) => forms.filter((f) => f.re.test(s)).map((f) => f.name);
    expect(probe('{"target_pp_cents":3117}')).toEqual(["3117"]);
    expect(probe("aim ~31.17 per person")).toEqual(["31.17"]);
    expect(probe("budget $31.17!")).toEqual(["31.17"]);
    expect(probe("about $31.")).toEqual(["$31"]);
    expect(probe("costs $31 each")).toEqual(["$31"]);
    expect(probe("$310 or $31.5 or 13117 or 31170 or id-3117-x or 2026-10-17T21:31.17")).toEqual([]);
  });

  it("no composed bundle's all-in price equals any tested value in dollars or cents", () => {
    const prices = TEST_DINNER_USD.flatMap((d) => TEST_SHOW_USD.map((s) => priceBundle({ dinner: { est_high_pp_usd: d }, show: { est_high_pp_usd: s } })));
    const tested = new Set(BUDGETS.flatMap(valuesOf));
    expect(prices.filter((c) => tested.has(c) || FORBIDDEN_DOLLARS.includes(c / 100))).toEqual([]);
    // L1's ceiling is the tightest: enough affordable bundles must survive for a 3-way shortlist.
    expect(new Set(prices.filter((c) => c <= 4000)).size).toBeGreaterThanOrEqual(3);
    expect(new Set(BUDGETS.flatMap(valuesOf).map((c) => Math.floor(c / 100)))).toEqual(new Set(FORBIDDEN_DOLLARS));
  });

  it("static copy (templates, price tiers) never contains a tested value", () => {
    const statics = [...TemplateId.options.map((id) => COPY[id]), "<$25", "$25-50", "$50+", "$25–50", "$25/$50/$80"];
    for (const b of BUDGETS) for (const s of statics) expect(hits(s, b), s).toEqual([]);
  });
});

// ───────────────────────────── the full run ─────────────────────────────
type Call = { method: string; who: string | null; json: string };
type Venue = { method: string; json: string };
type PlannerCall = { method: "startScout" | "startConcierge"; json: string };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until<T>(what: string, f: () => Promise<T | undefined | false> | T | undefined | false, ms = 30_000, onTick?: () => Promise<void>): Promise<T> {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(250)) {
    const v = await f();
    if (v !== undefined && v !== false) return v as T;
    await onTick?.();
  }
  throw new Error(`timed out waiting for: ${what}
${diagnose?.() ?? ""}`);
}
/** Set by the suite: a short, value-free state dump appended to timeouts so a stuck stage is debuggable from CI output. */
let diagnose: (() => string) | undefined;

describe.skipIf(!process.env.TEST_DATABASE_URL)("P7 privacy e2e: budgets never leave their owner's delegate", () => {
  const llmCalls: Call[] = [];
  const plannerCalls: PlannerCall[] = [];
  const venueCalls: Venue[] = [];
  const sseRaw = { text: "" };
  let sse: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let app: Hono;
  let code = "";
  let planId = "";
  const phones = BUDGETS.map((_, i) => `+1${200 + Math.floor(Math.random() * 790)}55501${String(i * 20 + Math.floor(Math.random() * 20)).padStart(2, "0")}`);
  type Outbox = import("../src/ports/messaging.mock").OutboxEntry;
  let outbox: () => Outbox[];
  let eventRows: string[] = [];
  let tableDumps: { table: string; rows: string[] }[] = [];
  let budgetTables: string[] = [];
  const inboundIds: string[] = [];
  let teardown: (() => Promise<void>) | undefined;
  let q: typeof import("../src/db").sql;

  const digits = (i: number) => phones[i]!.replace(/\D/g, "");
  const textsTo = (i: number) => outbox().filter((e): e is Extract<Outbox, { kind: "text" }> => e.kind === "text" && e.to.spaceId === `mock_spc_${digits(i)}`);
  const ownerOf = (e: Extract<Outbox, { kind: "text" }>): number | null => {
    const i = phones.findIndex((_, k) => e.to.spaceId === `mock_spc_${digits(k)}`);
    return i >= 0 ? i : null;
  };
  async function dm(i: number, text: string): Promise<string> {
    const res = await app.request("/dev/inbound", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ from_handle: phones[i], text }) });
    expect(res.status).toBe(200);
    return ((await res.json()) as { message_id: string }).message_id;
  }
  const planState = async () => (await q<{ state: string }[]>`select state from app.plans where id = ${planId}`)[0]?.state;
  const pullPollsForward = async () => void (await q`update app.due_jobs set due_at = now() where done_at is null and kind = 'creao_poll' and due_at > now()`);
  diagnose = () => {
    const sent = outbox().flatMap((e) => (e.kind === "text" ? [`${ownerOf(e) ?? "?"}:${e.text.slice(0, 28)}`] : []));
    const bad = captured.logs.filter((l) => /"level":(40|50|60)/.test(l)).slice(-6).map((l) => l.slice(0, 220));
    return `texts: ${JSON.stringify(sent.slice(-12))}
warn/error logs: ${JSON.stringify(bad)}`;
  };
  const gotText = (i: number, re: RegExp) => textsTo(i).some((e) => re.test(e.text));

  beforeAll(async () => {
    const [{ createApp }, { sql }, { createPoller }, { startEventBroadcaster }, { ports }, { route }, { dispatchVenueEvent }, { loadCachedOptions }, { MockVenue }] = await Promise.all([
      import("../src/app"),
      import("../src/db"),
      import("../src/dueJobs"),
      import("../src/events"),
      import("../src/ports"),
      import("../src/router/route"),
      import("../src/plan/venueHook"),
      import("../src/ports/cachedOptions"),
      import("../src/ports/venue.mock"),
    ]);
    q = sql;
    const { MockMessaging } = await import("../src/ports/messaging.mock");
    const messaging = ports.messaging;
    const venue = ports.venue;
    if (!(messaging instanceof MockMessaging) || !(venue instanceof MockVenue)) throw new Error("P7 needs MESSAGING_MODE=mock and VENUE_MODE=mock");
    outbox = () => messaging.outbox;

    // ── recorders: wrap the port instances in place, so every module that reads `ports.*` is covered ──
    const llm = ports.llm as unknown as Record<keyof LLMPort, (...a: unknown[]) => Promise<unknown>>;
    for (const method of ["parsePreferences", "parseBallot", "rateBundles", "repairScoutJson"] as const) {
      const orig = llm[method].bind(llm);
      llm[method] = async (...args: unknown[]) => {
        const first = args[0] as { user_first_name?: string };
        llmCalls.push({ method, who: first?.user_first_name ?? null, json: JSON.stringify(args) });
        return orig(...args);
      };
    }
    // Realistic budget parsing: numbers in the message flow into the store (one number → no ceiling).
    llm.parseBudget = async (arg: unknown) => {
      const i = arg as { user_first_name: string; message_text: string };
      llmCalls.push({ method: "parseBudget", who: i.user_first_name, json: JSON.stringify([i]) });
      const n = [...i.message_text.matchAll(/\d+(?:\.\d\d)?/g)].map((m) => Math.round(Number(m[0]) * 100));
      if (n.length === 0) return { target_pp_cents: 0, hard_max_pp_cents: null, confidence: "low" };
      return { target_pp_cents: Math.min(...n), hard_max_pp_cents: n.length > 1 ? Math.max(...n) : null, confidence: "high" };
    };

    const planner = ports.planner as PlannerPort;
    const scouts = new Map<string, { category: "dinner" | "show"; planRef: string }>();
    const origStartScout = planner.startScout.bind(planner);
    const origStartConcierge = planner.startConcierge.bind(planner);
    const origGetRun = planner.getRun.bind(planner);
    planner.startScout = async (planRef, brief, attempt) => {
      plannerCalls.push({ method: "startScout", json: JSON.stringify({ planRef, brief, attempt }) });
      const r = await origStartScout(planRef, brief, attempt); // the mock validates the brief schema too
      scouts.set(r.runId, { category: brief.category, planRef });
      return r;
    };
    planner.startConcierge = async (input) => {
      plannerCalls.push({ method: "startConcierge", json: JSON.stringify(input) });
      return origStartConcierge(input);
    };
    planner.getRun = async (runId) => {
      const s = scouts.get(runId);
      if (!s) return origGetRun(runId); // concierge: the mock completes without an itinerary → the code fallback delivers it
      const { run_id: _r, share_url: _u, captured_at: _c, brief: _b, ...sub } = await loadCachedOptions(s.category, s.planRef);
      const options = sub.options.slice(0, 6).map((o, i) => {
        const base = { ...o, area: PLAN.area, name: `${s.category === "dinner" ? "Dinner" : "Show"} ${"ABCDEF"[i]}` };
        return s.category === "dinner"
          ? { ...base, est_low_pp_usd: TEST_DINNER_USD[i]! - 2, est_high_pp_usd: TEST_DINNER_USD[i]!, opens: "17:00", closes: "23:00" }
          : { ...base, est_low_pp_usd: TEST_SHOW_USD[i]! - 2, est_high_pp_usd: TEST_SHOW_USD[i]!, show_start: SHOW_START[i]!, show_end_est: endOf(SHOW_START[i]!) };
      });
      return { id: runId, status: "completed", result: { text: "```json\n" + JSON.stringify({ ...sub, options }) + "\n```", artifacts: [] } };
    };

    for (const m of ["checkAvailability", "createOrder", "getOrder", "commit", "cancel"] as const) {
      const orig = (venue[m] as (...a: unknown[]) => Promise<unknown>).bind(venue);
      (venue as unknown as Record<string, unknown>)[m] = async (...args: unknown[]) => {
        venueCalls.push({ method: m, json: JSON.stringify(args) });
        return orig(...args);
      };
    }

    // ── boot: broadcaster, app, poller, router; then an SSE client exactly like the console's ──
    const stopBroadcaster = await startEventBroadcaster();
    app = createApp();
    const poller = createPoller({ intervalMs: 300 });
    poller.start();
    await messaging.start(route);
    const baseline = (await q<{ id: string }[]>`select coalesce(max(id), 0)::text as id from app.events`)[0]!.id;
    const ac = new AbortController();
    const res = await app.request(`/events?k=${process.env.CONSOLE_KEY}`, { signal: ac.signal });
    expect(res.status).toBe(200);
    sse = res.body!.getReader();
    void (async () => {
      const dec = new TextDecoder();
      try {
        for (;;) {
          const { value, done } = await sse!.read();
          if (done) return;
          sseRaw.text += dec.decode(value, { stream: true });
        }
      } catch {
        /* closed at teardown */
      }
    })();
    teardown = async () => {
      ac.abort();
      await sse?.cancel().catch(() => {});
      await poller.stop();
      await stopBroadcaster();
      await sql.end({ timeout: 5 });
    };

    // ── 1. plan + joins (the organizer is lane 1) ──
    const created = await app.request("/plans", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: PLAN.title, area: PLAN.area, date: PLAN.date, time_start: PLAN.time_start, time_end: PLAN.time_end, party_target: 4, organizer: { phone_e164: phones[0], first_name: BUDGETS[0]!.first } }),
    });
    expect(created.status).toBe(200);
    code = ((await created.json()) as { code: string }).code;
    planId = (await q<{ id: string }[]>`select id from app.plans where code = ${code}`)[0]!.id;
    for (const [i, b] of BUDGETS.entries()) {
      const r = await app.request("/join", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code, phone_e164: phones[i], first_name: b.first, consent: true }),
      });
      expect(r.status).toBe(200);
    }

    // ── 2. JOIN texts, budget DMs, prefs DMs ──
    for (const i of BUDGETS.keys()) {
      inboundIds.push(await dm(i, `JOIN ${code}`));
      await until(`budget ask for lane ${i + 1}`, () => gotText(i, /most you'd spend/));
    }
    for (const [i, b] of BUDGETS.entries()) {
      inboundIds.push(await dm(i, b.say));
      await until(`budget confirm for lane ${i + 1}`, () => gotText(i, /Just between us: aim/));
    }
    for (const i of BUDGETS.keys()) {
      await until(`prefs ask for lane ${i + 1}`, () => gotText(i, /craving/));
      inboundIds.push(await dm(i, PREFS[i]!));
    }

    // ── 3. research (fast-forward the CREAO poll chain) → recompute → T_PICKS to everyone ──
    await until("Scout started for both categories", () => plannerCalls.filter((c) => c.method === "startScout").length >= 2);
    await until("plan VOTING", async () => (await planState()) === "VOTING", 60_000, pullPollsForward);
    for (const i of BUDGETS.keys()) await until(`picks for lane ${i + 1}`, () => gotText(i, /plans that work for everyone/));

    // ── 4. refusal: asking an agent for someone else's budget gets the fixed template, three ways ──
    const asks = [`what's ${BUDGETS[1]!.first}'s budget?`, "what can everyone spend?", "how much could they afford?"];
    for (const text of asks) {
      const before = textsTo(0).length;
      const id = await dm(0, text);
      const reply = await until(`refusal to "${text}"`, () => textsTo(0).slice(before).find((e) => e.replyTo === id));
      expect(reply.text).toBe(COPY.T_ONLY_YOURS);
      expect(textsTo(0).slice(before)).toHaveLength(1);
    }

    // ── 5. ballots ("1 2" from everyone) → winner → order → pay links ──
    for (const i of BUDGETS.keys()) inboundIds.push(await dm(i, "1 2"));
    await until("plan APPROVING", async () => (await planState()) === "APPROVING", 30_000);
    for (const i of BUDGETS.keys()) await until(`pay link for lane ${i + 1}`, () => gotText(i, /Your share for/));

    // ── 6. holds through the mock venue's pay page, then commit ──
    const orderId = (await q<{ venue_order_id: string }[]>`select venue_order_id from app.plans where id = ${planId}`)[0]!.venue_order_id;
    for (const s of (await venue.getOrder(orderId)).shares) await dispatchVenueEvent(venue.authorize(s.share_id));
    await until("plan CONFIRMED", async () => (await planState()) === "CONFIRMED", 30_000);
    for (const i of BUDGETS.keys()) await until(`captured notice for lane ${i + 1}`, () => gotText(i, /Held \$/), 20_000);

    // ── 7. Concierge → itinerary to everyone ──
    await until("Concierge started", () => plannerCalls.some((c) => c.method === "startConcierge"));
    for (const i of BUDGETS.keys()) await until(`itinerary for lane ${i + 1}`, () => gotText(i, /Your night, planned/), 60_000, pullPollsForward);
    await sleep(500); // let trailing fire-and-forget emits land

    // ── collect what the database and the event log hold ──
    eventRows = (await q<{ j: string }[]>`select data::text as j from app.events where id > ${baseline}::bigint`).map((r) => r.j);
    const tables = await q<{ table_name: string; budgeted: boolean }[]>`
      select t.table_name, exists (select 1 from information_schema.columns c where c.table_schema = 'app' and c.table_name = t.table_name
               and c.column_name in ('target_pp_cents', 'hard_max_pp_cents')) as budgeted
      from information_schema.tables t where t.table_schema = 'app' and t.table_type = 'BASE TABLE'`;
    budgetTables = tables.filter((t) => t.budgeted).map((t) => t.table_name);
    for (const t of tables.filter((t) => !t.budgeted && t.table_name !== "events")) {
      tableDumps.push({ table: t.table_name, rows: (await q<{ j: string }[]>`select row_to_json(x)::text as j from app.${q(t.table_name)} x`).map((r) => r.j) });
    }
  }, 240_000);

  afterAll(async () => {
    await teardown?.();
  });

  const everywhere = (): { scope: string; owner: number | null; text: string }[] => [
    ...llmCalls.map((c) => ({ scope: `llm.${c.method}`, owner: c.who === null ? null : BUDGETS.findIndex((b) => b.first === c.who), text: c.json })),
    ...outbox().filter((e): e is Extract<Outbox, { kind: "text" }> => e.kind === "text").map((e) => ({ scope: "outbound text", owner: ownerOf(e), text: e.text })),
    ...plannerCalls.map((c) => ({ scope: `planner.${c.method}`, owner: null, text: c.json })),
    ...venueCalls.map((c) => ({ scope: `venue.${c.method}`, owner: null, text: c.json })),
    ...eventRows.map((t) => ({ scope: "app.events", owner: null, text: t })),
    { scope: "SSE frames", owner: null, text: sseRaw.text },
    ...captured.logs.map((t) => ({ scope: "pino log", owner: null, text: t })),
    ...tableDumps.flatMap((d) => d.rows.map((t) => ({ scope: `app.${d.table}`, owner: null, text: t }))),
  ];

  it("ran every stage with real data in every recorder (the sweep below is not vacuous)", () => {
    expect(llmCalls.filter((c) => c.method === "parseBudget").map((c) => c.who).sort()).toEqual(BUDGETS.map((b) => b.first).sort());
    expect(llmCalls.some((c) => c.method === "rateBundles")).toBe(true);
    expect(plannerCalls.map((c) => c.method).sort()).toEqual(["startConcierge", "startScout", "startScout"]);
    expect(venueCalls.map((c) => c.method)).toEqual(expect.arrayContaining(["checkAvailability", "createOrder", "getOrder", "commit"]));
    expect(eventRows.length).toBeGreaterThan(20);
    expect(sseRaw.text).toContain("data:");
    expect(captured.logs.length).toBeGreaterThan(10);
    expect(tableDumps.some((d) => d.table === "options" && d.rows.length > 0)).toBe(true);
    expect(tableDumps.some((d) => d.table === "bundles" && d.rows.length > 0)).toBe(true);
  });

  it("each owner's own values do reach their own delegate and their own confirmation (the detector sees them)", () => {
    for (const [i, b] of BUDGETS.entries()) {
      const own = llmCalls.find((c) => c.method === "parseBudget" && c.who === b.first)!;
      expect(hits(own.json, b).length, `${b.first} delegate input`).toBeGreaterThan(0);
      const confirm = textsTo(i).find((e) => /Just between us: aim/.test(e.text))!;
      expect(confirm.text).toBe(
        COPY.T_BUDGET_CONFIRM.replace("${target}", () => `$${Math.floor(b.target / 100)}`).replace("${max}", () => `$${Math.floor(b.effMax / 100)}`),
      );
    }
  });

  it("every value, in every spelling, appears only in its owner's delegate calls and texts to that owner", () => {
    const leaks: string[] = [];
    for (const [i, b] of BUDGETS.entries()) {
      for (const h of everywhere()) {
        if (h.owner === i) continue;
        const found = hits(h.text, b);
        if (found.length) leaks.push(`${b.first}: ${found.join(",")} in ${h.scope}${h.owner === null ? "" : ` (to/for ${BUDGETS[h.owner]?.first})`}`);
      }
    }
    expect(leaks).toEqual([]);
  });

  it("the budget store is the only table with budget columns", () => {
    expect(budgetTables).toHaveLength(1);
  });

  it("every outbound text went to a known member (no unattributed recipient hides a leak)", () => {
    const unknown = outbox().filter((e) => e.kind === "text" && ownerOf(e) === null);
    expect(unknown).toEqual([]);
  });

  it("refusal: a member asking for another's budget gets T_ONLY_YOURS, threaded, and nothing else", () => {
    const refusals = textsTo(0).filter((e) => e.text === COPY.T_ONLY_YOURS);
    expect(refusals).toHaveLength(3);
    expect(refusals.every((e) => e.replyTo !== null)).toBe(true);
    // Nobody else got a refusal, and the refused member's questions never reached the others.
    for (const i of [1, 2, 3]) expect(textsTo(i).some((e) => e.text === COPY.T_ONLY_YOURS)).toBe(false);
    // The asker's own delegate saw only the asker's name and own text; the LLM-path ask mentions no other member's value.
    const asked = llmCalls.filter((c) => c.who === BUDGETS[0]!.first && c.method === "parseBallot" && /afford/.test(c.json));
    expect(asked.length).toBeGreaterThan(0);
    for (const c of asked) for (const b of BUDGETS.slice(1)) expect(hits(c.json, b)).toEqual([]);
  });

  it("delegate inputs are exactly one person's {user_first_name, stage, message_text}", () => {
    for (const c of llmCalls.filter((c) => c.who !== null)) {
      const input = (JSON.parse(c.json) as Record<string, unknown>[])[0]!;
      expect(Object.keys(input).sort(), `${c.method} input keys`).toEqual(["message_text", "stage", "user_first_name"]);
    }
  });

  it("inbound text is not logged or emitted at all", () => {
    const texts = [...BUDGETS.map((b) => b.say), ...PREFS];
    for (const t of texts) {
      expect(captured.logs.some((l) => l.includes(t))).toBe(false);
      expect(eventRows.some((r) => r.includes(t))).toBe(false);
    }
    expect(inboundIds.length).toBeGreaterThan(0);
  });
});
