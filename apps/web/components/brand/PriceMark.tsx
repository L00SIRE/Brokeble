"use client";

import { useEffect, useRef } from "react";
import { GlyphField } from "@/lib/motion/glyphField";
import { MARK_BG, MARK_FG, createPricePiece, type PricePiece } from "@/lib/motion/priceMark";

export type PriceMarkFrame = {
  /** Motion is reduced: the mark shows its still calm frame. */
  readonly reduced: boolean;
  /** Frozen on the calm frame because the visitor is busy with the form. */
  readonly calm: boolean;
};

type PriceMarkProps = {
  /** Price per person in dollars. Whole dollars print bare ("42"). */
  price: number;
  /** Stop the clock (Pause motion, or the calm frame). */
  paused?: boolean;
  /** Show the calm all-held frame (design-system §4.4). */
  calm?: boolean;
  /** Pin the clock for review (`?t=2.4`). */
  freezeAt?: number | null;
  /** Called after every painted frame with the hero-clock time it shows. */
  onFrame?: (shownT: number, state: PriceMarkFrame) => void;
  /** Classes for the canvas (its size). */
  className?: string;
  /** Classes for the box that holds the canvas and its pre-paint fallback (its grid placement). */
  wrapperClassName?: string;
};

const FPS = 30;
const DISPLAY_FALLBACK = '"Funnel Display", ui-sans-serif, system-ui, sans-serif';
const MONO_FALLBACK = '"Martian Mono", ui-monospace, "SF Mono", Menlo, monospace';

/** next/font hashes family names, so read the real list from the variable it sets on <html>. */
function family(el: Element, cssVar: string, fallback: string): string {
  return getComputedStyle(el).getPropertyValue(cssVar).trim() || fallback;
}

function markText(price: number): string {
  return Number.isInteger(price) ? String(price) : price.toFixed(2);
}

/**
 * The ticket's price drawn in digit glyphs (design-system §4.2). Decorative: the canvas is
 * aria-hidden and the ticket's own label carries the price for assistive tech.
 */
export function PriceMark({ price, paused = false, calm = false, freezeAt = null, onFrame, className, wrapperClassName }: PriceMarkProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fieldRef = useRef<GlyphField | null>(null);
  const pieceRef = useRef<PricePiece | null>(null);
  const onFrameRef = useRef(onFrame);
  const calmRef = useRef(calm);
  const text = markText(price);

  useEffect(() => {
    onFrameRef.current = onFrame;
  }, [onFrame]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    const display = () => family(canvas, "--font-funnel-display", DISPLAY_FALLBACK);
    const mono = family(canvas, "--font-martian-mono", MONO_FALLBACK);
    const piece = createPricePiece(text, display);
    piece.calm = calmRef.current;
    piece.onFrame = (shownT) => {
      // The first painted frame retires the server-rendered fallback (the CSS sibling rule below).
      if (!canvas.hasAttribute("data-painted")) canvas.setAttribute("data-painted", "");
      onFrameRef.current?.(shownT, { reduced: reduced.matches, calm: piece.calm });
    };
    let field: GlyphField;
    try {
      field = new GlyphField(canvas, piece, { fg: MARK_FG, bg: MARK_BG, fps: FPS, font: mono, weight: 700, stretch: "condensed" });
    } catch {
      return; // no 2D canvas: the ticket still reads through its label and copy
    }
    fieldRef.current = field;
    pieceRef.current = piece;
    // Canvas text never triggers a webfont download on its own; ask for both faces, then re-lay out.
    void Promise.allSettled([document.fonts.load(`800 100px ${display()}`), document.fonts.load(`700 13px ${mono}`)]).then(() => {
      field.setFont(family(canvas, "--font-martian-mono", MONO_FALLBACK));
    });
    return () => {
      field.destroy();
      fieldRef.current = null;
      pieceRef.current = null;
    };
  }, [text]);

  useEffect(() => {
    fieldRef.current?.setPaused(paused);
  }, [paused, text]);

  useEffect(() => {
    calmRef.current = calm;
    const piece = pieceRef.current;
    if (!piece || piece.calm === calm) return;
    piece.calm = calm;
    fieldRef.current?.repaint();
  }, [calm, text]);

  useEffect(() => {
    fieldRef.current?.freeze(freezeAt);
  }, [freezeAt, text]);

  return (
    <span className={`relative block min-w-0 ${wrapperClassName ?? ""}`}>
      <canvas ref={canvasRef} aria-hidden="true" className={className} />
      <MarkFallback text={text} />
    </span>
  );
}

/** Digit height of Funnel Display as a share of the font size, and the mask's horizontal condense (priceMark.ts). */
const FALLBACK_CAP = 0.7;
const FALLBACK_CONDENSE = 0.9;

/**
 * The price set in plain type over the canvas until its first frame is drawn: before hydration,
 * or if canvas is unavailable, the ticket still shows a recognizable number instead of a dark gap.
 * An SVG scales with the canvas box at every breakpoint, so it lines up with the mask without
 * knowing the box size. Dim on purpose: it reads as the unlit mark, not as a second price.
 */
function MarkFallback({ text }: { text: string }) {
  const fontSize = 100;
  const h = fontSize * FALLBACK_CAP * 1.04; // the mask fills 96% of the box height
  const w = Math.max(h * 1.62, text.length * fontSize * 0.62 * FALLBACK_CONDENSE * 1.02);
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox={`0 0 ${w.toFixed(1)} ${h.toFixed(1)}`}
      preserveAspectRatio="xMidYMid meet"
      className="pointer-events-none absolute inset-0 size-full text-night-3 opacity-35 [[data-painted]+&]:invisible"
    >
      <text
        x={w / 2}
        y={h / 2}
        textAnchor="middle"
        dominantBaseline="central"
        transform={`translate(${(w / 2) * (1 - FALLBACK_CONDENSE)} 0) scale(${FALLBACK_CONDENSE} 1)`}
        fill="currentColor"
        fontSize={fontSize}
        fontWeight={800}
        letterSpacing={fontSize * 0.02}
        className="font-display"
      >
        {text}
      </text>
    </svg>
  );
}
