/**
 * The landing hero's scripted replay (design-system §4.3): a pure function of time.
 *
 * It mirrors the console state machine with no network and no randomness, so the price mark,
 * the ticket copy and the hold rings all read the same clock and can never disagree.
 * Two short cycles, 21 s in total, each starting on an already-assembled frame:
 *   A (11 s): four holds land one by one, then CAPTURED and the stub tears.
 *   B (10 s): three holds, the fourth friend drops, every hold is released.
 */

export type SeatState = "VOTED" | "HELD" | "CAPTURED" | "RELEASED" | "DECLINED";

export const SEAT_COUNT = 4;
/** Index of the friend who drops in cycle B (the last seat, "Priya" in the demo). */
export const DROP_SEAT = 3;
/** Each released seat lags the previous one by this much (s). */
export const RELEASE_STAGGER = 0.14;
/** The perforation opens this long after capture (s): 4.7 + 0.35 = 5.05. */
export const TEAR_DELAY = 0.35;
/** All four held, before capture: the calm frame for focus, reduced motion and the static cut. */
export const CALM_T = 4.2;

export type CapturedCycle = {
  readonly kind: "captured";
  readonly len: number;
  readonly held: readonly number[];
  readonly capture: number;
  readonly reset: number;
};
export type ReleasedCycle = {
  readonly kind: "released";
  readonly len: number;
  /** `Infinity` for the seat that never holds. */
  readonly held: readonly number[];
  readonly drop: number;
  readonly release: number;
  readonly reset: number;
};
export type HeroCycle = CapturedCycle | ReleasedCycle;

export const HERO_CYCLES: readonly [CapturedCycle, ReleasedCycle] = [
  { kind: "captured", len: 11, held: [0.9, 1.8, 2.7, 3.6], capture: 4.7, reset: 9.6 },
  { kind: "released", len: 10, held: [0.9, 1.8, 2.7, Number.POSITIVE_INFINITY], drop: 3.8, release: 4.7, reset: 8.6 },
];
export const HERO_TOTAL = HERO_CYCLES[0].len + HERO_CYCLES[1].len;

export type HeroPosition = { readonly ci: 0 | 1; readonly cy: HeroCycle; readonly t: number };

/** Maps global time (any real, negative included) onto a cycle and its local time. */
export function heroAt(T: number): HeroPosition {
  const safe = Number.isFinite(T) ? T : 0;
  // Add the period only when negative: ((x % n) + n) % n loses precision (0.9 -> 0.8999…).
  let t = safe % HERO_TOTAL;
  if (t < 0) t += HERO_TOTAL;
  if (t >= HERO_CYCLES[0].len) {
    t -= HERO_CYCLES[0].len;
    return { ci: 1, cy: HERO_CYCLES[1], t };
  }
  return { ci: 0, cy: HERO_CYCLES[0], t };
}

/** When seat `f` is released in cycle B (its hold, if any, ends here). */
export function releaseAt(cy: ReleasedCycle, f: number): number {
  return f === DROP_SEAT ? cy.drop : cy.release + f * RELEASE_STAGGER;
}

export function seatState(cy: HeroCycle, t: number, f: number): SeatState {
  if (t >= cy.reset) return "VOTED";
  if (cy.kind === "captured") return t >= cy.capture ? "CAPTURED" : t >= (cy.held[f] ?? Infinity) ? "HELD" : "VOTED";
  if (f === DROP_SEAT) return t >= cy.drop ? "DECLINED" : "VOTED";
  return t >= releaseAt(cy, f) ? "RELEASED" : t >= (cy.held[f] ?? Infinity) ? "HELD" : "VOTED";
}

export function seatStates(cy: HeroCycle, t: number): SeatState[] {
  return Array.from({ length: SEAT_COUNT }, (_, f) => seatState(cy, t, f));
}

/** Whole dollars print bare ("$42"); anything else prints cents ("$42.50"). */
export function dollars(amount: number): string {
  return Number.isInteger(amount) ? `$${amount}` : `$${amount.toFixed(2)}`;
}

export type HeroCopy = {
  /** Price per person in dollars. */
  readonly price: number;
  /** Exactly SEAT_COUNT first names, in seat order. */
  readonly seats: readonly string[];
};

export function seatLabel(state: SeatState, price: number): string {
  switch (state) {
    case "VOTED":
      return "Voted";
    case "HELD":
      return `Held ${dollars(price)}`;
    case "CAPTURED":
      return `Paid ${dollars(price)}`;
    case "RELEASED":
      return "Released";
    case "DECLINED":
      return "Can’t make it";
  }
}

export type FlagMode = "open" | "booked";
export type TicketStatus = {
  /** Bold first line of the ticket status. */
  readonly big: string;
  readonly small: string;
  /** Mono flag in the ticket's top row. */
  readonly flag: string;
  readonly mode: FlagMode;
};

function holding(held: number): TicketStatus {
  return { big: `${held} of 4 held.`, small: "Nobody is charged until 4 of 4.", flag: `Admit 4 · ${held} held · nothing charged`, mode: "open" };
}

