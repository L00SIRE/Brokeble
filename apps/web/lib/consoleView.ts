// Trust Console view model (design-system §7). PURE: every sentence, rail, amount and meter value the console shows is
// derived here from ConsoleState, so the copy and the money arithmetic are unit-tested apart from the markup.
// consoleReducer stays the slice writer and decides which plan is on screen; reduceScoped (below) adds the commit-order
// and takeover-reset rules around it (design-system §12.1).
//
// Privacy (P1/P8): ConsoleState carries no budget values, and nothing here invents one. The "$X fits" proof is true by
// construction: computeShortlist keeps only bundles that pass every member's private constraints
// (apps/agent/src/decide/score.ts, filter(fitsPrefs(…), constraints)), and X is the public per-person share.
// GATED (a share above that member's private max, awaiting their YES) renders exactly like LINK_SENT, so the console
// never reveals that someone's budget sits below the share.
import { ResearchBrief, type LaneStage, type SseEvent, type TapStep } from "@tab/shared";
import {
  consoleReducer,
  initialConsoleState,
  type ConsoleAction,
  type ConsoleFrame,
  type ConsoleState,
  type LaneView,
  type LedgerRow,
  type PlanView,
  type XrayContext,
} from "./consoleReducer";
import { usd, usd0 } from "./format";

// ---------- plan scope and commit order ----------

/**
 * consoleReducer owns plan routing: a plan.state for another plan_id swaps the plan-scoped slices for whatever was
 * queued for that plan (adoptPlan), and another plan's lane/tally/shortlist is queued, never shown (routed), so a
 * stranger's /join cannot overwrite the plan on screen. Every plan creation path (createPlanRecord, ops seed) emits a
 * NEW→COLLECTING plan.state before its first lane, so a new plan still takes the console over at once. Two gaps the live
 * console hits are fixed here around it:
 * 1. A takeover also resets what the reducer keeps console-wide but belongs to one plan: CREAO runs, progress, X-ray.
 * 2. It drops every id ≤ lastId, but app.events ids are bigserials published in commit order, so a frame from a
 *    transaction that committed late was lost. Here frames are deduped by id, and each slice remembers the id that
 *    last wrote it, so a late frame fills a gap but never overwrites a newer value.
 */
export type ScopedConsoleState = ConsoleState & {
  /** Ids already applied, newest last (at most APPLIED_WINDOW). */
  applied: readonly number[];
  /** Slice key → id of the frame that last wrote it. Keys starting with "g:" outlive a plan. */
  wrote: Readonly<Record<string, number>>;
  /** Id of the frame that made `plan` current: an older frame without a plan_id belongs to a plan the console left. */
  planSince: number;
};

/** How far back an out-of-order commit can land. Older ids count as already applied (snapshot replays). */
export const APPLIED_WINDOW = 2000;

export const initialScopedState: ScopedConsoleState = { ...initialConsoleState, applied: [], wrote: {}, planSince: 0 };

/** What a takeover resets on top of consoleReducer's own plan-scoped slices (lanes, tally, shortlist, ledger, tap). */
const PLAN_RESET = { creaoRuns: {}, progress: [], xray: {} } satisfies Partial<ConsoleState>;
const CONSOLE_WIDE = new Set<SseEvent["type"]>(["counters", "delivery", "system"]);

/** The slice a frame overwrites (for the late-frame check); null for appended or merged slices. */
function sliceOf(e: SseEvent): string | null {
  switch (e.type) {
    case "plan.state":
      return "plan";
    case "lane":
      return `lane:${e.lane}`;
    case "ledger":
      return `ledger:${e.lane}`;
    case "creao.run":
      return `run:${e.run_id}`;
    case "shortlist":
    case "vote.tally":
    case "tap.signed":
    case "tap.verify":
      return e.type;
    case "counters":
      return "g:counters";
    case "delivery":
      return `g:delivery:${e.message_id_short}`;
    default:
      return null; // creao.progress and system append; xray merges by name
  }
}

const consoleWide = (wrote: ScopedConsoleState["wrote"]) => Object.fromEntries(Object.entries(wrote).filter(([k]) => k.startsWith("g:")));

