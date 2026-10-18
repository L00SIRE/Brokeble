// Trust Console state (B plan T9). consoleReducer is PURE and unit-tested; every panel renders a slice of ConsoleState.
// Frames with id ≤ lastId are ignored, so the snapshot and the SSE Last-Event-ID replay never double-apply.
// No budget value can appear here: SseEvent (P8) has no budget fields.
import type { LaneStage, SseEvent } from "@tab/shared";

type Ev<T extends SseEvent["type"]> = Extract<SseEvent, { type: T }>;
type Body<T extends SseEvent["type"]> = Omit<Ev<T>, "type">;

export type LaneView = { plan_id: string; lane: number; first_name: string; stage: LaneStage; amount_cents: number | null; cybs_id_short: string | null };
export type LedgerRow = Body<"ledger">;
export type CreaoRunView = Body<"creao.run"> & { first_seen_at: number }; // client clock, for the ticking elapsed chip
export type ProgressLine = Body<"creao.progress"> & { id: number };
export type XrayContext = Ev<"xray">["contexts"][number];
export type DeliveryDot = Body<"delivery"> & { id: number };
export type SystemLine = Body<"system"> & { id: number };
export type PlanView = { plan_id: string; state: string; version: number };

export type ConsoleState = {
  lastId: number;
  plan: PlanView | null;
  lanes: Record<number, LaneView>; // by lane
  tally: Body<"vote.tally"> | null;
  shortlist: Body<"shortlist"> | null;
  xray: Record<string, XrayContext>; // merged by name (each xray event is a partial list)
  creaoRuns: Record<string, CreaoRunView>; // by run_id
  progress: ProgressLine[]; // oldest first, ≤ MAX_PROGRESS
  tapSigned: Body<"tap.signed"> | null;
  tapVerify: Body<"tap.verify"> | null;
  ledger: Record<number, LedgerRow>; // by lane
  counters: Body<"counters"> | null;
  deliveries: DeliveryDot[]; // oldest first, ≤ MAX_DELIVERIES
  system: SystemLine[]; // oldest first, ≤ MAX_SYSTEM
  /** lane/tally/shortlist events for plans that are not on screen yet, by plan_id; adopted when that plan takes over. */
  pending: Record<string, PendingSlices>;
};

type PendingSlices = { lanes: Record<number, LaneView>; tally: Body<"vote.tally"> | null; shortlist: Body<"shortlist"> | null };

export const MAX_PROGRESS = 8;
export const MAX_DELIVERIES = 12;
export const MAX_SYSTEM = 6;
export const MAX_RUNS = 4;
export const MAX_PENDING_PLANS = 4;

export const initialConsoleState: ConsoleState = {
  lastId: 0,
  plan: null,
  lanes: {},
  tally: null,
  shortlist: null,
  xray: {},
  creaoRuns: {},
  progress: [],
  tapSigned: null,
  tapVerify: null,
  ledger: {},
  counters: null,
  deliveries: [],
  system: [],
  pending: {},
};

/** One SSE frame: `id` is the app.events id; `receivedAt` is Date.now() when it arrived (keeps the reducer pure). */
export type ConsoleFrame = { id: number; event: SseEvent; receivedAt: number };

/** GET /events/snapshot body (PLAN §18): the last 500 events, oldest first. */
export type ConsoleSnapshot = { last_id: number; events: { id: number; data: SseEvent }[] };

/** Stepper labels, driven by plan.state (Gather → Research → Vote → Hold → Book). */
export const PLAN_STEPS = ["Gather", "Research", "Vote", "Hold", "Book"] as const;

const capped = <T>(list: readonly T[], item: T, max: number): T[] => [...list, item].slice(-max);

/** Plan-scoped slices that a different plan must not inherit. */
const PLAN_SCOPED = { lanes: {}, tally: null, shortlist: null, ledger: {}, tapSigned: null, tapVerify: null } as const;

/** Puts `plan_id` on screen: plan-scoped slices restart from whatever was queued for it. */
function adoptPlan(state: ConsoleState, plan: PlanView): ConsoleState {
  const { [plan.plan_id]: queued, ...pending } = state.pending;
  return { ...state, ...PLAN_SCOPED, ...queued, plan, pending };
}

/**
 * Routes a lane/tally/shortlist event by its plan_id. Same plan: applied. No plan yet: that event's plan takes the
 * screen as a COLLECTING stub (a new plan collecting people emits no plan.state of its own, and the stepper needs a
 * current step). Any other plan keeps the screen out: a stranger's join must not overwrite the demo, not even after it
 * is CONFIRMED (the ledger and TAP evidence stay up). Its events are queued and show once that plan's own plan.state
 * arrives (ops Reset seeds lanes before it).
 */
function routed(state: ConsoleState, plan_id: string, apply: (slices: PendingSlices) => PendingSlices): ConsoleState {
  const cur = state.plan;
  if (!cur || cur.plan_id === plan_id) {
    const base = cur ? state : { ...state, plan: { plan_id, state: "COLLECTING", version: 0 } };
    const { lanes, tally, shortlist } = apply({ lanes: base.lanes, tally: base.tally, shortlist: base.shortlist });
    return { ...base, lanes, tally, shortlist };
  }
  const queued = apply(state.pending[plan_id] ?? { lanes: {}, tally: null, shortlist: null });
  const { [plan_id]: _, ...rest } = state.pending;
  const pending = { ...rest, [plan_id]: queued }; // re-inserted last, so the oldest plans fall off first
  const keep = Object.keys(pending).slice(-MAX_PENDING_PLANS);
  return { ...state, pending: Object.fromEntries(keep.map((k) => [k, pending[k]!])) };
}

