import type { SseEvent } from "@tab/shared";
import { describe, expect, it } from "vitest";
import { MAX_DELIVERIES, MAX_PROGRESS, MAX_RUNS, MAX_SYSTEM, applySnapshot, consoleReducer, initialConsoleState, reduceConsole, stepFor, type ConsoleState } from "./consoleReducer";

const P1 = "11111111-1111-4111-8111-111111111111";
const P2 = "22222222-2222-4222-8222-222222222222";
const at = 1_000;

const apply = (state: ConsoleState, id: number, event: SseEvent, receivedAt = at) => consoleReducer(state, { id, event, receivedAt });
const planState = (plan_id: string, to: string, version = 1): SseEvent => ({ type: "plan.state", plan_id, from: "COLLECTING", to, version });
const lane = (n: number, stage: "JOINED" | "HELD" | "CAPTURED", plan_id = P1): SseEvent => ({ type: "lane", plan_id, lane: n, first_name: `P${n}`, stage, amount_cents: null, cybs_id_short: null });

describe("consoleReducer", () => {
  it("ignores frames with id <= lastId", () => {
    const s1 = apply(initialConsoleState, 5, planState(P1, "VOTING"));
    expect(apply(s1, 5, planState(P1, "ORDERING"))).toBe(s1);
    expect(apply(s1, 4, planState(P1, "ORDERING"))).toBe(s1);
    expect(apply(s1, 6, planState(P1, "ORDERING")).plan?.state).toBe("ORDERING");
  });

  it("resets plan-scoped slices only when plan.state names a different plan", () => {
    let s = apply(initialConsoleState, 1, planState(P1, "VOTING"));
    s = apply(s, 2, lane(1, "JOINED"));
    s = apply(s, 3, { type: "vote.tally", plan_id: P1, voted: 1, total: 3 });
    s = apply(s, 4, { type: "ledger", order_id: "o1", lane: 1, status: "AUTHORIZED", amount_cents: 4200, cybs_id_short: "c1" });
    s = apply(s, 5, { type: "xray", contexts: [{ name: "fanout", locked: false, preview: "x" }] });
    const sameVersionBump = apply(s, 6, planState(P1, "ORDERING", 2));
    expect(Object.keys(sameVersionBump.lanes)).toEqual(["1"]);
    expect(sameVersionBump.plan).toEqual({ plan_id: P1, state: "ORDERING", version: 2 });

    const next = apply(s, 7, planState(P2, "COLLECTING"));
    expect(next.lanes).toEqual({});
    expect(next.tally).toBeNull();
    expect(next.ledger).toEqual({});
    expect(next.xray.fanout).toBeDefined(); // not plan-scoped
    expect(next.lastId).toBe(7);
  });

  it("upserts lanes by lane number", () => {
    let s = apply(initialConsoleState, 1, lane(2, "JOINED"));
    s = apply(s, 2, lane(2, "HELD"));
    expect(Object.values(s.lanes)).toHaveLength(1);
    expect(s.lanes[2]?.stage).toBe("HELD");
  });

  it("merges xray contexts by name", () => {
    let s = apply(initialConsoleState, 1, { type: "xray", contexts: [{ name: "scout_input:dinner", locked: false, preview: "{}" }] });
    s = apply(s, 2, { type: "xray", contexts: [{ name: "delegate:lane-1", locked: true, preview: null }, { name: "scout_input:dinner", locked: false, preview: "{\"a\":1}" }] });
    expect(Object.keys(s.xray).sort()).toEqual(["delegate:lane-1", "scout_input:dinner"]);
    expect(s.xray["scout_input:dinner"]?.preview).toBe("{\"a\":1}");
    expect(s.xray["delegate:lane-1"]?.preview).toBeNull();
  });

  it("keeps first_seen_at for a run across updates", () => {
    const run = (status: string, elapsed_ms: number): SseEvent => ({ type: "creao.run", run_id: "r1", kind: "scout", category: "dinner", status, elapsed_ms, source: "live", share_url: null });
    let s = apply(initialConsoleState, 1, run("running", 0), 100);
    s = apply(s, 2, run("completed", 9000), 900);
    expect(s.creaoRuns.r1).toMatchObject({ status: "completed", first_seen_at: 100, elapsed_ms: 9000 });
  });

  it("caps progress, deliveries and system lists", () => {
    let s = initialConsoleState;
    for (let i = 1; i <= 20; i++) {
      s = apply(s, i * 3, { type: "creao.progress", run_id: "r1", kind: "scout", category: null, step: `s${i}` });
      s = apply(s, i * 3 + 1, { type: "delivery", lane: 1, message_id_short: `m${i}`, status: "accepted" });
      s = apply(s, i * 3 + 2, { type: "system", level: "info", msg: `m${i}` });
    }
    expect(s.progress).toHaveLength(MAX_PROGRESS);
    expect(s.progress.at(-1)?.step).toBe("s20");
    expect(s.deliveries).toHaveLength(MAX_DELIVERIES);
    expect(s.system).toHaveLength(MAX_SYSTEM);
    expect(s.system[0]?.msg).toBe("m15");
  });

  it("updates a delivery dot in place when the same message advances", () => {
    let s = apply(initialConsoleState, 1, { type: "delivery", lane: 1, message_id_short: "a", status: "accepted" });
    s = apply(s, 2, { type: "delivery", lane: 2, message_id_short: "b", status: "accepted" });
    s = apply(s, 3, { type: "delivery", lane: 1, message_id_short: "a", status: "delivered" });
    expect(s.deliveries.map((d) => [d.message_id_short, d.status])).toEqual([["a", "delivered"], ["b", "accepted"]]);
  });

  it("stores latest counters, tap and shortlist events", () => {
    let s = apply(initialConsoleState, 1, { type: "counters", groups_converted: 1, fronted_by_individual_cents: 0, holds_released: 2 });
    s = apply(s, 2, { type: "counters", groups_converted: 2, fronted_by_individual_cents: 0, holds_released: 2 });
    expect(s.counters?.groups_converted).toBe(2);
    s = apply(s, 3, { type: "tap.signed", order_id: "o", method: "POST", path: "/orders/o/commit", signature_input: "sig1=...", signature_short: "abc" });
    expect(s.tapSigned?.signature_short).toBe("abc");
    s = apply(s, 4, { type: "shortlist", plan_id: P1, version: 1, from_count: 40, survived_count: 9, bundles: [] });
    expect(s.shortlist).toMatchObject({ from_count: 40, survived_count: 9 });
  });
});