function applyScoped(s: ScopedConsoleState, frame: ConsoleFrame): ScopedConsoleState {
  const { id, event: e } = frame;
  if (id <= s.lastId - APPLIED_WINDOW || s.applied.includes(id)) return s;
  const lastId = Math.max(s.lastId, id);
  const applied = [...s.applied, id].slice(-APPLIED_WINDOW);
  const skipped = { ...s, lastId, applied };
  const planId = "plan_id" in e ? e.plan_id : null;
  const onScreen = s.plan?.plan_id ?? null;
  // A late frame of a plan the console already left: the newer plan keeps the screen.
  if (!CONSOLE_WIDE.has(e.type) && id < s.planSince && planId !== onScreen) return skipped;
  // lastId: id − 1 lets the reducer apply a frame even when it committed after a higher id.
  // Another plan's lane, tally or shortlist (the only other frames that name a plan): consoleReducer queues it.
  if (planId !== null && onScreen !== null && planId !== onScreen && e.type !== "plan.state") {
    const queued = consoleReducer({ ...s, lastId: id - 1 }, frame);
    return { ...queued, lastId, applied, planSince: s.planSince, wrote: s.wrote };
  }
  const takeover = e.type === "plan.state" && e.plan_id !== onScreen;
  const base: ScopedConsoleState = takeover ? { ...s, ...PLAN_RESET, planSince: id, wrote: consoleWide(s.wrote) } : s;
  const key = sliceOf(e);
  if (key !== null && (base.wrote[key] ?? 0) > id) return { ...base, lastId, applied };
  const next = consoleReducer({ ...base, lastId: id - 1 }, frame);
  // No plan on screen yet: the reducer put this frame's plan up as a COLLECTING stub (routed), so it starts here.
  const planSince = onScreen === null && next.plan !== null ? id : base.planSince;
  return { ...next, lastId, applied, planSince, wrote: key === null ? base.wrote : { ...base.wrote, [key]: id } };
}

/** The console's reducer: live frames, and snapshots folded in id order, through the plan scope above. */
export function reduceScoped(state: ScopedConsoleState, action: ConsoleAction): ScopedConsoleState {
  if (action.type === "frame") return applyScoped(state, action.frame);
  return action.snapshot.events
    .toSorted((a, b) => a.id - b.id)
    .reduce((s, { id, data }) => applyScoped(s, { id, event: data, receivedAt: action.receivedAt }), state);
}

/** The five visual states of design-system §3.2. Everything before a hold reads as one calm "idle" look. */
export type Look = "idle" | "held" | "captured" | "released" | "declined";

const LOOK: Record<LaneStage, Look> = {
  INVITED: "idle",
  JOINED: "idle",
  BUDGET_LOCKED: "idle",
  PREFS_DONE: "idle",
  VOTED: "idle",
  GATED: "idle",
  LINK_SENT: "idle",
  HELD: "held",
  CAPTURED: "captured",
  RELEASED: "released",
  DECLINED: "declined",
};
export const lookFor = (stage: LaneStage): Look => LOOK[stage];

/** Chip token: uppercase protocol state (§3.3). GATED shares LINK_SENT's token on purpose (see the header note). */
const CHIP: Record<LaneStage, string> = {
  INVITED: "INVITED",
  JOINED: "JOINED",
  BUDGET_LOCKED: "LOCKED",
  PREFS_DONE: "LOCKED",
  VOTED: "VOTED",
  GATED: "VOTED",
  LINK_SENT: "VOTED",
  HELD: "HELD",
  CAPTURED: "CAPTURED",
  RELEASED: "RELEASED",
  DECLINED: "DECLINED",
};
export const chipFor = (stage: LaneStage): string => CHIP[stage];

/** Journey order; RELEASED sits after HELD (only a held share can be released), DECLINED is pre-HELD only (PLAN §7). */
const ORDER: Record<LaneStage, number> = {
  INVITED: 0,
  JOINED: 1,
  BUDGET_LOCKED: 2,
  PREFS_DONE: 3,
  VOTED: 4,
  GATED: 5,
  LINK_SENT: 5,
  HELD: 6,
  CAPTURED: 7,
  RELEASED: 7,
  DECLINED: 1,
};
const atLeast = (stage: LaneStage, min: LaneStage) => ORDER[stage] >= ORDER[min];

