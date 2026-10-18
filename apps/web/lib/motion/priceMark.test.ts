import { describe, expect, it } from "vitest";
import { hash2 } from "./glyphField";
import { CALM_T, HERO_CYCLES, HERO_TOTAL, heroAt } from "./heroScript";
import {
  CLASS_GLYPHS,
  GHOST_TONE,
  SUB_X,
  SUB_Y,
  buildMarkLayout,
  cellGlyph,
  cellLook,
  coverageFromAlpha,
  markCellWidth,
  padCoverage,
  paintMark,
  visibleCells,
  type MarkLayout,
} from "./priceMark";

const COLS = 48;
const ROWS = 20;

/**
 * A synthetic mark: a solid block with a one-cell rim of partial coverage, plus a hole so there
 * are inner edges. Built through `coverageFromAlpha` so the raster path is exercised too.
 */
function syntheticLayout(): MarkLayout {
  const sw = COLS * SUB_X;
  const sh = ROWS * SUB_Y;
  const rgba = new Uint8ClampedArray(sw * sh * 4);
  const on = (x: number, y: number) => {
    rgba[(y * sw + x) * 4 + 3] = 255;
  };
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      const c = Math.floor(x / SUB_X);
      const r = Math.floor(y / SUB_Y);
      const inBlock = c >= 4 && c < 44 && r >= 2 && r < 18;
      const inHole = c >= 20 && c < 26 && r >= 8 && r < 12;
      const rim = c === 3 && r >= 2 && r < 18; // left rim: half of each cell's subsamples
      if ((inBlock && !inHole) || (rim && x % SUB_X === 1)) on(x, y);
    }
  }
  const cov = coverageFromAlpha(rgba, COLS, ROWS);
  return buildMarkLayout(cov, COLS, ROWS);
}

const L = syntheticLayout();
const N = COLS * ROWS;
const covered = Array.from({ length: N }, (_, i) => i).filter((i) => L.cov[i]! > 0);
const grid = () => ({ ch: new Uint16Array(N), fg: new Uint8Array(N), bg: new Uint8Array(N) });
const looksAt = (cycleIndex: 0 | 1, t: number) =>
  covered.map((i) => cellLook(L, i, hash2(i % COLS, Math.floor(i / COLS)), HERO_CYCLES[cycleIndex], t));

describe("coverage and layout", () => {
  it("counts opaque subsamples per cell (0–8)", () => {
    expect(L.cov[5 * COLS + 10]).toBe(8);
    expect(L.cov[5 * COLS + 3]).toBe(4);
    expect(L.cov[0]).toBe(0);
    expect(L.cov[10 * COLS + 22]).toBe(0); // the hole
  });

  it("puts partial cells in the rim and deepens classes away from every outside edge", () => {
    expect(L.cls[5 * COLS + 3]).toBe(1); // 4 of 8 counts as solid, so its class comes from distance
    const edge = L.cls[2 * COLS + 10]; // top row of the block
    const core = L.cls[5 * COLS + 10]; // 3 rows (6 units) in, far from the sides
    expect(edge).toBe(1);
    expect(core).toBe(3);
    expect(L.cls[10 * COLS + 19]).toBe(1); // beside the hole: an inner edge
  });

  it("classes every partial cell as rim", () => {
    const partial = buildMarkLayout(Uint8Array.from([0, 2, 3, 8, 8, 8, 8, 1]), 8, 1);
    expect([partial.cls[1], partial.cls[2], partial.cls[7]]).toEqual([0, 0, 0]);
  });

  it("bevels the top-left light and the bottom-right shadow", () => {
    expect(L.bevel[2 * COLS + 10]).toBe(1); // top edge
    expect(L.bevel[10 * COLS + 3]).toBe(1); // left edge (the half-covered rim counts as solid)
    expect(L.bevel[17 * COLS + 10]).toBe(-1); // bottom edge
    expect(L.bevel[10 * COLS + 43]).toBe(-1); // right edge
    expect(L.bevel[5 * COLS + 10]).toBe(0);
  });

  it("splits the bounding box into four seat quarters, left to right", () => {
    const regionsByCol = (c: number) => L.region[5 * COLS + c];
    expect(regionsByCol(3)).toBe(0);
    expect(regionsByCol(14)).toBe(1);
    expect(regionsByCol(28)).toBe(2);
    expect(regionsByCol(43)).toBe(3);
    expect(Math.max(...covered.map((i) => L.rad[i]!))).toBeCloseTo(1);
  });

  it("returns an empty layout for an empty raster", () => {
    const empty = buildMarkLayout(new Uint8Array(12), 4, 3);
    expect(Array.from(empty.cls).every((v) => v === 0)).toBe(true);
  });

  it("uses 6 px cells for a desktop-sized mark and 4 px on phones", () => {
    expect(markCellWidth(240)).toBe(6);
    expect(markCellWidth(200)).toBe(6);
    expect(markCellWidth(138)).toBe(4);
  });
});

