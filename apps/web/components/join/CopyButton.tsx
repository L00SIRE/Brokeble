"use client";

import { useEffect, useRef, useState } from "react";
import { secondaryButtonClass } from "./ui";

/** Copies `value` to the clipboard. If the clipboard is blocked the label says so and the value stays selectable. */
export function CopyButton({ value, what }: { value: string; what: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setState("copied");
    } catch {
      setState("failed");
    }
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), 2500);
  }

  return (
    <>
      <button type="button" onClick={copy} aria-label={`Copy ${what}`} className={`${secondaryButtonClass} min-w-20`}>
        {state === "copied" ? "Copied" : state === "failed" ? "Select it" : "Copy"}
      </button>
      <span role="status" className="sr-only">
        {state === "copied" ? `${what} copied` : state === "failed" ? `Couldn't copy ${what}. Select the text instead.` : ""}
      </span>
    </>
  );
}
