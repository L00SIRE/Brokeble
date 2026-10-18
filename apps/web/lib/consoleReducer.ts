// Trust Console state (B plan T9). consoleReducer is PURE and unit-tested; every panel renders a slice of ConsoleState.
// Frames with id ≤ lastId are ignored, so the snapshot and the SSE Last-Event-ID replay never double-apply.
// No budget value can appear here: SseEvent (P8) has no budget fields.
import type { LaneStage, SseEvent } from "@tab/shared";

type Ev<T extends SseEvent["type"]> = Extract<SseEvent, { type: T }>;
type Body<T extends SseEvent["type"]> = Omit<Ev<T>, "type">;

export type LaneView = { lane: number; first_name: string; stage: LaneStage; amount_cents: number | null; cybs_id_short: string | null };
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
};

export const MAX_PROGRESS = 8;
export const MAX_DELIVERIES = 12;
export const MAX_SYSTEM = 6;

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

/**
 * Applies one frame (ignored if id ≤ lastId). A plan.state for a different plan_id resets the plan-scoped slices
 * (lanes, tally, shortlist, ledger, tap*). xray merges by name; lists are capped at their MAX_*.
 */
export function consoleReducer(state: ConsoleState, frame: ConsoleFrame): ConsoleState {
  const { id, event: e, receivedAt } = frame;
  if (id <= state.lastId) return state;
  const next = { ...state, lastId: id };
  switch (e.type) {
    case "plan.state": {
      const fresh = state.plan?.plan_id !== e.plan_id;
      return { ...next, ...(fresh ? PLAN_SCOPED : {}), plan: { plan_id: e.plan_id, state: e.to, version: e.version } };
    }
    case "lane":
      return {
        ...next,
        lanes: { ...state.lanes, [e.lane]: { lane: e.lane, first_name: e.first_name, stage: e.stage, amount_cents: e.amount_cents, cybs_id_short: e.cybs_id_short } },
      };
    case "creao.run": {
      const { type: _, ...run } = e;
      return { ...next, creaoRuns: { ...state.creaoRuns, [e.run_id]: { ...run, first_seen_at: state.creaoRuns[e.run_id]?.first_seen_at ?? receivedAt } } };
    }
    case "creao.progress": {
      const { type: _, ...line } = e;
      return { ...next, progress: capped(state.progress, { ...line, id }, MAX_PROGRESS) };
    }
    case "shortlist": {
      const { type: _, ...shortlist } = e;
      return { ...next, shortlist };
    }
    case "vote.tally": {
      const { type: _, ...tally } = e;
      return { ...next, tally };
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

/** plan.state → PLAN_STEPS index: COLLECTING 0, RESEARCHING 1, VOTING 2, ORDERING/APPROVING 3, COMMITTING/CONFIRMED 4; CANCELLING/CANCELLED/unknown → -1. */
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
    case "CONFIRMED":
      return 4;
    default:
      return -1;
  }
}