describe("glyphs stay in their density class (the outline never wobbles)", () => {
  it("across 100 scramble ticks and every look", () => {
    const tick = 1 / 2; // 2 Hz
    for (let k = 0; k < 100; k++) {
      const T = k * tick;
      const g = grid();
      paintMark(L, T, g);
      for (const i of covered) {
        const code = String.fromCharCode(g.ch[i]!);
        if (g.fg[i] === GHOST_TONE) {
          expect(code).toBe(".");
          continue;
        }
        const cls = L.cls[i]! as 0 | 1 | 2 | 3;
        if (cls === 0) expect(code).toBe(L.cov[i]! <= 2 ? "." : ":");
        else expect(CLASS_GLYPHS[cls]).toContain(code);
      }
    }
  });

  it("re-rolls sparsely while dim (roughly one cell in seven per tick)", () => {
    // Cycle A before the first hold is all dim: compare consecutive 2 Hz ticks in [0, 0.9).
    const a = grid();
    const b = grid();
    paintMark(L, 0, a);
    paintMark(L, 0.5, b);
    const solid = covered.filter((i) => L.cls[i]! > 0);
    const changed = solid.filter((i) => a.ch[i] !== b.ch[i]).length / solid.length;
    expect(changed).toBeGreaterThan(0.03);
    expect(changed).toBeLessThan(0.3);
  });

  it("keeps dim tones at or below 4 (secondary on ink)", () => {
    const g = grid();
    paintMark(L, 0.2, g);
    for (const i of covered) expect(g.fg[i]).toBeLessThanOrEqual(4);
  });
});

describe("calm frame", () => {
  it("is every cell held: sodium tones 4–7, glyphs frozen however long it sits", () => {
    expect(looksAt(heroAt(CALM_T).ci, heroAt(CALM_T).t).every((l) => l === "held")).toBe(true);
    const first = grid();
    const later = grid();
    paintMark(L, 3, first, true);
    paintMark(L, 3 + 37.3, later, true);
    expect(Array.from(later.ch)).toEqual(Array.from(first.ch));
    expect(Array.from(later.fg)).toEqual(Array.from(first.fg));
    for (const i of covered) {
      expect(first.fg[i]).toBeGreaterThanOrEqual(4);
      expect(first.fg[i]).toBeLessThanOrEqual(7);
    }
  });

  it("returns the calm time as the frame actually shown", () => {
    expect(paintMark(L, 13.7, grid(), true)).toBe(CALM_T);
    expect(paintMark(L, 13.7, grid(), false)).toBe(13.7);
  });
});

describe("holds wipe one quarter at a time", () => {
  it("lights only the first seat's quarter just after the first hold, left edge first", () => {
    const [A] = HERO_CYCLES;
    const t = A.held[0]! + 0.15; // halfway through a 0.3 s wipe
    const held = covered.filter((i) => cellLook(L, i, 0, A, t) === "held");
    expect(held.length).toBeGreaterThan(0);
    expect(held.every((i) => L.region[i] === 0 && L.u[i]! < 0.25)).toBe(true);
    expect(held.every((i) => L.u[i]! <= 0.125 + 1e-6)).toBe(true);
  });
});

