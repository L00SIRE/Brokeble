"use client";

// Redaction bar (design-system §0 P1, §5): a fixed-width block that stands in for a private budget. Every bar has the
// same width, so its length leaks nothing, and its dots re-roll at 2 Hz: the console's only continuous motion, and it
// means "private". No value is ever drawn; the dots come from a hash of (column, row, tick).
import { use, useEffect, useRef } from "react";
import { hash3 } from "@/lib/motion/glyphField";
import { ConsoleMotion } from "./Panel";

const TICK_MS = 500;

// One shared 2 Hz clock for every bar on the page (instead of one interval per bar). It runs only while some bar is
// subscribed, and skips work in a hidden tab.
const subscribers = new Set<(tick: number) => void>();
let tick = 0;
let timer: ReturnType<typeof setInterval> | undefined;

function subscribe(fn: (tick: number) => void): () => void {
  subscribers.add(fn);
  timer ??= setInterval(() => {
    if (document.hidden) return;
    tick += 1;
    for (const s of subscribers) s(tick);
  }, TICK_MS);
  return () => {
    subscribers.delete(fn);
    if (subscribers.size === 0 && timer !== undefined) {
      clearInterval(timer);
      timer = undefined;
    }
  };
}

function draw(canvas: HTMLCanvasElement, seed: number, salt: number): void {
  const { width: w, height: h } = canvas.getBoundingClientRect();
  if (!w || !h) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const bw = Math.round(w * dpr);
  const bh = Math.round(h * dpr);
  if (canvas.width !== bw || canvas.height !== bh) {
    canvas.width = bw;
    canvas.height = bh;
  }
  const g = canvas.getContext("2d");
  if (!g) return;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  const cs = getComputedStyle(canvas);
  g.fillStyle = cs.getPropertyValue("--c-redact").trim() || "#2a2314";
  g.beginPath();
  g.roundRect(0, 0, w, h, h * 0.22);
  g.fill();
  const pitch = h / 3;
  const cols = Math.floor((w - pitch) / pitch);
  g.fillStyle = cs.getPropertyValue("--c-redact-dot").trim() || "#c98a16";
  for (let x = 0; x < cols; x++) {
    for (let y = 0; y < 2; y++) {
      if (hash3(x + salt * 40, y, seed) <= 0.45) continue;
      g.beginPath();
      g.arc(pitch + x * pitch, pitch * (y + 1), pitch * 0.3, 0, Math.PI * 2);
      g.fill();
    }
  }
}

/**
 * A hidden budget. `salt` keeps neighbouring bars from re-rolling in lockstep. Size it with `className` (height and
 * width in cqw); every lane passes the same width.
 */
export function RedactBar({ salt, className }: { salt: number; className: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const { paused, theme } = use(ConsoleMotion);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    let seed = tick;
    const paint = () => draw(canvas, seed, salt);
    const resize = new ResizeObserver(paint);
    resize.observe(canvas);
    let unsubscribe: (() => void) | undefined;
    const sync = () => {
      unsubscribe?.();
      unsubscribe = undefined;
      if (!paused && !reduced.matches) {
        unsubscribe = subscribe((t) => {
          seed = t;
          paint();
        });
      }
      paint();
    };
    sync();
    reduced.addEventListener("change", sync);
    return () => {
      unsubscribe?.();
      resize.disconnect();
      reduced.removeEventListener("change", sync);
    };
    // `theme` is a dependency so a paused bar still repaints in the new palette.
  }, [paused, theme, salt]);

  return <canvas ref={ref} aria-hidden="true" data-avoid className={`block rounded-[.25cqw] ${className}`} />;
}

/** A budget that is not set yet: the same box, dashed and empty, so the lane keeps its shape. */
export function UnsetBar({ className }: { className: string }) {
  return <span aria-hidden="true" data-avoid className={`block rounded-[.25cqw] border border-dashed border-(--c-line) ${className}`} />;
}
