"use client";

import { type ReactNode, useEffect, useRef } from "react";
import { stubTitle } from "./classes";
import { useFlow } from "./FlowContext";

/**
 * Every phase's heading. It takes focus when it mounts after something the person did here (submit, fix, a phase
 * flip while they watch), so screen-reader and keyboard users land on the new state (ux-flow §4.3). A cold resume
 * from storage doesn't steal focus; the first poll after it does.
 */
export function PhaseHeading({ children, className = stubTitle }: { children: ReactNode; className?: string }) {
  const { meta } = useFlow();
  const ref = useRef<HTMLHeadingElement>(null);
  const settled = useRef(false);
  useEffect(() => {
    // Once per mounted heading (StrictMode re-runs effects; a second pass must not turn a cold resume into a focus).
    if (settled.current) return;
    settled.current = true;
    if (meta.focusOnPhaseChange.current) ref.current?.focus();
    meta.focusOnPhaseChange.current = true;
  }, [meta.focusOnPhaseChange]);
  return (
    <h2 ref={ref} tabIndex={-1} className={className}>
      {children}
    </h2>
  );
}