export const displayName = (lane: Pick<LaneView, "lane" | "first_name">): string => lane.first_name.trim() || `Guest ${lane.lane}`;

export const sortLanes = (lanes: Record<number, LaneView>): LaneView[] => Object.values(lanes).toSorted((a, b) => a.lane - b.lane);

/**
 * A CONFIRMED plan has captured every hold (the agent confirms only after order.captured), but a lane turns CAPTURED
 * only on its own share.captured hook, which is late or never sent in VENUE_MODE=mock and Replay. So once the plan is
 * CONFIRMED, HELD reads as CAPTURED: lanes, meter and status then agree. Returns the same object when nothing changes.
 */
export function settledLanes(lanes: Record<number, LaneView>, plan: PlanView | null): Record<number, LaneView> {
  if (plan?.state !== "CONFIRMED" || !Object.values(lanes).some((l) => l.stage === "HELD")) return lanes;
  return Object.fromEntries(Object.values(lanes).map((l) => [l.lane, l.stage === "HELD" ? { ...l, stage: "CAPTURED" as const } : l]));
}

/**
 * Seats in the plan, or null while the group is still gathering: lanes appear as friends join, so until research
 * starts no sentence may claim "of n" (2 lanes of a 4-person plan read "2 of 2"). Once a shortlist, a tally or a vote
 * exists, the lanes are the roster that votes and holds.
 */
export function seatCount(state: Pick<ConsoleState, "plan" | "lanes" | "tally" | "shortlist">): number | null {
  const lanes = Object.values(state.lanes);
  if (lanes.length === 0) return null;
  const gathering =
    (!state.plan || state.plan.state === "" || state.plan.state === "COLLECTING") &&
    state.shortlist === null &&
    state.tally === null &&
    !lanes.some((l) => atLeast(l.stage, "VOTED"));
  return gathering ? null : lanes.length;
}

// ---------- rail ----------

export const STATIONS = ["Joined", "Voted", "Held", "Captured"] as const;
export type StationMark = "todo" | "done" | "now" | "end";
export type Rail = {
  stations: { label: string; mark: StationMark }[];
  /** Index of the last station reached with a solid line (−1: none). */
  solidTo: number;
  /** RELEASED and DECLINED keep their history, then run dashed to an end mark on the last station. */
  ended: boolean;
};

const REACHED: Record<LaneStage, number> = {
  INVITED: -1,
  JOINED: 0,
  BUDGET_LOCKED: 0,
  PREFS_DONE: 0,
  VOTED: 1,
  GATED: 1,
  LINK_SENT: 1,
  HELD: 2,
  CAPTURED: 3,
  RELEASED: 2, // it was held: the history stays, nothing is erased
  DECLINED: 1, // DECLINED keeps Voted (design-system §0, P1 row "RELEASED reads as failure")
};

export function railFor(stage: LaneStage): Rail {
  const solidTo = REACHED[stage];
  const ended = stage === "RELEASED" || stage === "DECLINED";
  const stations = STATIONS.map((label, i): { label: string; mark: StationMark } => {
    if (ended && i === STATIONS.length - 1) return { label: stage === "RELEASED" ? "Released" : "Declined", mark: "end" };
    if (stage === "HELD" && i === 2) return { label, mark: "now" };
    return { label, mark: i <= solidTo ? "done" : "todo" };
  });
  return { stations, solidTo, ended };
}

// ---------- money ----------

/**
 * The plan's public per-person share in cents, or null before any order exists. Every share is the same
 * all-in per-person price (priceBundle), so the first known amount is the plan's price. Lane amounts are dropped by
 * later stage events (RELEASED carries null), so the ledger is the fallback.
 */
export function shareCents(lanes: readonly LaneView[], ledger: Record<number, LedgerRow>): number | null {
  for (const l of lanes) if (l.amount_cents !== null) return l.amount_cents;
  for (const r of Object.values(ledger).toSorted((a, b) => a.lane - b.lane)) if (r.amount_cents > 0) return r.amount_cents;
  return null;
}

export type Amount = { value: string; caption: string; quiet: boolean };