describe("plan routing", () => {
  const run = (n: number): SseEvent => ({ type: "creao.run", run_id: `r${n}`, kind: "scout", category: "dinner", status: "completed", elapsed_ms: 1, source: "cached", share_url: null });

  it("keeps lanes that precede the first plan.state of the same plan (join, then research starts)", () => {
    let s = apply(initialConsoleState, 1, lane(1, "JOINED"));
    s = apply(s, 2, lane(2, "JOINED"));
    expect(s.plan).toEqual({ plan_id: P1, state: "COLLECTING", version: 0 }); // stepper shows Gather as current
    s = apply(s, 3, planState(P1, "RESEARCHING"));
    expect(Object.keys(s.lanes)).toEqual(["1", "2"]);
    expect(s.plan?.state).toBe("RESEARCHING");
  });

  it("ops Reset: lanes seeded before the new plan.state survive it, even while the old plan is in flight", () => {
    let s = apply(initialConsoleState, 1, planState(P1, "VOTING"));
    s = apply(s, 2, lane(1, "HELD", P1));
    s = apply(s, 3, lane(1, "JOINED", P2));
    s = apply(s, 4, lane(2, "JOINED", P2));
    expect(Object.keys(s.lanes)).toEqual(["1"]);
    expect(s.lanes[1]?.stage).toBe("HELD");
    s = apply(s, 5, planState(P2, "RESEARCHING"));
    expect(Object.values(s.lanes).map((l) => [l.lane, l.stage, l.plan_id])).toEqual([[1, "JOINED", P2], [2, "JOINED", P2]]);
    expect(s.pending).toEqual({});
  });

  it("a lane, tally or shortlist from another plan cannot overwrite a plan in flight", () => {
    let s = apply(initialConsoleState, 1, planState(P1, "VOTING"));
    s = apply(s, 2, lane(1, "JOINED", P1));
    s = apply(s, 3, lane(1, "HELD", P2));
    s = apply(s, 4, { type: "vote.tally", plan_id: P2, voted: 9, total: 9 });
    s = apply(s, 5, { type: "shortlist", plan_id: P2, version: 1, from_count: 1, survived_count: 1, bundles: [] });
    expect(s.lanes[1]).toMatchObject({ plan_id: P1, stage: "JOINED" });
    expect(s.tally).toBeNull();
    expect(s.shortlist).toBeNull();
    expect(s.plan?.plan_id).toBe(P1);
  });

  it("a new plan's lanes stay queued after CONFIRMED or CANCELLED, so a stranger cannot replace the evidence; its plan.state adopts them", () => {
    for (const end of ["CONFIRMED", "CANCELLED"]) {
      let s = apply(initialConsoleState, 1, planState(P1, end));
      s = apply(s, 2, lane(1, "HELD", P1));
      s = apply(s, 3, { type: "ledger", order_id: "o1", lane: 1, status: "CAPTURED", amount_cents: 100, cybs_id_short: null });
      s = apply(s, 4, lane(2, "JOINED", P2));
      expect(s.plan?.plan_id).toBe(P1);
      expect(Object.keys(s.lanes)).toEqual(["1"]);
      expect(Object.keys(s.ledger)).toEqual(["1"]);
      s = apply(s, 5, planState(P2, "RESEARCHING"));
      expect(Object.values(s.lanes).map((l) => [l.lane, l.plan_id])).toEqual([[2, P2]]);
      expect(s.ledger).toEqual({});
    }
  });

  it("queues at most a few other plans", () => {
    let s = apply(initialConsoleState, 1, planState(P1, "VOTING"));
    for (let i = 0; i < 9; i++) s = apply(s, 2 + i, lane(1, "JOINED", `00000000-0000-4000-8000-00000000000${i}`));
    expect(Object.keys(s.pending)).toHaveLength(4);
  });

  it("caps CREAO run chips at the newest MAX_RUNS and updates a kept run in place", () => {
    let s = initialConsoleState;
    for (let i = 1; i <= 10; i++) s = apply(s, i, run(i));
    expect(Object.keys(s.creaoRuns)).toEqual(["r7", "r8", "r9", "r10"]);
    expect(Object.keys(s.creaoRuns)).toHaveLength(MAX_RUNS);
    s = apply(s, 11, { ...(run(8) as Extract<SseEvent, { type: "creao.run" }>), elapsed_ms: 5 });
    expect(Object.keys(s.creaoRuns)).toEqual(["r7", "r8", "r9", "r10"]);
    expect(s.creaoRuns.r8?.elapsed_ms).toBe(5);
  });

  it("stepper: CONFIRMED completes every step", () => {
    expect(stepFor("CONFIRMED")).toBe(5);
  });
});

