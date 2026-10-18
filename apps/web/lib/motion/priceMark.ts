/**
 * The price mark (design-system §4.2): the plan's per-person price drawn in digit glyphs.
 *
 * Pure core: coverage -> density classes, bevel, seat regions and radius, then a per-frame look
 * for every cell. The digits keep re-rolling but only inside their density class, so the
 * outline never wobbles and the number stays readable while no glyph ever means anything.
 * The one browser-only step (rasterizing the text into coverage) is `rasterizeCoverage`,
 * called from the GlyphField piece's `layout`, never at import time.
 */
import { hash2, hash3, type GlyphGrid, type GlyphPiece } from "./glyphField";
import { CALM_T, DROP_SEAT, RELEASE_STAGGER, heroAt, type HeroCycle } from "./heroScript";

/** Tones, palette index -> color. 0–4 dim (on ink), 4–7 sodium (held), 7–9 cream (lit), 10 ghost. */
export const MARK_FG: readonly string[] = [
  "#3A2A08", "#5A3E0A", "#7A560E", "#9C6D12", "#C98A16", "#E8A01C", "#FFB224", "#FFC65A", "#FFE2A0", "#FFF3D6", "#2E2616",
];
/** The ticket's ink. The canvas is opaque, so this must equal the ground it sits on. */
export const MARK_BG: readonly string[] = ["#100E0A"];
export const GHOST_TONE = 10;

/** Class 0 is the rim (partial coverage), then edge, body and core by distance to the outside. */
export type CellClass = 0 | 1 | 2 | 3;
export const CLASS_GLYPHS: readonly [string, string, string, string] = [".:", "274", "053", "896"];
export const TONES = { dim: [1, 2, 3, 3], held: [4, 5, 6, 6], lit: [7, 8, 9, 9] } as const;
const MAX_TONE = { dim: 4, held: 7, lit: 9 } as const;
/** The lit front's tone: one step brighter than the body for 0.1 s as the radial passes. */
const FRONT_TONE = 9;

/** Subsamples per cell: 2 across, 4 down (cells are twice as tall as wide). */
export const SUB_X = 2;
export const SUB_Y = 4;
const SOLID = 4; // of 8 subsamples
const ALPHA_ON = 110;

/** Seat wipe across its quarter (s), capture radial (s), lit front lead (s), ghost dissolve (s), reset fade (s). */
export const WIPE_S = 0.3;
export const LIGHT_S = 0.6;
export const FRONT_S = 0.1;
export const GHOST_S = 0.6;
export const RESET_S = 0.9;
/** Scramble clock (Hz); each dim cell re-rolls every 5–9 ticks. */
export const SCRAMBLE_HZ = 2;

/** 6px cells for a mark at least 200px tall (desktop), 4px below that (phones). */
export function markCellWidth(heightPx: number): number {
  return heightPx >= 200 ? 6 : 4;
}

/** Counts opaque subsamples per cell from RGBA pixels of a (cols*2) x (rows*4) raster. */
export function coverageFromAlpha(rgba: ArrayLike<number>, cols: number, rows: number, threshold = ALPHA_ON): Uint8Array {
  const sw = cols * SUB_X;
  const cov = new Uint8Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      let k = 0;
      for (let yy = 0; yy < SUB_Y; yy++) {
        const row = (r * SUB_Y + yy) * sw + c * SUB_X;
        for (let xx = 0; xx < SUB_X; xx++) if ((rgba[(row + xx) * 4 + 3] ?? 0) > threshold) k++;
      }
      cov[r * cols + c] = k;
    }
  }
  return cov;
}

export type MarkLayout = {
  readonly cols: number;
  readonly rows: number;
  /** Opaque subsamples, 0–8. 0 means outside the mark. */
  readonly cov: Uint8Array;
  readonly cls: Uint8Array;
  /** +1 lit from the top left, -1 in the bottom-right shadow. */
  readonly bevel: Int8Array;
  /** Seat that owns the cell: four vertical quarters of the mark's bounding box. */
  readonly region: Uint8Array;
  /** 0–1 across the bounding box (drives each quarter's left-to-right wipe). */
  readonly u: Float32Array;
  /** 0–1 distance from the mark's centre (drives the capture radial). */
  readonly rad: Float32Array;
};