/** Lane amount (§3.2): a released or declined lane says "$0.00 charged" in the primary color, never struck through. */
export function amountFor(lane: LaneView, share: number | null): Amount {
  const cents = lane.amount_cents ?? share;
  switch (lane.stage) {
    case "HELD":
      return { value: cents === null ? "—" : usd(cents), caption: "held, not charged", quiet: false };
    case "CAPTURED":
      return { value: cents === null ? "—" : usd(cents), caption: "charged", quiet: false };
    case "RELEASED":
    case "DECLINED":
      return { value: usd(0), caption: "charged", quiet: false };
    default:
      // Before the vote there is no price: an empty cell, not a lone dash that reads as broken from 5 m.
      return cents === null ? { value: "", caption: "", quiet: true } : { value: usd(cents), caption: "share", quiet: true };
  }
}

export type MeterMode = "empty" | "holding" | "full" | "captured" | "released";
export type Money = {
  mode: MeterMode;
  /** Seats (lanes) in the plan. */
  n: number;
  /** Lanes whose card is held or already captured: the gate's lit cells. */
  heldCount: number;
  heldCents: number;
  chargedCents: number;
  /** n × share once the share is known; null before (the meter then reads "of —"). */
  totalCents: number | null;
  releasedCount: number;
  share: number | null;
  /** True when every captured amount equals the share, so "n × $share" is an exact description. */
  uniform: boolean;
};

export function money(state: Pick<ConsoleState, "lanes" | "ledger">): Money {
  const lanes = sortLanes(state.lanes);
  const share = shareCents(lanes, state.ledger);
  const n = lanes.length;
  let heldCount = 0;
  let heldCents = 0;
  let chargedCents = 0;
  let captured = 0;
  let held = 0;
  let releasedCount = 0;
  let uniform = true;
  for (const l of lanes) {
    const cents = l.amount_cents ?? share ?? 0;
    if (l.stage === "HELD") {
      held += 1;
      heldCount += 1;
      heldCents += cents;
    } else if (l.stage === "CAPTURED") {
      captured += 1;
      heldCount += 1;
      heldCents += cents;
      chargedCents += cents;
      if (share !== null && cents !== share) uniform = false;
    } else if (l.stage === "RELEASED") releasedCount += 1;
  }
  const totalCents = share === null ? null : share * n;
  const mode: MeterMode =
    n === 0
      ? "empty"
      : captured === n
        ? "captured"
        : releasedCount > 0 && held === 0 && captured === 0
          ? "released"
          : heldCount === n
            ? "full"
            : "holding";
  return { mode, n, heldCount, heldCents, chargedCents, totalCents, releasedCount, share, uniform };
}

export type Meter = { label: string; number: string; of: string; sub: { text: string; strong: string; rest: string } };

/** Gate meter copy (§7.2). `sub` is split so the component can bold one figure without parsing strings. */
export function meterFor(m: Money): Meter {
  switch (m.mode) {
    case "captured":
      return {
        label: "Captured, all or nothing",
        number: usd0(m.chargedCents),
        of: "",
        sub: { text: "Charged ", strong: usd0(m.chargedCents), rest: m.uniform && m.share !== null ? ` · ${m.n} × ${usd0(m.share)}` : ` · split ${m.n} ways` },
      };
    case "released":
      return { label: "Released", number: "$0", of: "charged", sub: { text: "", strong: String(m.releasedCount), rest: ` ${m.releasedCount === 1 ? "hold" : "holds"} released · nobody paid` } };
    default:
      return {
        label: "Held so far",
        number: usd0(m.heldCents),
        of: m.totalCents === null ? "of —" : `of ${usd0(m.totalCents)}`,
        sub: { text: "Charged ", strong: usd0(m.chargedCents), rest: m.n === 0 ? "" : ` · ${m.heldCount} of ${m.n} holds` },
      };
  }
}

// ---------- proof line ----------

export type Proof = { kind: "unset" | "hidden"; text: string; fits: string | null };

