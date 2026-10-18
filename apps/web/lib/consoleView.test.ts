import type { LaneStage, PublicBundle, SseEvent } from "@tab/shared";
import { describe, expect, it } from "vitest";
import { initialConsoleState, type ConsoleAction, type ConsoleState, type LaneView, type LedgerRow } from "./consoleReducer";
import {
  amountFor,
  chipFor,
  clock12,
  displayName,
  groupSees,
  initialScopedState,
  laneSummary,
  lockedLanes,
  lookFor,
  meterFor,
  money,
  planFacts,
  planMeta,
  proofFor,
  railFor,
  reduceScoped,
  seatCount,
  settledLanes,
  shareCents,
  type ScopedConsoleState,
  parseSignatureInput,
  statusLine,
  tapSummary,
  weekday,
} from "./consoleView";

const P = "11111111-1111-4111-8111-111111111111";
const NAMES = ["Maya", "Leo", "Sam", "Priya"];

const lane = (n: number, stage: LaneStage, amount_cents: number | null = null, first_name = NAMES[n - 1] ?? ""): LaneView => ({
  plan_id: P,
  lane: n,
  first_name,
  stage,
  amount_cents,
  cybs_id_short: null,
});
const lanesOf = (...ls: LaneView[]): Record<number, LaneView> => Object.fromEntries(ls.map((l) => [l.lane, l]));
const bundle = (index: 1 | 2 | 3, pp: number, dinner = `D${index}`, show = `S${index}`): PublicBundle => ({
  id: `b${index}`,
  index,
  title: `Dinner at ${dinner} → Show at ${show}`,
  dinner_name: dinner,
  show_name: show,
  dinner_time: "19:00",
  show_start: "21:00",
  show_end_est: "22:30",
  all_in_pp_cents: pp,
  dietary_fit: [],
  pitch: "",
});
const shortlist = (bundles: PublicBundle[]): NonNullable<ConsoleState["shortlist"]> => ({ plan_id: P, version: 1, from_count: 23, survived_count: bundles.length, bundles });
const state = (o: Partial<ConsoleState>): ConsoleState => ({ ...initialConsoleState, ...o });
const ledgerRow = (n: number, status: LedgerRow["status"], amount_cents: number): LedgerRow => ({ order_id: "o", lane: n, status, amount_cents, cybs_id_short: null });

describe("railFor", () => {
  const marks = (stage: LaneStage) => railFor(stage).stations.map((s) => s.mark);
  it("walks Joined → Voted → Held → Captured", () => {
    expect(marks("INVITED")).toEqual(["todo", "todo", "todo", "todo"]);
    expect(marks("BUDGET_LOCKED")).toEqual(["done", "todo", "todo", "todo"]);
    expect(marks("VOTED")).toEqual(["done", "done", "todo", "todo"]);
    expect(marks("HELD")).toEqual(["done", "done", "now", "todo"]);
    expect(marks("CAPTURED")).toEqual(["done", "done", "done", "done"]);
  });
  it("RELEASED keeps its Held history and ends on a Released mark", () => {
    const r = railFor("RELEASED");
    expect(r.stations.map((s) => s.mark)).toEqual(["done", "done", "done", "end"]);
    expect(r.stations[3]?.label).toBe("Released");
    expect(r).toMatchObject({ solidTo: 2, ended: true });
  });
  it("DECLINED keeps Voted and ends on a Declined mark", () => {
    const r = railFor("DECLINED");
    expect(r.stations.map((s) => s.mark)).toEqual(["done", "done", "todo", "end"]);
    expect(r.stations[3]?.label).toBe("Declined");
    expect(r).toMatchObject({ solidTo: 1, ended: true });
  });
});