/** Coverage -> classes, bevel, regions and radius (design-system §4.2 steps 2–3). */
export function buildMarkLayout(cov: Uint8Array, cols: number, rows: number): MarkLayout {
  const n = cols * rows;
  let minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!cov[r * cols + c]) continue;
      if (c < minx) minx = c;
      if (c > maxx) maxx = c;
      if (r < miny) miny = r;
      if (r > maxy) maxy = r;
    }
  }
  const solid = (c: number, r: number) => c >= 0 && r >= 0 && c < cols && r < rows && (cov[r * cols + c] ?? 0) >= SOLID;

  // Chamfer distance to the outside: x step 1, y step 2, because cells are twice as tall as wide.
  const INF = 1e6;
  const dist = new Float32Array(n);
  for (let i = 0; i < n; i++) dist[i] = (cov[i] ?? 0) >= SOLID ? INF : 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      if (!dist[i]) continue;
      let v = dist[i]!;
      if (c > 0) v = Math.min(v, dist[i - 1]! + 1);
      if (r > 0) v = Math.min(v, dist[i - cols]! + 2);
      dist[i] = v;
    }
  }
  for (let r = rows - 1; r >= 0; r--) {
    for (let c = cols - 1; c >= 0; c--) {
      const i = r * cols + c;
      if (!dist[i]) continue;
      let v = dist[i]!;
      if (c < cols - 1) v = Math.min(v, dist[i + 1]! + 1);
      if (r < rows - 1) v = Math.min(v, dist[i + cols]! + 2);
      dist[i] = v;
    }
  }

  const cls = new Uint8Array(n);
  const bevel = new Int8Array(n);
  const region = new Uint8Array(n);
  const u = new Float32Array(n);
  const rad = new Float32Array(n);
  if (minx === Infinity) return { cols, rows, cov, cls, bevel, region, u, rad };

  const bw = maxx - minx + 1;
  const cx = (minx + maxx + 1) / 2;
  const cy = miny + maxy + 1; // centre in half-cell units (rows are 2 units tall)
  let maxR = 1;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      const k = cov[i]!;
      if (!k) continue;
      if (k < SOLID) cls[i] = 0;
      else {
        const d = dist[i]!;
        cls[i] = d <= 2 ? 1 : d <= 4 ? 2 : 3;
        bevel[i] = !solid(c, r - 1) || !solid(c - 1, r) ? 1 : !solid(c, r + 1) || !solid(c + 1, r) ? -1 : 0;
      }
      u[i] = (c - minx) / bw;
      region[i] = Math.min(3, Math.floor(u[i]! * 4));
      rad[i] = Math.hypot(c + 0.5 - cx, r * 2 + 1 - cy);
      if (rad[i]! > maxR) maxR = rad[i]!;
    }
  }
  for (let i = 0; i < n; i++) rad[i] = rad[i]! / maxR;
  return { cols, rows, cov, cls, bevel, region, u, rad };
}

export type Look = "dim" | "held" | "front" | "lit" | "ghost";

/** Which look cell `i` has at cycle time `t` (design-system §4.2 step 4). */
export function cellLook(L: MarkLayout, i: number, h: number, cy: HeroCycle, t: number): Look {
  const f = L.region[i]!;
  let look: Look = "dim";
  if (t >= (cy.held[f] ?? Infinity) + (L.u[i]! * 4 - f) * WIPE_S) look = "held";
  if (cy.kind === "captured" && t >= cy.capture) {
    const litAt = cy.capture + L.rad[i]! * LIGHT_S;
    if (t >= litAt) look = "lit";
    else if (t >= litAt - FRONT_S) look = "front";
  } else if (cy.kind === "released") {
    const goneAt = f === DROP_SEAT ? cy.drop : cy.release + f * RELEASE_STAGGER;
    if (t >= goneAt + h * GHOST_S) look = "ghost";
  }
  if (t >= cy.reset + h * RESET_S) look = "dim";
  return look;
}

const DOT = 46; // "."
const COLON = 58; // ":"
const SPACE = 32;

/** The glyph and tone for one cell. `T` is global time (drives the scramble); `t` is cycle time. */
export function cellGlyph(L: MarkLayout, i: number, c: number, r: number, look: Look, T: number): { code: number; tone: number } {
  if (look === "ghost") return { code: DOT, tone: GHOST_TONE };
  const k = L.cls[i]! as CellClass;
  const h = hash2(c, r);
  let code: number;
  if (k === 0) code = L.cov[i]! <= 2 ? DOT : COLON;
  else {
    const set = CLASS_GLYPHS[k];
    let pick: number;
    if (look === "dim") {
      const every = 5 + Math.floor(h * 5);
      pick = hash3(c, r, Math.floor((Math.floor(T * SCRAMBLE_HZ) + h * 97) / every));
    } else pick = hash3(c, r, 3); // held and lit glyphs are frozen: a still shows the difference
    code = set.charCodeAt(Math.min(set.length - 1, Math.floor(pick * set.length)));
  }
  if (look === "front") return { code, tone: FRONT_TONE };
  const tone = TONES[look][k] + (k ? L.bevel[i]! : 0);
  return { code, tone: Math.max(0, Math.min(MAX_TONE[look], tone)) };
}

/** Writes one frame of the mark into the grid. Returns the cycle time actually shown. */
export function paintMark(L: MarkLayout, T: number, grid: Pick<GlyphGrid, "ch" | "fg" | "bg">, calm = false): number {
  const TT = calm ? CALM_T : T;
  const { cy, t } = heroAt(TT);
  const { ch, fg, bg } = grid;
  for (let r = 0; r < L.rows; r++) {
    for (let c = 0; c < L.cols; c++) {
      const i = r * L.cols + c;
      bg[i] = 0;
      if (!L.cov[i]) {
        ch[i] = SPACE;
        fg[i] = 0;
        continue;
      }
      const g = cellGlyph(L, i, c, r, cellLook(L, i, hash2(c, r), cy, t), T);
      ch[i] = g.code;
      fg[i] = g.tone;
    }
  }
  return TT;
}