/**
 * Applies one frame (ignored if id ≤ lastId). A plan.state for a different plan_id swaps the plan-scoped slices
 * (lanes, tally, shortlist, ledger, tap*) for whatever that plan already queued. lane/tally/shortlist events are
 * routed by plan_id (see `routed`). xray merges by name; lists and CREAO runs are capped.
 */
export function consoleReducer(state: ConsoleState, frame: ConsoleFrame): ConsoleState {
  const { id, event: e, receivedAt } = frame;
  if (id <= state.lastId) return state;
  const next = { ...state, lastId: id };
  switch (e.type) {
    case "plan.state": {
      const plan = { plan_id: e.plan_id, state: e.to, version: e.version };
      if (state.plan?.plan_id === e.plan_id) return { ...next, plan };
      return adoptPlan(next, plan);
    }
    case "lane": {
      const view: LaneView = { plan_id: e.plan_id, lane: e.lane, first_name: e.first_name, stage: e.stage, amount_cents: e.amount_cents, cybs_id_short: e.cybs_id_short };
      return routed(next, e.plan_id, (s) => ({ ...s, lanes: { ...s.lanes, [e.lane]: view } }));
    }
    case "creao.run": {
      const { type: _, ...run } = e;
      const prev = state.creaoRuns[e.run_id];
      const merged = { ...state.creaoRuns, [e.run_id]: { ...run, first_seen_at: prev?.first_seen_at ?? receivedAt } };
      // Reset/Replay and live runs keep adding chips; only the newest MAX_RUNS stay so the panel cannot grow without bound.
      const keys = Object.keys(merged);
      const creaoRuns = keys.length <= MAX_RUNS ? merged : Object.fromEntries(keys.slice(-MAX_RUNS).map((k) => [k, merged[k]!]));
      return { ...next, creaoRuns };
    }
    case "creao.progress": {
      const { type: _, ...line } = e;
      return { ...next, progress: capped(state.progress, { ...line, id }, MAX_PROGRESS) };
    }
    case "shortlist": {
      const { type: _, ...shortlist } = e;
      return routed(next, e.plan_id, (s) => ({ ...s, shortlist }));
    }
    case "vote.tally": {
      const { type: _, ...tally } = e;
      return routed(next, e.plan_id, (s) => ({ ...s, tally }));
    }
    case "tap.signed": {
      const { type: _, ...tapSigned } = e;
      return { ...next, tapSigned };
    }
    case "tap.verify": {
      const { type: _, ...tapVerify } = e;
      return { ...next, tapVerify };
    }
    case "ledger": {
      const { type: _, ...row } = e;
      return { ...next, ledger: { ...state.ledger, [e.lane]: row } };
    }
    case "counters": {
      const { type: _, ...counters } = e;
      return { ...next, counters };
    }
    case "xray":
      return { ...next, xray: { ...state.xray, ...Object.fromEntries(e.contexts.map((c) => [c.name, c])) } };
    case "delivery": {
      // One dot per message: its later statuses update it in place instead of adding dots.
      const { type: _, ...dot } = e;
      const at = state.deliveries.findIndex((d) => d.message_id_short === e.message_id_short);
      const deliveries = at < 0 ? capped(state.deliveries, { ...dot, id }, MAX_DELIVERIES) : state.deliveries.map((d, i) => (i === at ? { ...dot, id } : d));
      return { ...next, deliveries };
    }
    case "system": {
      const { type: _, ...line } = e;
      return { ...next, system: capped(state.system, { ...line, id }, MAX_SYSTEM) };
    }
  }
}

/** Folds a snapshot through consoleReducer in id order (all frames get `receivedAt`). */
export function applySnapshot(state: ConsoleState, snapshot: ConsoleSnapshot, receivedAt: number): ConsoleState {
  return [...snapshot.events]
    .sort((a, b) => a.id - b.id)
    .reduce((s, { id, data }) => consoleReducer(s, { id, event: data, receivedAt }), state);
}

/** What the console's useReducer receives: a live SSE frame, or the snapshot fetched on open. */
export type ConsoleAction = { type: "frame"; frame: ConsoleFrame } | { type: "snapshot"; snapshot: ConsoleSnapshot; receivedAt: number };

export function reduceConsole(state: ConsoleState, action: ConsoleAction): ConsoleState {
  return action.type === "frame" ? consoleReducer(state, action.frame) : applySnapshot(state, action.snapshot, action.receivedAt);
}

/** plan.state → PLAN_STEPS index: COLLECTING 0, RESEARCHING 1, VOTING 2, ORDERING/APPROVING 3, COMMITTING 4, CONFIRMED PLAN_STEPS.length (every step done); CANCELLING/CANCELLED/unknown → -1. */
export function stepFor(planState: string): number {
  switch (planState) {
    case "COLLECTING":
      return 0;
    case "RESEARCHING":
      return 1;
    case "VOTING":
      return 2;
    case "ORDERING":
    case "APPROVING":
      return 3;
    case "COMMITTING":
      return 4;
    case "CONFIRMED":
      return PLAN_STEPS.length;
    default:
      return -1;
  }
}