describe("chips and looks", () => {
  it("never tells GATED apart from LINK_SENT (a gate would reveal a budget below the share)", () => {
    expect(chipFor("GATED")).toBe(chipFor("LINK_SENT"));
    expect(railFor("GATED")).toEqual(railFor("LINK_SENT"));
    expect(amountFor(lane(1, "GATED", 4200), 4200)).toEqual(amountFor(lane(1, "LINK_SENT", 4200), 4200));
    expect(lookFor("GATED")).toBe(lookFor("LINK_SENT"));
  });
  it("maps the money states to their looks", () => {
    expect(["HELD", "CAPTURED", "RELEASED", "DECLINED", "VOTED"].map((s) => lookFor(s as LaneStage))).toEqual(["held", "captured", "released", "declined", "idle"]);
  });
  it("names a blank first name Guest {lane}", () => {
    expect(displayName({ lane: 3, first_name: "  " })).toBe("Guest 3");
  });
});

describe("amountFor", () => {
  it("held, captured, released and declined amounts", () => {
    expect(amountFor(lane(1, "HELD", 4200), 4200)).toEqual({ value: "$42.00", caption: "held, not charged", quiet: false });
    expect(amountFor(lane(1, "CAPTURED", 4200), 4200)).toEqual({ value: "$42.00", caption: "charged", quiet: false });
    // RELEASED events carry no amount; the lane still says $0.00 charged in the primary color, never struck.
    expect(amountFor(lane(1, "RELEASED"), 4200)).toEqual({ value: "$0.00", caption: "charged", quiet: false });
    expect(amountFor(lane(1, "DECLINED"), 4200)).toEqual({ value: "$0.00", caption: "charged", quiet: false });
  });
  it("shows the share quietly before a hold, and nothing before any order", () => {
    expect(amountFor(lane(1, "VOTED"), 4200)).toEqual({ value: "$42.00", caption: "share", quiet: true });
    expect(amountFor(lane(1, "JOINED"), null)).toEqual({ value: "", caption: "", quiet: true });
  });
  it("summarises a lane for screen readers", () => {
    expect(laneSummary(lane(1, "HELD", 4200), 4200)).toBe("Maya: HELD, $42.00 held, not charged");
    expect(laneSummary(lane(1, "JOINED"), null)).toBe("Maya: JOINED");
  });
});

describe("money and meter", () => {
  it("is empty with no lanes: Held so far $0 of —", () => {
    const m = money(state({}));
    expect(m.mode).toBe("empty");
    expect(meterFor(m)).toMatchObject({ label: "Held so far", number: "$0", of: "of —" });
  });
  it("counts holds without charging anything", () => {
    const m = money(state({ lanes: lanesOf(lane(1, "HELD", 4200), lane(2, "HELD", 4200), lane(3, "HELD", 4200), lane(4, "LINK_SENT", 4200)) }));
    expect(m).toMatchObject({ mode: "holding", heldCount: 3, heldCents: 12_600, chargedCents: 0, totalCents: 16_800 });
    expect(meterFor(m)).toEqual({ label: "Held so far", number: "$126", of: "of $168", sub: { text: "Charged ", strong: "$0", rest: " · 3 of 4 holds" } });
  });
  it("is full at n of n held and captured only when every share is captured", () => {
    const full = lanesOf(...[1, 2, 3, 4].map((n) => lane(n, "HELD", 4200)));
    expect(money(state({ lanes: full })).mode).toBe("full");
    const mid = lanesOf(lane(1, "CAPTURED", 4200), lane(2, "CAPTURED", 4200), lane(3, "HELD", 4200), lane(4, "HELD", 4200));
    expect(money(state({ lanes: mid }))).toMatchObject({ mode: "full", chargedCents: 8400 });
    const all = lanesOf(...[1, 2, 3, 4].map((n) => lane(n, "CAPTURED", 4200)));
    const m = money(state({ lanes: all }));
    expect(m).toMatchObject({ mode: "captured", chargedCents: 16_800, uniform: true });
    expect(meterFor(m)).toEqual({ label: "Captured, all or nothing", number: "$168", of: "", sub: { text: "Charged ", strong: "$168", rest: " · 4 × $42" } });
  });
  it("released: every hold off, nobody paid, using the ledger for the share once lanes lose their amounts", () => {
    const lanes = lanesOf(lane(1, "RELEASED"), lane(2, "RELEASED"), lane(3, "RELEASED"), lane(4, "DECLINED"));
    const ledger = { 1: ledgerRow(1, "RELEASED", 4200), 2: ledgerRow(2, "RELEASED", 4200), 3: ledgerRow(3, "RELEASED", 4200) };
    const m = money(state({ lanes, ledger }));
    expect(m).toMatchObject({ mode: "released", releasedCount: 3, chargedCents: 0, share: 4200 });
    expect(meterFor(m)).toEqual({ label: "Released", number: "$0", of: "charged", sub: { text: "", strong: "3", rest: " holds released · nobody paid" } });
  });
  it("shareCents prefers lane amounts, then the ledger", () => {
    expect(shareCents([lane(1, "VOTED"), lane(2, "HELD", 3900)], {})).toBe(3900);
    expect(shareCents([lane(1, "RELEASED")], { 1: ledgerRow(1, "RELEASED", 4100) })).toBe(4100);
    expect(shareCents([lane(1, "VOTED")], {})).toBeNull();
  });
});

