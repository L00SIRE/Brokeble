"use client";

// Console background (design-system §5): a sparse dot lattice kept out of every text box, and one ring per REAL lane
// transition: amber on HELD, one solid go band across the console on the first CAPTURED, a grey ring per RELEASED or
// DECLINED. Lane rings start at the lane's feed, in the gutter by the gate: from the lamp, inside the text mask, most of
// the ring was never drawn. No ambient loop. Transitions are rung only while the stream is live and the lane's
// previous stage is known, so the opening snapshot (history) never rings. Reduced motion or Pause: no rings at all.
// Runs on D2's GlyphField (lib/motion/glyphField.ts), which pauses off-screen, in hidden tabs and under reduced motion.
import { use, useEffect, useRef, type RefObject } from "react";
import type { LaneView } from "@/lib/consoleReducer";
import { lookFor, type Look } from "@/lib/consoleView";
import { GlyphField, hash2, type GlyphGrid, type GlyphPiece } from "@/lib/motion/glyphField";
import { ConsoleMotion, type ConsoleTheme } from "./Panel";

type RingKind = "held" | "capture" | "release";
type Ring = { x: number; y: number; t0: number; kind: RingKind; speed: number; life: number; band: number };

/** Palette index: 0 lattice dot, 1/2 held ring (faint/strong), 3/4 capture band, 5/6 release ring. */
const PALETTE: Record<ConsoleTheme, { fg: string[]; bg: string[] }> = {
  ink: { fg: ["#221F19", "#5A4210", "#FFB224", "#1F5C3D", "#3BE38B", "#3A372F", "#8C8576"], bg: ["#100E0A"] },
  paper: { fg: ["#E2D9C4", "#E8B860", "#B07209", "#9FD9B8", "#0B6B3F", "#D3C9B3", "#8F877A"], bg: ["#F6F1E6"] },
};

const RING: Record<RingKind, Pick<Ring, "speed" | "life" | "band">> = {
  held: { speed: 26, life: 3.2, band: 3.2 },
  capture: { speed: 130, life: 1.2, band: 3.2 },
  release: { speed: 26, life: 3.2, band: 3.2 },
};

const MIDDLE_DOT = 183;

/** The field piece: pure per frame given (t, rings, mask). `now` is the engine clock, the start time of a new ring. */
class FieldPiece implements GlyphPiece {
  readonly still = 0;
  rings: Ring[] = [];
  mask: Uint8Array | null = null;
  grid: GlyphGrid | null = null;
  now = 0;

  /** With no rings the field is static, so the engine stops its loop; pushing a ring is followed by repaint(). */
  idle(): boolean {
    return this.rings.length === 0;
  }

  layout(grid: GlyphGrid): void {
    this.grid = grid;
    this.mask = null;
  }

  frame(t: number, grid: GlyphGrid): void {
    this.now = t;
    const { cols, rows, ch, fg, bg } = grid;
    this.rings = this.rings.filter((r) => t >= r.t0 && t - r.t0 < r.life);
    const mask = this.mask?.length === cols * rows ? this.mask : null;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        bg[i] = 0;
        ch[i] = 32;
        fg[i] = 0;
        if (c % 2 || r % 2 || mask?.[i]) continue;
        const x = c + 0.5;
        const y = r * 2 + 1;
        let intensity = 0;
        let kind: RingKind | null = null;
        for (const g of this.rings) {
          const age = t - g.t0;
          const u = Math.hypot(x - g.x, y - g.y) - age * g.speed;
          const v = Math.max(0, 1 - Math.abs(u) / g.band) * (g.kind === "capture" ? 1 : Math.max(0, 1 - age / g.life));
          if (v > intensity) {
            intensity = v;
            kind = g.kind;
          }
        }
        const [faint, strong] = kind === "held" ? [1, 2] : kind === "capture" ? [3, 4] : [5, 6];
        if (intensity > 0.45) {
          ch[i] = MIDDLE_DOT;
          fg[i] = strong;
        } else if (intensity > 0.12) {
          ch[i] = MIDDLE_DOT;
          fg[i] = faint;
        } else if (c % 4 === 0 && hash2(c, r) < 0.8) {
          ch[i] = MIDDLE_DOT;
          fg[i] = 0;
        }
      }
    }
  }
}