/**
 * "Budget hidden · $X fits" only when the lane is at least BUDGET_LOCKED, a shortlist exists and the share is known
 * (§7.2 allows only "$X fits"). Before that: "Budget hidden"; at INVITED or JOINED: "Budget not set yet". DECLINED
 * makes no fits claim: a decliner may never have set a budget, and a recompute no longer counts them.
 */
export function proofFor(stage: LaneStage, o: { shortlist: ConsoleState["shortlist"]; share: number | null }): Proof {
  if (stage === "DECLINED") return { kind: "hidden", text: "Budget hidden", fits: null };
  if (!atLeast(stage, "BUDGET_LOCKED")) return { kind: "unset", text: "Budget not set yet", fits: null };
  if (!o.shortlist || o.shortlist.survived_count < 1 || o.share === null) return { kind: "hidden", text: "Budget hidden", fits: null };
  return { kind: "hidden", text: "Budget hidden", fits: `${usd0(o.share)} fits` };
}

// ---------- status sentence ----------

export type Status = { big: string; small: string };

/** The voted bundle, when the share identifies exactly one shortlist bundle. */
function chosenTitle(shortlist: ConsoleState["shortlist"], share: number | null): string | null {
  if (!shortlist || share === null) return null;
  const hits = shortlist.bundles.filter((b) => b.all_in_pp_cents === share);
  return hits.length === 1 ? `${hits[0]!.dinner_name} + ${hits[0]!.show_name}` : null;
}

const STOPPED = new Set(["CANCELLING", "CANCELLED"]);
const ORDERING = new Set(["ORDERING", "APPROVING", "COMMITTING"]);

/** Status sentence (§7.2), most specific state first. Strings marked NEW in contract notes are not in §7.2. */
export function statusLine(state: Pick<ConsoleState, "plan" | "lanes" | "ledger" | "tally" | "shortlist">): Status {
  const lanes = sortLanes(state.lanes);
  if (lanes.length === 0) {
    if (state.plan && STOPPED.has(state.plan.state)) return { big: "Plan called off.", small: "Nobody was charged." };
    return { big: "Waiting for the group.", small: "Text SquadTab to start a plan. Lanes appear as friends join." };
  }
  const m = money(state);
  const n = m.n;
  if (m.mode === "captured") {
    const split = m.uniform && m.share !== null ? `${n} × ${usd(m.share)}` : `split ${n} ways`;
    return { big: "Everyone’s in. Booked.", small: `${usd(m.chargedCents)} captured, ${split}. Nobody fronted a cent.` };
  }
  const declined = lanes.find((l) => l.stage === "DECLINED");
  const holding = lanes.some((l) => l.stage === "HELD");
  if (declined && holding) {
    return { big: `${displayName(declined)} can’t make it.`, small: "Releasing every hold. Nobody pays for a plan that didn’t happen." };
  }
  if (m.mode === "released") return { big: "Every hold released.", small: "Nobody paid. Holds drop off cards with no charge." };
  if (holding && m.releasedCount > 0) return { big: "Releasing every hold.", small: "Nobody pays for a plan that didn’t happen." };
  if (state.plan && STOPPED.has(state.plan.state)) return { big: "Plan called off.", small: "Nobody was charged." };
  if (m.heldCount > 0) {
    return { big: `${m.heldCount} of ${n} held.`, small: m.heldCount < n ? `Nobody is charged until ${n} of ${n}.` : "Everyone’s held. Booking now." };
  }
  const tally = state.tally;
  const allVoted = tally !== null && tally.total > 0 && tally.voted >= tally.total;
  if (allVoted || (state.plan && ORDERING.has(state.plan.state))) {
    const title = chosenTitle(state.shortlist, m.share);
    const price = m.share === null ? null : `${usd0(m.share)} each`;
    const lead = [title, price].filter(Boolean).join(", ");
    const voted = tally && tally.total > 0 ? tally.total : n;
    return { big: `${voted} of ${voted} voted.`, small: lead ? `${lead}. Holding cards now.` : "Holding cards now." };
  }
  if (tally && tally.total > 0 && (state.plan?.state === "VOTING" || tally.voted > 0)) {
    return { big: `${tally.voted} of ${tally.total} voted.`, small: "Every option on the ballot fits every budget." };
  }
  if (state.plan?.state === "RESEARCHING") return { big: "Finding plans.", small: "CREAO searches places. Budgets never leave SquadTab." };
  const locked = lanes.filter((l) => l.stage !== "DECLINED" && atLeast(l.stage, "BUDGET_LOCKED")).length;
  const seats = seatCount(state);
  const big = seats === null ? `${locked} ${locked === 1 ? "budget" : "budgets"} in.` : `${locked} of ${seats} budgets in.`;
  return { big, small: "Each friend sets a budget in a private text. Nobody sees anyone else’s." };
}