describe("proofFor", () => {
  const list = shortlist([bundle(1, 4200), bundle(2, 3800), bundle(3, 4600)]);
  it("says nothing about fit before a budget or a shortlist exists", () => {
    expect(proofFor("JOINED", { shortlist: list, share: 4200 })).toEqual({ kind: "unset", text: "Budget not set yet", fits: null });
    expect(proofFor("INVITED", { shortlist: null, share: null }).kind).toBe("unset");
    expect(proofFor("BUDGET_LOCKED", { shortlist: null, share: null })).toEqual({ kind: "hidden", text: "Budget hidden", fits: null });
  });
  it("claims $X fits only with a shortlist, from the public share", () => {
    expect(proofFor("HELD", { shortlist: list, share: 4200 })).toEqual({ kind: "hidden", text: "Budget hidden", fits: "$42 fits" });
    // §7.2 allows only "$X fits": before the share is known the proof is "Budget hidden" alone.
    expect(proofFor("PREFS_DONE", { shortlist: list, share: null })).toEqual({ kind: "hidden", text: "Budget hidden", fits: null });
    expect(proofFor("RELEASED", { shortlist: list, share: 4200 }).fits).toBe("$42 fits");
  });
  it("makes no fit claim for a decliner", () => {
    expect(proofFor("DECLINED", { shortlist: list, share: 4200 }).fits).toBeNull();
  });
});

