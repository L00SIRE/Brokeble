"use client";

import { createContext, type ReactNode, use, useEffect, useMemo, useState, useSyncExternalStore } from "react";

/**
 * One motion context for every canvas and CSS animation (design-system 4.1, 4.4, 9).
 * - `reduced`: the OS asks for reduced motion. Draw one still frame; no scramble, rings or transitions.
 * - `paused`: the viewer pressed Pause motion (WCAG 2.2.2). Stop every canvas; CSS animations pause via <html data-motion>.
 * Engines should run only when `!paused && !reduced` (and the tab is visible and the canvas on screen, which they own).
 */
export type Motion = {
  paused: boolean;
  reduced: boolean;
  setPaused: (paused: boolean) => void;
};

const MotionContext = createContext<Motion | null>(null);

const REDUCED_QUERY = "(prefers-reduced-motion: reduce)";

function subscribeReduced(onChange: () => void) {
  const mq = window.matchMedia(REDUCED_QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}
const getReduced = () => window.matchMedia(REDUCED_QUERY).matches;
// The server can't know; canvases don't render on the server, so the first client render corrects it before any frame.
const getReducedOnServer = () => false;

/** Read the OS reduced-motion preference, live. Usable without the provider (e.g. inside an engine hook). */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribeReduced, getReduced, getReducedOnServer);
}

export function MotionProvider({ children }: { children: ReactNode }) {
  const reduced = usePrefersReducedMotion();
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    const root = document.documentElement;
    if (paused) root.dataset.motion = "paused";
    else delete root.dataset.motion;
    return () => {
      delete root.dataset.motion;
    };
  }, [paused]);

  const value = useMemo<Motion>(() => ({ paused, reduced, setPaused }), [paused, reduced]);
  return <MotionContext value={value}>{children}</MotionContext>;
}

/** The motion state. Throws outside `MotionProvider` (the root layout mounts it), so a missing provider fails loudly. */
export function useMotion(): Motion {
  const motion = use(MotionContext);
  if (!motion) throw new Error("useMotion() must be used inside <MotionProvider> (mounted in app/layout.tsx).");
  return motion;
}
