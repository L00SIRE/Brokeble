import { describe, expect, it } from "vitest";
import {
  CALM_T,
  DROP_SEAT,
  HERO_CYCLES,
  HERO_TOTAL,
  dollars,
  heroAt,
  heroFrame,
  ringEvents,
  ringsAt,
  seatLabel,
  seatStates,
  type HeroCopy,
} from "./heroScript";

const COPY: HeroCopy = { price: 42, seats: ["Maya", "Leo", "Sam", "Priya"] };
const [A, B] = HERO_CYCLES;
/** Every 10 ms across [from, to). */
const sweep = (from: number, to: number) => Array.from({ length: Math.round((to - from) * 100) }, (_, k) => from + k / 100);

describe("heroAt", () => {
  it("is a 21 s loop of an 11 s captured cycle then a 10 s released cycle", () => {
    expect(HERO_TOTAL).toBe(21);
    expect(heroAt(0)).toMatchObject({ ci: 0, t: 0 });
    expect(heroAt(10.99)).toMatchObject({ ci: 0 });
    expect(heroAt(11)).toMatchObject({ ci: 1, t: 0 });
    expect(heroAt(21)).toMatchObject({ ci: 0, t: 0 });
    expect(heroAt(42 + 3)).toMatchObject({ ci: 0, t: 3 });
  });

  it("wraps negative and non-finite times instead of throwing", () => {
    expect(heroAt(-1).ci).toBe(1);
    expect(heroAt(-1).t).toBeCloseTo(9);
    expect(heroAt(Number.NaN)).toMatchObject({ ci: 0, t: 0 });
  });
});

describe("the story fits a five-second glance", () => {
  it("lands the first hold at 0.9 s and captures at 4.7 s", () => {
    expect(heroFrame(0.89, COPY).states[0]).toBe("VOTED");
    expect(heroFrame(0.9, COPY).states[0]).toBe("HELD");
    expect(heroFrame(4.69, COPY).states).toEqual(["HELD", "HELD", "HELD", "HELD"]);
    expect(heroFrame(4.7, COPY).states).toEqual(["CAPTURED", "CAPTURED", "CAPTURED", "CAPTURED"]);
  });

  it("starts each cycle on an already assembled, voted frame", () => {
    for (const T of [0, 11]) {
      const f = heroFrame(T, COPY);
      expect(f.states.every((s) => s === "VOTED")).toBe(true);
      expect(f.status.big).toBe("4 of 4 voted.");
      expect(f.torn).toBe(false);
    }
  });
});

describe("calm frame", () => {
  it("is all four held, nothing charged, stub intact", () => {
    const f = heroFrame(CALM_T, COPY);
    expect(f.states).toEqual(["HELD", "HELD", "HELD", "HELD"]);
    expect(f.status).toEqual({ big: "4 of 4 held.", small: "Booking now.", flag: "Admit 4 · 4 held · nothing charged", mode: "open" });
    expect(f.torn).toBe(false);
  });
});

describe("cycle A (captured)", () => {
  it("counts holds in the status and the flag", () => {
    const f = heroFrame(2.4, COPY);
    expect(f.states).toEqual(["HELD", "HELD", "VOTED", "VOTED"]);
    expect(f.status.big).toBe("2 of 4 held.");
    expect(f.status.small).toBe("Nobody is charged until 4 of 4.");
    expect(f.status.flag).toBe("Admit 4 · 2 held · nothing charged");
  });

  it("books with the total derived from the price, never hard-coded", () => {
    expect(heroFrame(6.4, COPY).status).toEqual({
      big: "Everyone’s in. Booked.",
      small: "$168 charged, $42 each. Nobody fronted the bill.",
      flag: "Booked · $168 charged",
      mode: "booked",
    });
    expect(heroFrame(6.4, { ...COPY, price: 37.5 }).status.flag).toBe("Booked · $150 charged");
    expect(heroFrame(6.4, { ...COPY, price: 37.25 }).status.small).toBe("$149 charged, $37.25 each. Nobody fronted the bill.");
  });

  it("tears the stub 0.35 s after capture and mends it at the reset", () => {
    expect(heroFrame(5.04, COPY).torn).toBe(false);
    expect(heroFrame(5.05, COPY).torn).toBe(true);
    expect(heroFrame(9.59, COPY).torn).toBe(true);
    expect(heroFrame(9.6, COPY).torn).toBe(false);
    expect(heroFrame(9.6, COPY).states.every((s) => s === "VOTED")).toBe(true);
  });

  it("never shows a release or a decline", () => {
    for (const T of sweep(0, A.len)) {
      const { states } = heroFrame(T, COPY);
      expect(states.some((s) => s === "RELEASED" || s === "DECLINED")).toBe(false);
    }
  });
});