describe("statusLine", () => {
  it("empty", () => {
    expect(statusLine(state({}))).toEqual({ big: "Waiting for the group.", small: "Text SquadTab to start a plan. Lanes appear as friends join." });
  });
  it("collecting budgets claims no denominator while friends can still join", () => {
    const s = state({ plan: { plan_id: P, state: "COLLECTING", version: 1 }, lanes: lanesOf(lane(1, "PREFS_DONE"), lane(2, "JOINED"), lane(3, "INVITED")) });
    expect(statusLine(s).big).toBe("1 budget in.");
    const two = state({ plan: { plan_id: P, state: "", version: -1 }, lanes: lanesOf(lane(1, "PREFS_DONE"), lane(2, "BUDGET_LOCKED")) });
    expect(statusLine(two).big).toBe("2 budgets in.");
  });
  it("seats are known once the group votes, never while it gathers", () => {
    const gathering = state({ plan: { plan_id: P, state: "COLLECTING", version: 1 }, lanes: lanesOf(lane(1, "PREFS_DONE"), lane(2, "JOINED")) });
    expect(seatCount(gathering)).toBeNull();
    expect(seatCount(state({}))).toBeNull();
    expect(seatCount({ ...gathering, plan: { plan_id: P, state: "RESEARCHING", version: 2 } })).toBe(2);
    expect(seatCount({ ...gathering, plan: { plan_id: P, state: "", version: -1 }, tally: { plan_id: P, voted: 0, total: 2 } })).toBe(2);
    expect(seatCount(state({ lanes: lanesOf(lane(1, "HELD", 4200), lane(2, "VOTED")) }))).toBe(2);
  });
  it("voted names the chosen bundle and price", () => {
    const s = state({
      plan: { plan_id: P, state: "APPROVING", version: 1 },
      lanes: lanesOf(...[1, 2, 3, 4].map((n) => lane(n, "LINK_SENT", 4200))),
      tally: { plan_id: P, voted: 4, total: 4 },
      shortlist: shortlist([bundle(1, 4200, "Rooftop", "Largo comedy"), bundle(2, 3800)]),
    });
    expect(statusLine(s)).toEqual({ big: "4 of 4 voted.", small: "Rooftop + Largo comedy, $42 each. Holding cards now." });
  });
  it("holding, then everyone held", () => {
    const some = state({ lanes: lanesOf(lane(1, "HELD", 4200), lane(2, "HELD", 4200), lane(3, "HELD", 4200), lane(4, "LINK_SENT", 4200)) });
    expect(statusLine(some)).toEqual({ big: "3 of 4 held.", small: "Nobody is charged until 4 of 4." });
    const all = state({ lanes: lanesOf(...[1, 2, 3, 4].map((n) => lane(n, "HELD", 4200))) });
    expect(statusLine(all)).toEqual({ big: "4 of 4 held.", small: "Everyone’s held. Booking now." });
  });
  it("captured", () => {
    const s = state({ lanes: lanesOf(...[1, 2, 3, 4].map((n) => lane(n, "CAPTURED", 4200))) });
    expect(statusLine(s)).toEqual({ big: "Everyone’s in. Booked.", small: "$168.00 captured, 4 × $42.00. Nobody fronted a cent." });
  });
  it("declined while others hold, then every hold released", () => {
    const declining = state({ lanes: lanesOf(lane(1, "HELD", 4200), lane(2, "HELD", 4200), lane(3, "HELD", 4200), lane(4, "DECLINED")) });
    expect(statusLine(declining)).toEqual({ big: "Priya can’t make it.", small: "Releasing every hold. Nobody pays for a plan that didn’t happen." });
    const released = state({ lanes: lanesOf(lane(1, "RELEASED"), lane(2, "RELEASED"), lane(3, "RELEASED"), lane(4, "DECLINED")) });
    expect(statusLine(released)).toEqual({ big: "Every hold released.", small: "Nobody paid. Holds drop off cards with no charge." });
  });
  it("a CONFIRMED plan reads as captured even before the share.captured hooks", () => {
    const held = lanesOf(...[1, 2, 3, 4].map((n) => lane(n, "HELD", 8800)));
    const plan = { plan_id: P, state: "CONFIRMED", version: 9 };
    const lanes = settledLanes(held, plan);
    expect(Object.values(lanes).map((l) => l.stage)).toEqual(["CAPTURED", "CAPTURED", "CAPTURED", "CAPTURED"]);
    expect(statusLine(state({ plan, lanes }))).toEqual({ big: "Everyone’s in. Booked.", small: "$352.00 captured, 4 × $88.00. Nobody fronted a cent." });
    expect(money(state({ lanes }))).toMatchObject({ mode: "captured", chargedCents: 35_200 });
    // Any other state keeps the lanes as they are (same object, so memoised views do not recompute).
    expect(settledLanes(held, { ...plan, state: "COMMITTING" })).toBe(held);
  });
  it("never reads a half-released plan as k of n held", () => {
    const s = state({ lanes: lanesOf(lane(1, "RELEASED"), lane(2, "HELD", 4200)) });
    expect(statusLine(s).big).toBe("Releasing every hold.");
  });
});

