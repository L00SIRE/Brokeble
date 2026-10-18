/**
 * GlyphField: an in-house character-grid canvas engine (design-system §4.1).
 *
 * A grid of W x 2W cells. Each (char, tone) pair is drawn once into a sprite sheet and blitted;
 * only cells that changed since the last frame are repainted. The frame rate is capped and the
 * time step clamped to 100 ms. It runs only while it is visible, the tab is shown, motion is not
 * reduced, it is not paused and not frozen. Otherwise it paints one still frame and sleeps,
 * which costs nothing.
 *
 * Hardening over the prototype: device-pixel-ratio changes (matchMedia), late font loads
 * (`document.fonts`), and a `destroy()` that releases every observer and listener so React
 * effects can mount and unmount it freely. Resize triggers (the observer, DPR, fonts) are
 * coalesced into one animation frame and skipped when nothing that shapes the layout changed,
 * so a cold load lays out once or twice, not once per trigger. A piece that reports `idle()`
 * stops the loop until `repaint()` wakes it. Safe to import on the server: nothing touches the
 * DOM until `new GlyphField(...)`.
 */

/** Integer hash of a cell, uniform in [0, 1). Deterministic: the same cell always gets the same value. */
export function hash2(x: number, y: number): number {
  let a = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263)) | 0;
  a = Math.imul(a ^ (a >>> 13), 1274126177);
  return ((a ^ (a >>> 16)) >>> 0) / 4294967296;
}

export function hash3(x: number, y: number, z: number): number {
  return hash2(x * 31 + Math.imul(z | 0, 1013), y * 17 - Math.imul(z | 0, 7919));
}

export type GlyphGrid = {
  readonly cols: number;
  readonly rows: number;
  /** Char code per cell; 0 or 32 paints background only. */
  readonly ch: Uint16Array;
  /** Index into the foreground palette. */
  readonly fg: Uint8Array;
  /** Index into the background palette. */
  readonly bg: Uint8Array;
  /** Cell width in CSS px; cells are twice as tall. */
  readonly cellW: number;
  /** Canvas size in CSS px. */
  readonly width: number;
  readonly height: number;
};

export interface GlyphPiece {
  /** Time to show when motion is reduced (the piece's calm frame). */
  readonly still?: number;
  /** Cell width for a canvas of this CSS size. */
  cellFor?(width: number, height: number): number;
  /** Called after every resize with a fresh, empty grid. */
  layout?(grid: GlyphGrid): void;
  /** Fill `grid` for time `t` (seconds). Must be a pure function of `t` and layout. */
  frame(t: number, grid: GlyphGrid): void;
  /**
   * True when the next frames would look the same (nothing is moving). The loop then sleeps and
   * the clock stops until `repaint()` is called. Pieces that always move leave it out.
   */
  idle?(): boolean;
}

export type GlyphFieldOptions = {
  /** Foreground palette (CSS colors) indexed by `grid.fg`. */
  readonly fg: readonly string[];
  /** Background palette indexed by `grid.bg`. */
  readonly bg: readonly string[];
  readonly cellW?: number;
  readonly fps?: number;
  /** CSS font-family list for glyphs (resolve next/font's hashed names with getComputedStyle). */
  readonly font?: string;
  readonly weight?: number;
  /** Canvas `fontStretch` where supported (Martian Mono has a `wdth` axis). */
  readonly stretch?: "normal" | "condensed" | "semi-condensed";
  /** Backing-store DPR cap: 2 keeps phones sharp without 3x fill cost. */
  readonly maxDpr?: number;
  /** IntersectionObserver margin: start a little before the canvas scrolls in. */
  readonly rootMargin?: string;
};

const SHEET_COLS = 32;
const MAX_STEP_MS = 100;
const REDUCED = "(prefers-reduced-motion: reduce)";