describe("applySnapshot", () => {
  const events = [
    { id: 3, data: lane(1, "HELD") },
    { id: 1, data: planState(P1, "VOTING") },
    { id: 2, data: lane(1, "JOINED") },
  ];

  it("folds events in id order and sets lastId", () => {
    const s = applySnapshot(initialConsoleState, { last_id: 3, events }, 50);
    expect(s.lastId).toBe(3);
    expect(s.lanes[1]?.stage).toBe("HELD");
    expect(s.plan?.plan_id).toBe(P1);
  });

  it("is idempotent with the SSE replay of the same ids", () => {
    const s = applySnapshot(initialConsoleState, { last_id: 3, events }, 50);
    const replayed = reduceConsole(s, { type: "frame", frame: { id: 3, event: lane(1, "JOINED"), receivedAt: 60 } });
    expect(replayed).toBe(s);
  });
});

describe("stepFor", () => {
  it.each([
    ["COLLECTING", 0],
    ["RESEARCHING", 1],
    ["VOTING", 2],
    ["ORDERING", 3],
    ["APPROVING", 3],
    ["COMMITTING", 4],
    ["CONFIRMED", 5],
    ["CANCELLING", -1],
    ["CANCELLED", -1],
    ["SHOWCASE", -1],
    ["nonsense", -1],
  ])("%s -> %i", (state, step) => {
    expect(stepFor(state)).toBe(step);
  });
});