describe("plan facts", () => {
  const brief = (category: "dinner" | "show", start = "19:00") =>
    JSON.stringify({
      category,
      area: "Santa Monica",
      date: "2026-10-17",
      time_window: { start, end: "23:00" },
      party_size: 4,
      dietary_tags: ["vegetarian"],
      vibe: [],
      price_tiers: ["<$25", "$25-50", "$50+"],
      count_per_tier: 4,
    });
  const xray = {
    "scout_input:dinner": { name: "scout_input:dinner", locked: false, preview: brief("dinner") },
    "scout_input:show": { name: "scout_input:show", locked: false, preview: brief("show", "21:00") },
    "delegate:lane-2": { name: "delegate:lane-2", locked: true, preview: null },
    "delegate:lane-1": { name: "delegate:lane-1", locked: true, preview: null },
    fanout: { name: "fanout", locked: false, preview: "not json" },
  };
  it("formats times and weekdays without a timezone shift", () => {
    expect(clock12("19:00")).toBe("7:00 PM");
    expect(clock12("00:30")).toBe("12:30 AM");
    expect(weekday("2026-10-17")).toBe("Sat");
  });
  it("builds the header meta from the Scout briefs", () => {
    const f = planFacts(xray);
    expect(planMeta(f, 4)).toBe("Dinner + show · Sat 7:00 PM · Santa Monica · 4 people");
    expect(planMeta(planFacts({}), 3)).toBe("3 people");
    expect(planMeta(planFacts({}), null)).toBe("");
  });
  it("what the group sees: public facts only", () => {
    const f = planFacts(xray);
    expect(groupSees(f, { laneCount: 4, shortlist: shortlist([bundle(1, 4200)]), share: 4200 })).toBe("4 people · every budget fits · $42 each · Santa Monica · dinner + show · vegetarian");
    expect(groupSees(planFacts({}), { laneCount: 0, shortlist: null, share: null })).toBeNull();
  });
  it("lists locked delegates by lane, with names", () => {
    expect(lockedLanes(xray, lanesOf(lane(1, "HELD")))).toEqual([
      { lane: 1, name: "Maya" },
      { lane: 2, name: "Guest 2" },
    ]);
  });
  it("ignores malformed briefs", () => {
    expect(planFacts({ "scout_input:dinner": { name: "scout_input:dinner", locked: false, preview: "{bad" } }).what).toBeNull();
  });
});

describe("tapSummary", () => {
  const created = 1_760_000_000;
  const signed: NonNullable<ConsoleState["tapSigned"]> = {
    order_id: "ord_7f3a",
    method: "POST",
    path: "/checkout/ord_7f3a",
    signature_input: `sig1=("@method" "@path");created=${created};expires=${created + 480};keyid="squadtab-agent-01";alg="ed25519";nonce="n1";tag="agent-payer-auth"`,
    signature_short: "abc…",
  };
  const now = created * 1000 + 30_000;
  const report = (accepted: boolean, failedStep?: "nonce" | "timestamps") => ({
    order_id: "ord_7f3a",
    report: {
      route: "/checkout",
      tag: "agent-payer-auth",
      steps: (["tag", "params", "timestamps", "nonce", "key", "signature"] as const).map((name, i) => ({ n: (i + 1) as 1, name, ok: name !== failedStep, detail: "" })),
      business: null,
      accepted,
      reason: accepted ? null : (failedStep ?? null),
      signature_base: "",
    },
  });
  it("parses the signature input", () => {
    expect(parseSignatureInput(signed.signature_input)).toEqual({ keyid: "squadtab-agent-01", created, expires: created + 480 });
    expect(parseSignatureInput("garbage")).toEqual({ keyid: null, created: null, expires: null });
  });
  it("idle, signed and verified lines", () => {
    expect(tapSummary(null, null, now).lines.map((l) => l.text)).toEqual(["Signed by: waiting for checkout", "Expires: not yet signed", "Merchant check: not yet sent"]);
    const s = tapSummary(signed, null, now);
    expect(s.phase).toBe("signed");
    expect(s.lines.map((l) => l.text)).toEqual(["Signed by squadtab-agent-01 · POST /checkout/ord_7f3a", "Expires in 8 min · nonce never reused", "Merchant is checking the signature"]);
    const v = tapSummary(signed, report(true), now);
    expect(v.phase).toBe("verified");
    expect(v.lines[2]).toEqual({ ok: true, text: "", strong: "Verified by merchant" });
  });
  it("never claims a reused nonce was never reused", () => {
    const r = tapSummary(signed, report(false, "nonce"), now);
    expect(r.phase).toBe("rejected");
    expect(r.lines[1]).toEqual({ ok: false, text: "Expires in 8 min · nonce already used" });
    expect(r.lines[2].strong).toBe("Rejected by merchant: nonce");
    expect(tapSummary(signed, report(false, "timestamps"), now).lines[1].text).toBe("Signature expired · nonce never reused");
  });
  it("a mock-venue report (no tap.signed) reads as the labelled simulation, never as a signature", () => {
    const mock = (accepted: boolean) => {
      const r = report(accepted, accepted ? undefined : "nonce");
      return { ...r, report: { ...r.report, steps: r.report.steps.map((st) => ({ ...st, detail: st.ok ? "mock venue: no signature in mock mode" : "rejected (mock replay)" })) } };
    };
    const m = tapSummary(null, mock(true), now);
    expect(m.phase).toBe("verified");
    expect(m.lines.map((l) => `${l.text}${l.strong ?? ""}`)).toEqual(["Labelled simulation · /checkout", "Mock venue: no signature in mock mode", "Mock checks passed"]);
    expect(m.lines.map((l) => l.text).join(" ")).not.toMatch(/signed by|expires in|never reused/i);
    expect(tapSummary(null, mock(false), now).phase).toBe("rejected");
    // A live report whose tap.signed has not arrived is not relabelled.
    expect(tapSummary(null, report(true), now).lines[0].text).toBe("Signed agent request · /checkout");
  });
  it("never says Visa-verified", () => {
    const all = [tapSummary(signed, report(true), now), tapSummary(signed, report(false, "nonce"), now)].flatMap((s) => s.lines.map((l) => `${l.text}${l.strong ?? ""}`));
    expect(all.join(" ")).not.toMatch(/visa-verified/i);
  });
});