/**
 * The cells that are wholly inside the canvas. The engine's grid rounds up so it always covers
 * the canvas, which leaves a partial last row and column whenever the size is not a multiple of
 * the cell (a 138px phone mark with 8px rows shows only 2px of its 18th row). The mark is drawn
 * inside these cells only, so no glyph is ever sliced by the canvas edge.
 */
export function visibleCells(grid: Pick<GlyphGrid, "cols" | "rows" | "cellW" | "width" | "height">): { cols: number; rows: number } {
  const EPS = 1e-6; // a 288px canvas with 6px cells is exactly 48 columns, not 47.999…
  return {
    cols: Math.max(0, Math.min(grid.cols, Math.floor(grid.width / grid.cellW + EPS))),
    rows: Math.max(0, Math.min(grid.rows, Math.floor(grid.height / (grid.cellW * 2) + EPS))),
  };
}

/** Copies a `cols` x `rows` coverage into the top-left of a larger `toCols` x `toRows` grid; the rest stays empty. */
export function padCoverage(cov: Uint8Array, cols: number, rows: number, toCols: number, toRows: number): Uint8Array {
  if (cols === toCols && rows === toRows) return cov;
  const out = new Uint8Array(toCols * toRows);
  const w = Math.min(cols, toCols);
  for (let r = 0; r < Math.min(rows, toRows); r++) out.set(cov.subarray(r * cols, r * cols + w), r * toCols);
  return out;
}

/* ------------------------------------------------------------------ browser-only */

/** Signage proportions: the price is condensed horizontally. */
const CONDENSE = 0.9;

/** Rasterizes `text` in the display face to fit the grid, then counts subsample coverage. */
export function rasterizeCoverage(text: string, cols: number, rows: number, family: string): Uint8Array {
  const sw = cols * SUB_X;
  const sh = rows * SUB_Y;
  if (!sw || !sh) return new Uint8Array(cols * rows); // getImageData throws on an empty rect
  const oc = document.createElement("canvas");
  oc.width = sw;
  oc.height = sh;
  const g = oc.getContext("2d", { willReadFrequently: true });
  if (!g) return new Uint8Array(cols * rows);
  const spacing = (px: number) => {
    if ("letterSpacing" in g) g.letterSpacing = `${px}px`;
  };
  g.font = `800 100px ${family}`;
  spacing(2);
  let m = g.measureText(text);
  const w100 = (m.actualBoundingBoxRight + m.actualBoundingBoxLeft) * CONDENSE;
  const h100 = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent;
  if (!(w100 > 0) || !(h100 > 0)) return new Uint8Array(cols * rows);
  const size = Math.min((sw * 0.98) / w100, (sh * 0.96) / h100) * 100;
  g.font = `800 ${size}px ${family}`;
  spacing(size * 0.02);
  m = g.measureText(text);
  const tw = (m.actualBoundingBoxRight + m.actualBoundingBoxLeft) * CONDENSE;
  const th = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent;
  g.setTransform(CONDENSE, 0, 0, 1, (sw - tw) / 2, 0);
  g.fillStyle = "#000";
  g.fillText(text, m.actualBoundingBoxLeft, (sh - th) / 2 + m.actualBoundingBoxAscent);
  return coverageFromAlpha(g.getImageData(0, 0, sw, sh).data, cols, rows);
}

export type PricePiece = GlyphPiece & {
  /** Freeze on the calm all-held frame (a focused number field, design-system §4.4). */
  calm: boolean;
  /** Called after every painted frame with the cycle-clock time shown (calm-adjusted). */
  onFrame: ((shownT: number) => void) | null;
};

/**
 * The GlyphField piece for the mark. `family` is a CSS font-family list for the display face
 * (read through getComputedStyle by the caller, because next/font hashes family names).
 */
export function createPricePiece(text: string, family: () => string): PricePiece {
  let layout: MarkLayout | null = null;
  const piece: PricePiece = {
    still: CALM_T,
    calm: false,
    onFrame: null,
    cellFor: (_w, h) => markCellWidth(h),
    layout: (grid) => {
      const fit = visibleCells(grid);
      const cov = padCoverage(rasterizeCoverage(text, fit.cols, fit.rows, family()), fit.cols, fit.rows, grid.cols, grid.rows);
      layout = buildMarkLayout(cov, grid.cols, grid.rows);
    },
    frame: (T, grid) => {
      if (!layout || layout.cols !== grid.cols || layout.rows !== grid.rows) return;
      const shown = paintMark(layout, T, grid, piece.calm);
      piece.onFrame?.(shown);
    },
  };
  return piece;
}