export class GlyphField {
  private readonly canvas: HTMLCanvasElement;
  private readonly piece: GlyphPiece;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly fps: number;
  private readonly weight: number;
  private readonly stretch: GlyphFieldOptions["stretch"];
  private readonly maxDpr: number;
  private fgPal: readonly string[];
  private bgPal: readonly string[];
  private font: string;
  private cellW: number;

  private t = 0;
  private last = 0;
  private raf = 0;
  private visible = true;
  private paused = false;
  private frozenAt: number | null = null;
  private destroyed = false;
  private resizeRaf = 0;
  /** What the current layout was built for; a resize that would rebuild the same one is skipped. */
  private layoutKey = "";
  /** Bumped when a webfont finishes loading: same size, but glyph metrics and the piece's mask may differ. */
  private fontEpoch = 0;

  private dpr = 1;
  private grid: GlyphGrid | null = null;
  private prevCh = new Uint16Array(0);
  private prevFg = new Uint8Array(0);
  private prevBg = new Uint8Array(0);
  private fontPx = 0;
  private gw = 0;
  private gh = 0;
  private readonly sheet: HTMLCanvasElement;
  private sctx: CanvasRenderingContext2D | null = null;
  private readonly sprites = new Map<number, { sx: number; sy: number }>();

  private readonly reduced: MediaQueryList;
  private dprQuery: MediaQueryList | null = null;
  private readonly resizeObs: ResizeObserver;
  private readonly interObs: IntersectionObserver;

  constructor(canvas: HTMLCanvasElement, piece: GlyphPiece, opts: GlyphFieldOptions) {
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("GlyphField: 2D canvas unavailable");
    this.canvas = canvas;
    this.piece = piece;
    this.ctx = ctx;
    this.fgPal = opts.fg;
    this.bgPal = opts.bg;
    this.cellW = opts.cellW ?? 8;
    this.fps = opts.fps ?? 20;
    this.font = opts.font ?? '"Martian Mono", ui-monospace, monospace';
    this.weight = opts.weight ?? 700;
    this.stretch = opts.stretch ?? "condensed";
    this.maxDpr = opts.maxDpr ?? 2;
    this.sheet = document.createElement("canvas");

    this.reduced = matchMedia(REDUCED);
    this.reduced.addEventListener("change", this.kick);
    document.addEventListener("visibilitychange", this.kick);
    document.fonts?.addEventListener("loadingdone", this.onFontsLoaded);
    void document.fonts?.ready.then(this.resize);
    this.watchDpr();

    this.resizeObs = new ResizeObserver(this.resize);
    this.resizeObs.observe(canvas);
    this.interObs = new IntersectionObserver(
      (entries) => {
        const e = entries[entries.length - 1];
        if (!e) return;
        this.visible = e.isIntersecting;
        this.kick();
      },
      { rootMargin: opts.rootMargin ?? "120px" },
    );
    this.interObs.observe(canvas);
    this.relayout(); // synchronous: the first frame is on screen before the constructor returns
  }

  /** True while the clock advances. */
  get running(): boolean {
    return !this.destroyed && this.visible && !document.hidden && !this.reduced.matches && !this.paused && this.frozenAt === null;
  }

  get reducedMotion(): boolean {
    return this.reduced.matches;
  }

  /** Stop or resume the clock (the Pause motion control, WCAG 2.2.2). */
  setPaused(paused: boolean): void {
    if (this.paused === paused) return;
    this.paused = paused;
    this.kick();
  }

  /** Pin the clock at `t` (review links like `?t=2.4`), or release it with null. */
  freeze(t: number | null): void {
    this.frozenAt = t !== null && Number.isFinite(t) ? t : null;
    this.paint(true);
    this.kick();
  }

  /** Swap palettes without a re-layout (the console's ink/paper switch). */
  setPalette(fg: readonly string[], bg: readonly string[]): void {
    this.fgPal = fg;
    this.bgPal = bg;
    this.clearSprites();
    this.paint(true);
  }