/** Ticket copy for a frame (design-system §4.3; strings from the prototype). */
export function ticketStatus(cy: HeroCycle, t: number, states: readonly SeatState[], copy: HeroCopy): TicketStatus {
  const held = states.filter((s) => s === "HELD").length;
  if (t >= cy.reset || states.every((s) => s === "VOTED")) {
    return { big: "4 of 4 voted.", small: "Holding cards next. Nobody is charged until 4 of 4.", flag: "Admit 4 · nothing charged yet", mode: "open" };
  }
  if (cy.kind === "captured") {
    if (states.every((s) => s === "CAPTURED")) {
      const total = dollars(copy.price * SEAT_COUNT);
      return {
        big: "Everyone’s in. Booked.",
        small: `${total} charged, ${dollars(copy.price)} each. Nobody fronted the bill.`,
        flag: `Booked · ${total} charged`,
        mode: "booked",
      };
    }
    return held < SEAT_COUNT ? holding(held) : { ...holding(held), big: "4 of 4 held.", small: "Booking now." };
  }
  if (states.some((s) => s === "RELEASED")) {
    return { big: "Every hold released.", small: "Nobody paid for a plan that didn’t happen.", flag: "Not booked · $0 charged", mode: "open" };
  }
  if (states[DROP_SEAT] === "DECLINED") {
    return { big: `${copy.seats[DROP_SEAT] ?? "One friend"} can’t make it.`, small: "Releasing every hold now.", flag: "Admit 4 · releasing", mode: "open" };
  }
  return holding(held);
}

export type HeroFrame = {
  readonly ci: 0 | 1;
  readonly kind: HeroCycle["kind"];
  readonly t: number;
  readonly states: readonly SeatState[];
  readonly status: TicketStatus;
  readonly torn: boolean;
  /**
   * Changes exactly when the discrete frame changes. The copy is a function of (cycle, states)
   * plus the price and names, so the key leaves the copy out and stays valid when it changes.
   */
  readonly key: string;
};

function frameKey(ci: 0 | 1, states: readonly SeatState[], torn: boolean): string {
  return `${ci}|${states.join(",")}|${torn ? 1 : 0}`;
}

export function heroFrame(T: number, copy: HeroCopy): HeroFrame {
  const { ci, cy, t } = heroAt(T);
  const states = seatStates(cy, t);
  const status = ticketStatus(cy, t, states, copy);
  const torn = cy.kind === "captured" && t >= cy.capture + TEAR_DELAY && t < cy.reset;
  return { ci, kind: cy.kind, t, states, status, torn, key: frameKey(ci, states, torn) };
}

/* ------------------------------------------------------------------ rings */

export type RingKind = "hold" | "capture" | "release";
/** A seat index, or "center" for the ticket's centre. */
export type RingOrigin = number | "center";
export type RingEvent = { readonly t0: number; readonly origin: RingOrigin; readonly kind: RingKind };

/** One ring per real event in the cycle (design-system §4.3 "Field" column, §5). */
export function ringEvents(cy: HeroCycle): RingEvent[] {
  const evs: RingEvent[] = [];
  cy.held.forEach((h, f) => {
    if (Number.isFinite(h)) evs.push({ t0: h, origin: f, kind: "hold" });
  });
  if (cy.kind === "captured") evs.push({ t0: cy.capture, origin: "center", kind: "capture" });
  else for (let f = 0; f < SEAT_COUNT; f++) evs.push({ t0: releaseAt(cy, f), origin: f, kind: "release" });
  return evs;
}

const RING = {
  hold: { life: 2.1, speed: 430, base: 10, alpha: 0.2, width: 2 },
  release: { life: 2.1, speed: 430, base: 10, alpha: 0.2, width: 2 },
  capture: { life: 1.5, speed: 780, base: 60, alpha: 0.3, width: 3 },
} as const;
/** Inner stroke of the double hold ring sits this far inside the outer one (CSS px). */
export const HOLD_RING_GAP = 16;
export const RELEASE_DASH: readonly [number, number] = [5, 9];

export type ActiveRing = {
  readonly origin: RingOrigin;
  readonly kind: RingKind;
  /** CSS px. */
  readonly radius: number;
  /** Ink alpha of the outer stroke, eased out quadratically over the ring's life. */
  readonly alpha: number;
  readonly lineWidth: number;
  /** Hold rings are a double stroke (the inner at half alpha) once there is room for it. */
  readonly double: boolean;
  readonly dashed: boolean;
};

export function ringsAt(cy: HeroCycle, t: number): ActiveRing[] {
  const out: ActiveRing[] = [];
  for (const ev of ringEvents(cy)) {
    const spec = RING[ev.kind];
    const age = t - ev.t0;
    if (age < 0 || age > spec.life) continue;
    const k = 1 - age / spec.life;
    const radius = spec.base + age * spec.speed;
    out.push({
      origin: ev.origin,
      kind: ev.kind,
      radius,
      alpha: spec.alpha * k * k,
      lineWidth: spec.width,
      double: ev.kind === "hold" && radius > HOLD_RING_GAP + 10,
      dashed: ev.kind === "release",
    });
  }
  return out;
}