/** Cells under any text line or state element, so background dots never sit under copy (§5). */
function avoidMask(grid: GlyphGrid, root: HTMLElement, canvas: HTMLCanvasElement): Uint8Array {
  const m = new Uint8Array(grid.cols * grid.rows);
  const origin = canvas.getBoundingClientRect();
  const cw = grid.cellW;
  const mark = (r: DOMRect) => {
    const c0 = Math.floor((r.left - origin.left) / cw);
    const c1 = Math.ceil((r.right - origin.left) / cw);
    const r0 = Math.floor((r.top - origin.top) / (cw * 2));
    const r1 = Math.ceil((r.bottom - origin.top) / (cw * 2));
    for (let y = Math.max(0, r0); y < Math.min(grid.rows, r1); y++) for (let x = Math.max(0, c0); x < Math.min(grid.cols, c1); x++) m[y * grid.cols + x] = 1;
  };
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!n.textContent?.trim()) continue;
    range.selectNodeContents(n);
    for (const r of range.getClientRects()) mark(r);
  }
  root.querySelectorAll("[data-avoid], svg, button, a").forEach((el) => mark(el.getBoundingClientRect()));
  return m;
}

/**
 * The background field. `content` is the area to keep clear of dots and the origin of ring coordinates; `version`
 * changes whenever the console re-renders data, so the text mask follows the copy.
 */
export function ConsoleField({ lanes, live, content, version }: { lanes: readonly LaneView[]; live: boolean; content: RefObject<HTMLElement | null>; version: number }) {
  const { paused, theme } = use(ConsoleMotion);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fieldRef = useRef<GlyphField | null>(null);
  const pieceRef = useRef<FieldPiece | null>(null);
  const prev = useRef<Map<number, Look> | null>(null);

  // Mount the engine once; palette and pause are applied by their own effects.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const piece = new FieldPiece();
    const field = new GlyphField(canvas, piece, { ...PALETTE.ink, cellW: 8, fps: 24, font: "ui-monospace, monospace", weight: 400 });
    pieceRef.current = piece;
    fieldRef.current = field;
    return () => {
      field.destroy();
      fieldRef.current = null;
      pieceRef.current = null;
    };
  }, []);

  useEffect(() => {
    fieldRef.current?.setPalette(PALETTE[theme].fg, PALETTE[theme].bg);
  }, [theme]);

  useEffect(() => {
    fieldRef.current?.setPaused(paused);
  }, [paused]);

  // Re-mask after the copy changed (coalesced to one frame) and after any resize of the content.
  useEffect(() => {
    const root = content.current;
    const canvas = canvasRef.current;
    if (!root || !canvas) return;
    let raf = 0;
    const remask = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const piece = pieceRef.current;
        if (!piece?.grid) return;
        piece.mask = avoidMask(piece.grid, root, canvas);
        fieldRef.current?.repaint();
      });
    };
    remask();
    const ro = new ResizeObserver(remask);
    ro.observe(root);
    void document.fonts?.ready.then(remask);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [content, version, theme]);

  // Rings from real transitions only.
  useEffect(() => {
    const next = new Map(lanes.map((l) => [l.lane, lookFor(l.stage)]));
    const before = prev.current;
    prev.current = next;
    const field = fieldRef.current;
    const piece = pieceRef.current;
    const root = content.current;
    const canvas = canvasRef.current;
    if (!before || !live || paused || document.hidden || !field || !piece?.grid || !root || !canvas || field.reducedMotion) return;
    const origin = canvas.getBoundingClientRect();
    const cw = piece.grid.cellW;
    const ringAt = (el: Element | null, kind: RingKind) => {
      if (!el) return;
      const r = el.getBoundingClientRect();
      piece.rings.push({ x: ((r.left + r.right) / 2 - origin.left) / cw, y: ((r.top + r.bottom) / 2 - origin.top) / cw, t0: piece.now, kind, ...RING[kind] });
    };
    const wasCaptured = [...before.values()].includes("captured");
    let captureRung = false;
    for (const [lane, look] of next) {
      const was = before.get(lane);
      if (was === undefined || was === look) continue;
      const feed = root.querySelector(`[data-lane="${lane}"] [data-feed]`);
      if (look === "held") ringAt(feed, "held");
      else if (look === "released" || look === "declined") ringAt(feed, "release");
      else if (look === "captured" && !wasCaptured && !captureRung) {
        ringAt(root.querySelector('[aria-label="People"]'), "capture");
        captureRung = true;
      }
    }
    field.repaint();
  }, [lanes, live, paused, content]);

  return <canvas ref={canvasRef} aria-hidden="true" className="pointer-events-none absolute inset-0 z-0 size-full @max-[860px]:hidden" />;
}