describe("capture lights the mark cream", () => {
  it("is fully lit 0.6 s after capture, tones 7–9", () => {
    const g = grid();
    paintMark(L, HERO_CYCLES[0].capture + 0.65, g);
    for (const i of covered) {
      expect(g.fg[i]).toBeGreaterThanOrEqual(7);
      expect(g.fg[i]).toBeLessThanOrEqual(9);
    }
  });

  it("spreads radially from the centre", () => {
    const [A] = HERO_CYCLES;
    const looks = covered.map((i) => ({ rad: L.rad[i]!, look: cellLook(L, i, 0, A, A.capture + 0.3) }));
    const lit = looks.filter((x) => x.look === "lit");
    const notYet = looks.filter((x) => x.look === "held");
    expect(lit.length).toBeGreaterThan(0);
    expect(notYet.length).toBeGreaterThan(0);
    expect(Math.max(...lit.map((x) => x.rad))).toBeLessThan(Math.min(...notYet.map((x) => x.rad)));
  });

  it("never lights in cycle B: a released plan only goes ghost", () => {
    const [A, B] = HERO_CYCLES;
    for (let T = A.len; T < HERO_TOTAL; T += 0.05) {
      const t = T - A.len;
      const looks = looksAt(1, t);
      expect(looks).not.toContain("lit");
      expect(looks).not.toContain("front");
    }
    const g = grid();
    paintMark(L, A.len + B.release + 1.5, g);
    for (const i of covered) {
      expect(g.fg[i]).toBe(GHOST_TONE);
      expect(String.fromCharCode(g.ch[i]!)).toBe(".");
    }
  });

  it("fades back to dim after each reset", () => {
    const [A, B] = HERO_CYCLES;
    expect(looksAt(0, A.reset + 0.95).every((l) => l === "dim")).toBe(true);
    expect(looksAt(1, B.reset + 0.95).every((l) => l === "dim")).toBe(true);
  });
});

describe("cellGlyph", () => {
  it("is deterministic for a given time", () => {
    const i = covered[covered.length >> 1]!;
    const c = i % COLS;
    const r = Math.floor(i / COLS);
    expect(cellGlyph(L, i, c, r, "dim", 3.2)).toEqual(cellGlyph(L, i, c, r, "dim", 3.2));
  });
});

describe("visibleCells and padCoverage (no glyph is sliced by the canvas edge)", () => {
  /** The engine's grid: it rounds up so it always covers the canvas. */
  const engineGrid = (width: number, height: number, cellW: number) => ({
    cols: Math.ceil(width / cellW),
    rows: Math.ceil(height / (cellW * 2)),
    cellW,
    width,
    height,
  });

  it("keeps the mark inside whole cells for every phone and desktop height", () => {
    for (let height = 120; height <= 460; height++) {
      const cellW = markCellWidth(height);
      for (const width of [295, 300.5, Math.round(height * 1.62)]) {
        const grid = engineGrid(width, height, cellW);
        const fit = visibleCells(grid);
        expect(fit.rows * cellW * 2).toBeLessThanOrEqual(height);
        expect((fit.rows + 1) * cellW * 2).toBeGreaterThan(height);
        expect(fit.cols * cellW).toBeLessThanOrEqual(width);
        expect(fit.rows).toBeLessThanOrEqual(grid.rows);
        expect(fit.cols).toBeLessThanOrEqual(grid.cols);
      }
    }
  });

  it("leaves the partial last row and column empty for heights 120–160", () => {
    for (let height = 120; height <= 160; height++) {
      const grid = engineGrid(295, height, 4);
      const fit = visibleCells(grid);
      const full = new Uint8Array(fit.cols * fit.rows).fill(8); // worst case: the text touches every edge
      const cov = padCoverage(full, fit.cols, fit.rows, grid.cols, grid.rows);
      expect(cov.length).toBe(grid.cols * grid.rows);
      const partialRow = height % 8 !== 0;
      const lastRow = cov.subarray((grid.rows - 1) * grid.cols);
      expect(lastRow.every((k) => k === 0)).toBe(partialRow);
      if (grid.cols > fit.cols) for (let r = 0; r < grid.rows; r++) expect(cov[r * grid.cols + grid.cols - 1]).toBe(0);
    }
  });

  it("counts an exact fit as whole cells despite float error", () => {
    expect(visibleCells(engineGrid(288, 144, 6))).toEqual({ cols: 48, rows: 12 });
    expect(visibleCells(engineGrid(0.1 * 3 * 40, 24, 4))).toEqual({ cols: 3, rows: 3 });
  });

  it("copies coverage to the top left, row by row", () => {
    const cov = Uint8Array.from([1, 2, 3, 4, 5, 6]); // 3 x 2
    expect(Array.from(padCoverage(cov, 3, 2, 4, 3))).toEqual([1, 2, 3, 0, 4, 5, 6, 0, 0, 0, 0, 0]);
    expect(padCoverage(cov, 3, 2, 3, 2)).toBe(cov);
  });
});