describe("reduceScoped (plan scope and commit order)", () => {
  const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const laneEv = (plan_id: string, n: number, stage: LaneStage, amount_cents: number | null = null): SseEvent => ({
    type: "lane",
    plan_id,
    lane: n,
    first_name: NAMES[n - 1]!,
    stage,
    amount_cents,
    cybs_id_short: null,
  });
  const planEv = (plan_id: string, from: string, to: string, version: number): SseEvent => ({ type: "plan.state", plan_id, from, to, version });
  const frame = (id: number, event: SseEvent): ConsoleAction => ({ type: "frame", frame: { id, event, receivedAt: id } });
  const run = (...frames: [number, SseEvent][]): ScopedConsoleState => frames.reduce((s, [id, e]) => reduceScoped(s, frame(id, e)), initialScopedState);
  const xrayEv: SseEvent = { type: "xray", contexts: [{ name: "delegate:lane-4", locked: true, preview: null }] };
  const runEv: SseEvent = { type: "creao.run", run_id: "r1", kind: "concierge", category: null, status: "completed", elapsed_ms: 16_000, source: "live", share_url: null };

  // Plan A ran to a release and was cancelled; plan B is created by chat: its NEW→COLLECTING marker (createPlanRecord)
  // comes before its lanes, then it researches.
  const planA: [number, SseEvent][] = [
    [1, planEv(A, "VOTING", "APPROVING", 5)],
    [2, laneEv(A, 1, "HELD", 8800)],
    [3, xrayEv],
    [4, runEv],
    [5, { type: "ledger", order_id: "o", lane: 1, status: "RELEASED", amount_cents: 8800, cybs_id_short: "abc" }],
    [6, { type: "counters", groups_converted: 1, fronted_by_individual_cents: 0, holds_released: 3 }],
    [7, laneEv(A, 1, "RELEASED")],
    [8, planEv(A, "CANCELLING", "CANCELLED", 7)],
  ];
  const planB: [number, SseEvent][] = [
    [10, planEv(B, "NEW", "COLLECTING", 1)],
    ...[11, 12, 13, 14].map((id, i): [number, SseEvent] => [id, laneEv(B, i + 1, "PREFS_DONE")]),
  ];

  it("a new plan takes the console over, and its next plan.state keeps its lanes", () => {
    const before = run(...planA, ...planB);
    expect(before.plan?.plan_id).toBe(B);
    expect(statusLine(before).big).toBe("4 budgets in.");
    // Nothing of plan A survives: no released money, no ledger ids, no concierge run, no "Guest 4" X-ray.
    expect(before.ledger).toEqual({});
    expect(before.creaoRuns).toEqual({});
    expect(before.xray).toEqual({});
    // Console-wide counters do survive.
    expect(before.counters?.groups_converted).toBe(1);
    const s = reduceScoped(before, frame(15, planEv(B, "COLLECTING", "RESEARCHING", 2)));
    expect(Object.keys(s.lanes)).toHaveLength(4);
    expect(s.plan).toEqual({ plan_id: B, state: "RESEARCHING", version: 2 });
    expect(statusLine(s)).toEqual({ big: "Finding plans.", small: "CREAO searches places. Budgets never leave SquadTab." });
  });

  it("a stranger's join to another plan never overwrites the plan on screen; that plan's own plan.state shows it", () => {
    const strangerLanes: [number, SseEvent][] = [[10, laneEv(B, 1, "JOINED")], [11, { type: "vote.tally", plan_id: B, voted: 0, total: 1 }]];
    const s = run(...planA, ...strangerLanes);
    expect(s.plan?.plan_id).toBe(A);
    expect(s.lanes[1]?.stage).toBe("RELEASED");
    expect(s.ledger[1]?.status).toBe("RELEASED");
    expect(s.tally).toBeNull();
    const adopted = reduceScoped(s, frame(12, planEv(B, "COLLECTING", "RESEARCHING", 2)));
    expect(adopted.plan?.plan_id).toBe(B);
    expect(adopted.lanes[1]?.stage).toBe("JOINED");
    expect(adopted.tally).toMatchObject({ voted: 0, total: 1 });
    expect(adopted.ledger).toEqual({});
  });

  it("the very first frame's plan goes up even without a plan.state, and its first plan.state keeps its lanes", () => {
    const lanesOnly = planB.slice(1);
    const s = run(...lanesOnly, [15, planEv(B, "COLLECTING", "RESEARCHING", 2)]);
    expect(Object.keys(s.lanes)).toHaveLength(4);
  });

  it("applies a frame that committed after a higher id (38 after 39, 40)", () => {
    const s = run([30, laneEv(B, 1, "JOINED")], [39, laneEv(B, 2, "JOINED")], [40, laneEv(B, 3, "JOINED")], [38, { type: "xray", contexts: [{ name: "scout_input:dinner", locked: false, preview: "{}" }] }]);
    expect(s.xray["scout_input:dinner"]).toBeDefined();
    expect(s.lastId).toBe(40);
  });

  it("a late frame never overwrites a newer value of the same slice", () => {
    const s = run([40, laneEv(B, 1, "HELD", 4200)], [38, laneEv(B, 1, "BUDGET_LOCKED")]);
    expect(s.lanes[1]?.stage).toBe("HELD");
  });

  it("a late frame of a plan the console already left is ignored", () => {
    const s = run(...planA.slice(0, 2), ...planB, [9, laneEv(A, 1, "RELEASED")], [8, xrayEv]);
    expect(s.plan?.plan_id).toBe(B);
    expect(s.lanes[1]?.stage).toBe("PREFS_DONE");
    expect(s.xray).toEqual({});
  });

  it("never applies an id twice, so a snapshot after live frames is a no-op", () => {
    const live = run(...planA, ...planB);
    const events = [...planA, ...planB].map(([id, data]) => ({ id, data }));
    expect(reduceScoped(live, { type: "snapshot", snapshot: { last_id: 13, events }, receivedAt: 99 })).toBe(live);
  });

  it("folds a snapshot in id order with the same plan scope", () => {
    const events = [...planB, ...planA].map(([id, data]) => ({ id, data })); // out of order on purpose
    const s = reduceScoped(initialScopedState, { type: "snapshot", snapshot: { last_id: 13, events }, receivedAt: 1 });
    expect(s.plan?.plan_id).toBe(B);
    expect(Object.keys(s.lanes)).toHaveLength(4);
    expect(statusLine(s).big).toBe("4 budgets in.");
  });
});