  setFont(font: string): void {
    if (font === this.font) return;
    this.font = font;
    this.resize();
  }

  /** Repaint now without advancing the clock (after the piece's own state changed). */
  repaint(): void {
    this.paint(false);
    this.kick();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    if (this.resizeRaf) cancelAnimationFrame(this.resizeRaf);
    this.resizeRaf = 0;
    this.resizeObs.disconnect();
    this.interObs.disconnect();
    this.reduced.removeEventListener("change", this.kick);
    this.dprQuery?.removeEventListener("change", this.onDpr);
    document.removeEventListener("visibilitychange", this.kick);
    document.fonts?.removeEventListener("loadingdone", this.onFontsLoaded);
    this.sprites.clear();
    this.grid = null;
  }

  /* ---------------------------------------------------------------- internals */

  private readonly onFontsLoaded = (e: Event): void => {
    // next/font's metric fallbacks ("Funnel Display Fallback", local() faces) finish loading after
    // the real faces and never change what is drawn, so they must not cost a second relayout.
    const faces = (e as FontFaceSetLoadEvent).fontfaces ?? [];
    if (faces.length > 0 && faces.every((f) => f.family.replace(/["']/g, "").endsWith(" Fallback"))) return;
    this.fontEpoch++;
    this.resize();
  };

  private readonly onDpr = (): void => {
    this.watchDpr();
    this.resize();
  };

  /** A resolution query matches only the current DPR, so it fires once when the DPR changes. */
  private watchDpr(): void {
    if (this.destroyed) return;
    this.dprQuery?.removeEventListener("change", this.onDpr);
    this.dprQuery = matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    this.dprQuery.addEventListener("change", this.onDpr);
  }

  private applyFont(g: CanvasRenderingContext2D, px: number): void {
    g.font = `${this.weight} ${px}px ${this.font}`;
    if (this.stretch && "fontStretch" in g) g.fontStretch = this.stretch;
  }

  private clearSprites(): void {
    this.sprites.clear();
    this.sctx?.clearRect(0, 0, this.sheet.width, this.sheet.height);
  }

  /** Every resize trigger lands here; the work runs once, on the next animation frame. */
  private readonly resize = (): void => {
    if (this.destroyed || this.resizeRaf) return;
    this.resizeRaf = requestAnimationFrame(() => {
      this.resizeRaf = 0;
      this.relayout();
    });
  };

  private relayout(): void {
    if (this.destroyed) return;
    const rect = this.canvas.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;
    if (!width || !height) return;
    const dpr = Math.min(window.devicePixelRatio || 1, this.maxDpr);
    const cellW = this.piece.cellFor ? this.piece.cellFor(width, height) : this.cellW;
    const key = `${width}x${height}@${dpr}/${cellW}/${this.font}/${this.fontEpoch}`;
    if (key === this.layoutKey) return;
    this.layoutKey = key;
    this.cellW = cellW;
    this.dpr = dpr;
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    const cols = Math.ceil(width / cellW);
    const rows = Math.ceil(height / (cellW * 2));
    const n = cols * rows;
    this.grid = { cols, rows, ch: new Uint16Array(n), fg: new Uint8Array(n), bg: new Uint8Array(n), cellW, width, height };
    this.prevCh = new Uint16Array(n).fill(0xffff);
    this.prevFg = new Uint8Array(n);
    this.prevBg = new Uint8Array(n).fill(0xff);

    // One glyph advance equals one cell: size the font from the measured advance of "0".
    this.applyFont(this.ctx, 100);
    const adv = this.ctx.measureText("0").width / 100 || 0.62;
    this.fontPx = Math.min((cellW / adv) * 1.04, cellW * 1.75) * dpr;
    this.gw = Math.ceil(cellW * dpr) + 2;
    this.gh = Math.ceil(cellW * 2 * dpr) + 2;
    this.sheet.width = this.gw * SHEET_COLS;
    this.sheet.height = this.gh * 8;
    this.sctx = this.sheet.getContext("2d");
    this.sprites.clear();

    this.piece.layout?.(this.grid);
    this.paint(true);
    this.kick();
  }

  private sprite(code: number, tone: number): { sx: number; sy: number } | null {
    const key = code * 256 + tone;
    const hit = this.sprites.get(key);
    if (hit) return hit;
    if (!this.sctx) return null;
    const i = this.sprites.size;
    const sx = (i % SHEET_COLS) * this.gw;
    const sy = Math.floor(i / SHEET_COLS) * this.gh;
    if (sy + this.gh > this.sheet.height) {
      const old = document.createElement("canvas");
      old.width = this.sheet.width;
      old.height = this.sheet.height;
      old.getContext("2d")?.drawImage(this.sheet, 0, 0);
      this.sheet.height *= 2; // resizing clears the sheet; copy the old sprites back
      this.sctx = this.sheet.getContext("2d");
      this.sctx?.drawImage(old, 0, 0);
    }
    const g = this.sctx;
    if (!g) return null;
    this.applyFont(g, this.fontPx);
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillStyle = this.fgPal[tone] ?? this.fgPal[0] ?? "#fff";
    g.fillText(String.fromCharCode(code), sx + this.gw / 2, sy + this.gh / 2 + this.fontPx * 0.04);
    const s = { sx, sy };
    this.sprites.set(key, s);
    return s;
  }

  private paint(force: boolean): void {
    const grid = this.grid;
    if (!grid || this.destroyed) return;
    const { cols, rows, ch, fg, bg, cellW } = grid;
    const c = this.ctx;
    const d = this.dpr;
    this.piece.frame(this.frozenAt ?? this.t, grid);
    for (let r = 0; r < rows; r++) {
      const y0 = Math.round(r * cellW * 2 * d);
      const y1 = Math.round((r + 1) * cellW * 2 * d);
      for (let col = 0; col < cols; col++) {
        const i = r * cols + col;
        const code = ch[i]!;
        const tone = fg[i]!;
        const ground = bg[i]!;
        if (!force && code === this.prevCh[i] && tone === this.prevFg[i] && ground === this.prevBg[i]) continue;
        this.prevCh[i] = code;
        this.prevFg[i] = tone;
        this.prevBg[i] = ground;
        const x0 = Math.round(col * cellW * d);
        const x1 = Math.round((col + 1) * cellW * d);
        c.fillStyle = this.bgPal[ground] ?? this.bgPal[0] ?? "#000";
        c.fillRect(x0, y0, x1 - x0, y1 - y0);
        if (code === 32 || code === 0) continue;
        const s = this.sprite(code, tone);
        if (s) c.drawImage(this.sheet, s.sx, s.sy, this.gw, this.gh, Math.round((x0 + x1 - this.gw) / 2), Math.round((y0 + y1 - this.gh) / 2), this.gw, this.gh);
      }
    }
  }

  private readonly kick = (): void => {
    if (this.destroyed) return;
    if (this.running) {
      if (!this.raf) {
        this.last = performance.now();
        this.raf = requestAnimationFrame(this.loop);
      }
      return;
    }
    if (this.raf) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    }
    // Reduced motion shows the piece's calm frame, never a random mid-scramble one.
    if (this.reduced.matches && this.piece.still !== undefined && this.frozenAt === null) this.t = this.piece.still;
    this.paint(false);
  };

  private readonly loop = (now: number): void => {
    this.raf = 0;
    if (!this.running) return;
    const dt = now - this.last;
    if (dt >= 1000 / this.fps - 2) {
      this.t += Math.min(dt, MAX_STEP_MS) / 1000;
      this.last = now;
      this.paint(false);
    }
    if (this.piece.idle?.()) return; // nothing moves: sleep until repaint() kicks the loop again
    this.raf = requestAnimationFrame(this.loop);
  };
}