// ---------- plan facts (from the public CREAO brief, P6) ----------

export type PlanFacts = { what: string | null; when: string | null; area: string | null; party: number | null; dietary: string[] };

const briefsOf = (xray: Record<string, XrayContext>): ResearchBrief[] =>
  Object.values(xray)
    .filter((c) => c.name.startsWith("scout_input:") && !c.locked && c.preview !== null)
    .flatMap((c) => {
      try {
        const parsed = ResearchBrief.safeParse(JSON.parse(c.preview!));
        return parsed.success ? [parsed.data] : [];
      } catch {
        return [];
      }
    });

/** "19:00" → "7:00 PM". */
export function clock12(hhmm: string): string {
  const [h = 0, m = 0] = hhmm.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

/** "2026-10-17" → "Sat" (the date is a calendar day, so it is read in UTC to avoid a timezone shift). */
export function weekday(isoDate: string): string | null {
  const d = new Date(`${isoDate}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
}

/** Plan facts exactly as the Scout briefs carry them: no names, phones or budgets can be in there (ResearchBrief). */
export function planFacts(xray: Record<string, XrayContext>): PlanFacts {
  const briefs = briefsOf(xray);
  const first = briefs[0];
  if (!first) return { what: null, when: null, area: null, party: null, dietary: [] };
  const cats = new Set(briefs.map((b) => b.category));
  const what = cats.has("dinner") && cats.has("show") ? "Dinner + show" : cats.has("dinner") ? "Dinner" : "Show";
  const day = weekday(first.date);
  const start = briefs.map((b) => b.time_window.start).toSorted()[0]!;
  return {
    what,
    when: day ? `${day} ${clock12(start)}` : clock12(start),
    area: first.area,
    party: first.party_size,
    dietary: [...new Set(briefs.flatMap((b) => b.dietary_tags))].toSorted(),
  };
}

/** Header meta: "Dinner + show · Sat 7:00 PM · Santa Monica · 4 people". `seats` is seatCount (null while gathering). */
export function planMeta(facts: PlanFacts, seats: number | null): string {
  const people = facts.party ?? seats;
  return [facts.what, facts.when, facts.area, people === null ? null : `${people} people`].filter(Boolean).join(" · ");
}

/** "What the group sees": the public facts only. Null until anything public exists. */
export function groupSees(facts: PlanFacts, o: { laneCount: number; shortlist: ConsoleState["shortlist"]; share: number | null }): string | null {
  const people = facts.party ?? (o.laneCount > 0 ? o.laneCount : null);
  const parts = [
    people === null ? null : `${people} people`,
    o.shortlist && o.shortlist.survived_count > 0 ? "every budget fits" : null,
    o.share === null ? null : `${usd0(o.share)} each`,
    facts.area,
    facts.what?.toLowerCase() ?? null,
    facts.dietary.length ? facts.dietary.join(", ").replace(/_/g, " ") : null,
  ].filter(Boolean);
  return facts.what === null && o.shortlist === null ? null : parts.join(" · ");
}

/** "What only SquadTab sees": one row per private delegate context, by lane. Never a preview. */
export function lockedLanes(xray: Record<string, XrayContext>, lanes: Record<number, LaneView>): { lane: number; name: string }[] {
  return Object.values(xray)
    .flatMap((c) => {
      const m = /^delegate:lane-(\d+)$/.exec(c.name);
      if (!m) return [];
      const lane = Number(m[1]);
      return [{ lane, name: lanes[lane] ? displayName(lanes[lane]) : `Guest ${lane}` }];
    })
    .toSorted((a, b) => a.lane - b.lane);
}

/** Lane text for screen readers (§9): "Maya: HELD, $42.00 held, not charged". */
export const laneSummary = (lane: LaneView, share: number | null): string => {
  const a = amountFor(lane, share);
  return `${displayName(lane)}: ${chipFor(lane.stage)}${a.value ? `, ${a.value} ${a.caption}` : ""}`;
};

// ---------- TAP summary (§7.2) ----------

export type TapPhase = "idle" | "signed" | "verified" | "rejected";
/** `ok`: true passed, false failed, null not yet. `strong` is the bold part of the line, after `text`. */
export type TapLine = { ok: boolean | null; text: string; strong?: string };

/** Reads `keyid`, `created` and `expires` from an RFC 9421 Signature-Input value; missing fields are null. */
export function parseSignatureInput(input: string): { keyid: string | null; created: number | null; expires: number | null } {
  const num = (re: RegExp) => {
    const m = re.exec(input);
    return m ? Number(m[1]) : null;
  };
  return { keyid: /;keyid="([^"]+)"/.exec(input)?.[1] ?? null, created: num(/;created=(\d+)/), expires: num(/;expires=(\d+)/) };
}

/**
 * The 3-line human summary of the signed agent request. Never "Visa-verified" (PLAN §1): the merchant verifies.
 * `now` is epoch ms, so "Expires in n min" counts down honestly against the signature's own `expires`.
 */
export function tapSummary(signed: ConsoleState["tapSigned"], verify: ConsoleState["tapVerify"], now: number): { phase: TapPhase; lines: [TapLine, TapLine, TapLine] } {
  const report = verify?.report ?? null;
  if (!signed && !report) {
    return {
      phase: "idle",
      lines: [
        { ok: null, text: "Signed by: waiting for checkout" },
        { ok: null, text: "Expires: not yet signed" },
        { ok: null, text: "Merchant check: not yet sent" },
      ],
    };
  }
  // VENUE_MODE=mock (apps/agent ports/venue.mock.ts) emits only tap.verify, with no signature base and steps labelled
  // "mock": nothing was signed, so the summary says it is the labelled simulation instead of claiming a signature
  // (C plan §0.6). The live client always emits tap.signed before tap.verify.
  if (!signed && report && report.signature_base === "" && report.steps.some((s) => /\bmock\b/.test(s.detail))) {
    const r = report;
    return {
      phase: r.accepted ? "verified" : "rejected",
      lines: [
        { ok: null, text: `Labelled simulation · ${r.route}` },
        { ok: null, text: "Mock venue: no signature in mock mode" },
        r.accepted ? { ok: true, text: "", strong: "Mock checks passed" } : { ok: false, text: "", strong: `Rejected by mock venue${r.reason ? `: ${r.reason}` : ""}` },
      ],
    };
  }
  const sig = signed ? parseSignatureInput(signed.signature_input) : null;
  const first: TapLine = signed
    ? { ok: true, text: `Signed by ${sig?.keyid ?? "the agent"} · ${signed.method} ${signed.path}` }
    : { ok: true, text: `Signed agent request · ${report!.route}` };
  // A failed timestamps or nonce step (the "expired" and "replay" tests) must never read as "never reused".
  const failed = (name: TapStep["name"]) => report?.steps.some((s) => s.name === name && !s.ok) ?? false;
  const mins = sig?.expires != null ? Math.ceil((sig.expires * 1000 - now) / 60_000) : null;
  const expiry = failed("timestamps")
    ? "Signature expired"
    : mins === null
      ? "Short-lived signature"
      : mins > 0
        ? `Expires in ${mins} min`
        : "Signature window closed";
  const nonce = failed("nonce") ? "nonce already used" : "nonce never reused";
  const second: TapLine = { ok: !failed("timestamps") && !failed("nonce"), text: `${expiry} · ${nonce}` };
  if (!report) return { phase: "signed", lines: [first, second, { ok: null, text: "Merchant is checking the signature" }] };
  if (report.accepted) return { phase: "verified", lines: [first, second, { ok: true, text: "", strong: "Verified by merchant" }] };
  return { phase: "rejected", lines: [first, second, { ok: false, text: "", strong: `Rejected by merchant${report.reason ? `: ${report.reason}` : ""}` }] };
}