describe("cycle B (released)", () => {
  it("never shows CAPTURED, a booked flag or a torn stub", () => {
    for (const T of sweep(A.len, HERO_TOTAL)) {
      const f = heroFrame(T, COPY);
      expect(f.kind).toBe("released");
      expect(f.states).not.toContain("CAPTURED");
      expect(f.status.mode).toBe("open");
      expect(f.torn).toBe(false);
    }
  });

  it("names the friend who drops, then releases every other hold in order", () => {
    const at = (t: number) => heroFrame(A.len + t + 1e-9, COPY); // epsilon: 11 + 4.7 - 11 is 4.6999… in floats
    expect(at(3.79).states).toEqual(["HELD", "HELD", "HELD", "VOTED"]);
    expect(at(3.8).states[DROP_SEAT]).toBe("DECLINED");
    expect(at(3.8).status.big).toBe("Priya can’t make it.");
    expect(at(4.7).states).toEqual(["RELEASED", "HELD", "HELD", "DECLINED"]);
    expect(at(4.7 + 0.14).states).toEqual(["RELEASED", "RELEASED", "HELD", "DECLINED"]);
    expect(at(5).states).toEqual(["RELEASED", "RELEASED", "RELEASED", "DECLINED"]);
    expect(at(5).status).toEqual({ big: "Every hold released.", small: "Nobody paid for a plan that didn’t happen.", flag: "Not booked · $0 charged", mode: "open" });
    expect(at(B.reset).states.every((s) => s === "VOTED")).toBe(true);
  });
});

describe("render key", () => {
  it("changes only when what the ticket shows changes (a handful of times per loop)", () => {
    const keys = new Set(sweep(0, HERO_TOTAL).map((T) => heroFrame(T, COPY).key));
    expect(keys.size).toBeGreaterThan(10);
    expect(keys.size).toBeLessThan(25);
  });

  it("never depends on the copy, so callers can detect changes with any copy", () => {
    const other: HeroCopy = { price: 18.5, seats: ["Ana", "Bo", "Cy", "Di"] };
    for (const T of sweep(0, HERO_TOTAL)) expect(heroFrame(T, other).key).toBe(heroFrame(T, COPY).key);
  });
});

describe("copy helpers", () => {
  it("prints whole dollars bare and anything else with cents", () => {
    expect(dollars(42)).toBe("$42");
    expect(dollars(42.5)).toBe("$42.50");
  });

  it("labels each seat state", () => {
    expect(["VOTED", "HELD", "CAPTURED", "RELEASED", "DECLINED"].map((s) => seatLabel(s as never, 42))).toEqual([
      "Voted",
      "Held $42",
      "Paid $42",
      "Released",
      "Can’t make it",
    ]);
  });

  it("keeps seat order stable", () => {
    expect(seatStates(A, 1.85)).toEqual(["HELD", "HELD", "VOTED", "VOTED"]);
  });
});

describe("rings", () => {
  it("emits one ring per real event", () => {
    expect(ringEvents(A).map((e) => [e.kind, e.origin])).toEqual([
      ["hold", 0],
      ["hold", 1],
      ["hold", 2],
      ["hold", 3],
      ["capture", "center"],
    ]);
    const evB = ringEvents(B);
    expect(evB.filter((e) => e.kind === "hold")).toHaveLength(3);
    expect(evB.filter((e) => e.kind === "release").map((e) => e.origin)).toEqual([0, 1, 2, 3]);
    expect(evB.find((e) => e.kind === "release" && e.origin === DROP_SEAT)?.t0).toBe(B.drop);
  });

  it("grows at 430 px/s and fades out over 2.1 s for a hold", () => {
    const [born] = ringsAt(A, 0.9);
    expect(born).toMatchObject({ origin: 0, kind: "hold", radius: 10, dashed: false, double: false });
    expect(born?.alpha).toBeCloseTo(0.2);
    const [grown] = ringsAt(A, 1.4);
    expect(grown?.radius).toBeCloseTo(10 + 0.5 * 430);
    expect(grown?.double).toBe(true);
    expect(grown!.alpha).toBeLessThan(born!.alpha);
    expect(ringsAt(A, 0.9 + 2.11).some((r) => r.origin === 0)).toBe(false);
  });

  it("sends one fast capture ring from the ticket centre, then goes quiet", () => {
    const cap = ringsAt(A, 5.2).find((r) => r.kind === "capture");
    expect(cap).toMatchObject({ origin: "center", lineWidth: 3 });
    expect(cap?.radius).toBeCloseTo(60 + 0.5 * 780);
    expect(ringsAt(A, 7)).toEqual([]);
  });

  it("draws release rings dashed", () => {
    const rel = ringsAt(B, 4.9).filter((r) => r.kind === "release");
    expect(rel.length).toBeGreaterThan(0);
    expect(rel.every((r) => r.dashed && !r.double)).toBe(true);
  });
});
