"use client";

import { useMotion } from "@/lib/motion/MotionProvider";

/**
 * Pause motion (design-system 4.4, WCAG 2.2.2). Shown on every page with a running canvas. Under reduced motion
 * nothing runs, so there is nothing to pause and the control is not rendered. The state persists only for this page
 * view by design: a reload starts with motion on, and the OS setting is the durable preference.
 */
export function MotionToggle({ className }: { className?: string }) {
  const { paused, reduced, setPaused } = useMotion();
  if (reduced) return null;
  return (
    <button
      type="button"
      aria-pressed={paused}
      onClick={() => setPaused(!paused)}
      className={className ? `motion-toggle ${className}` : "motion-toggle"}
    >
      <span className="glyph" aria-hidden="true">
        <i />
        <i />
      </span>
      {/* A toggle keeps one name; aria-pressed and the glyph (bars, then a play triangle) carry the state. */}
      Pause motion
    </button>
  );
}
