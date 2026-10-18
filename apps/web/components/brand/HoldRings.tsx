"use client";

import { useEffect, useImperativeHandle, useRef, type Ref } from "react";
import { HOLD_RING_GAP, RELEASE_DASH, heroAt, ringsAt, type RingOrigin } from "@/lib/motion/heroScript";

export type HoldRingsHandle = {
  /** Draw the rings live at hero-clock time `shownT`. */
  draw(shownT: number): void;
  /** Remove every ring (reduced motion, calm frame). */
  clear(): void;
};

type HoldRingsProps = {
  ref?: Ref<HoldRingsHandle>;
  /** Selects the seat lamps inside the parent, in seat order (seat 0 first). */
  seatSelector?: string;
  className?: string;
};

type Point = { x: number; y: number };
type Geometry = {
  dpr: number;
  origins: Map<RingOrigin, Point>;
  /** Rects (CSS px, canvas space) that rings never cross: every copy line and control. */
  avoid: Array<[number, number, number, number]>;
  ink: string;
};

const INK_FALLBACK = "#100E0A";

/**
 * Rings on the sodium field, one per real hold, capture or release (design-system §5).
 *
 * The canvas fills its positioned parent. Inside that parent it reads:
 *   `seatSelector` matches       the seat lamps rings start from, in seat order,
 *   [data-ring-center]           the element whose centre the capture ring starts from,
 *   [data-ring-avoid]            blocks whose text lines and controls are kept clear of rings.
 * It draws only when told to (`draw`), so it never runs a loop of its own, and it paints
 * nothing while no ring is alive.
 */
export function HoldRings({ ref, seatSelector = "[data-ring-seat]", className }: HoldRingsProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const geoRef = useRef<Geometry | null>(null);
  const dirtyRef = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    const root = canvas?.parentElement;
    if (!canvas || !root) return;

    const measure = () => {
      const hr = root.getBoundingClientRect();
      if (!hr.width || !hr.height) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(hr.width * dpr);
      canvas.height = Math.round(hr.height * dpr);
      dirtyRef.current = false; // resizing the backing store cleared it
      const centre = (el: Element): Point => {
        const b = el.getBoundingClientRect();
        return { x: (b.left + b.right) / 2 - hr.left, y: (b.top + b.bottom) / 2 - hr.top };
      };
      const origins = new Map<RingOrigin, Point>();
      root.querySelectorAll(seatSelector).forEach((el, seat) => origins.set(seat, centre(el)));
      const center = root.querySelector("[data-ring-center]");
      if (center) origins.set("center", centre(center));

      const avoid: Geometry["avoid"] = [];
      const push = (r: DOMRect, padX: number, padY: number) => {
        if (r.width && r.height) avoid.push([r.left - hr.left - padX, r.top - hr.top - padY, r.width + padX * 2, r.height + padY * 2]);
      };
      root.querySelectorAll("[data-ring-avoid]").forEach((block) => {
        const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
        const range = document.createRange();
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          if (!n.textContent?.trim()) continue;
          range.selectNodeContents(n);
          for (const r of range.getClientRects()) push(r, 6, 2);
        }
        block.querySelectorAll("a,button,input,summary").forEach((el) => push(el.getBoundingClientRect(), 6, 4));
      });
      const ink = getComputedStyle(root).getPropertyValue("--color-ink").trim() || INK_FALLBACK;
      geoRef.current = { dpr, origins, avoid, ink };
    };

    // The observer, font loads and fonts.ready often fire together on a cold load: walk the text once per frame at most.
    let raf = 0;
    const schedule = () => {
      if (!raf)
        raf = requestAnimationFrame(() => {
          raf = 0;
          measure();
        });
    };

    measure();
    const ro = new ResizeObserver(schedule);
    ro.observe(root);
    const center = root.querySelector("[data-ring-center]");
    if (center) ro.observe(center); // the stub's <details> can grow the ticket without resizing the hero
    document.fonts.addEventListener("loadingdone", schedule);
    void document.fonts.ready.then(schedule);
    return () => {
      cancelAnimationFrame(raf);
      raf = 0;
      ro.disconnect();
      document.fonts.removeEventListener("loadingdone", schedule);
      geoRef.current = null;
    };
  }, [seatSelector]);

  useImperativeHandle(ref, () => {
    const context = () => canvasRef.current?.getContext("2d") ?? null;
    const clear = () => {
      if (!dirtyRef.current) return;
      const canvas = canvasRef.current;
      const g = context();
      if (!canvas || !g) return;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, canvas.width, canvas.height);
      dirtyRef.current = false;
    };
    return {
      clear,
      draw(shownT) {
        const geo = geoRef.current;
        const g = context();
        if (!geo || !g) return;
        const { cy, t } = heroAt(shownT);
        const rings = ringsAt(cy, t);
        clear();
        if (!rings.length) return;
        g.setTransform(geo.dpr, 0, 0, geo.dpr, 0, 0);
        g.strokeStyle = geo.ink;
        for (const ring of rings) {
          const o = geo.origins.get(ring.origin);
          if (!o) continue;
          g.setLineDash(ring.dashed ? RELEASE_DASH : []);
          g.lineWidth = ring.lineWidth;
          g.globalAlpha = ring.alpha;
          g.beginPath();
          g.arc(o.x, o.y, ring.radius, 0, Math.PI * 2);
          g.stroke();
          if (ring.double) {
            g.globalAlpha = ring.alpha * 0.5;
            g.beginPath();
            g.arc(o.x, o.y, ring.radius - HOLD_RING_GAP, 0, Math.PI * 2);
            g.stroke();
          }
        }
        g.globalAlpha = 1;
        g.setLineDash([]);
        // Copy never sits on a moving line: punch every text line and control back out.
        for (const [x, y, w, h] of geo.avoid) g.clearRect(x, y, w, h);
        dirtyRef.current = true;
      },
    };
  }, []);

  return <canvas ref={canvasRef} aria-hidden="true" className={className} />;
}
