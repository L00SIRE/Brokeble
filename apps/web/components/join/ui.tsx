import { type ComponentProps, type ReactNode, useId } from "react";
import { DotIcon } from "@/components/brand/DotIcon";

/*
 * Form primitives (design-system 6.1 and 6.2). Ground-aware: the primary button takes the contrast color of the
 * ground it sits on (ink with a sodium label on paper or sodium, sodium with an ink label on ink), through the
 * --btn-bg / --btn-fg tokens each [data-ground] sets in app/globals.css. There is no red: errors are ink, 3px, in words.
 */

/** 58px tall, white fill, 2px ink border, Martian Mono 17px (>= 16px, so iOS doesn't zoom). 3px border when aria-invalid. */
export const inputClass =
  "h-[58px] w-full min-w-0 touch-manipulation rounded-control border-2 border-ink bg-white px-[18px] mono text-[17px] tracking-[.01em] text-ink " +
  "placeholder:text-on-paper-2 placeholder:opacity-100 focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-fg " +
  "aria-invalid:border-[3px] read-only:bg-paper-2 disabled:bg-paper-2";

/**
 * Primary: 58px, Funnel Sans 700 17px, radius 6px, 1px press. Full width (the forms and stubs are single-column).
 * While a request runs, set `disabled` and `aria-busy` together: busy keeps full strength (label + `Spinner`) instead of dimming.
 */
export const buttonClass =
  "inline-flex h-[58px] w-full touch-manipulation items-center justify-center gap-3 rounded-control bg-(--btn-bg) px-[26px] " +
  "font-sans text-[17px] font-bold tracking-[-.01em] whitespace-nowrap text-(--btn-fg) transition-transform duration-75 " +
  "active:translate-y-px focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-fg " +
  "disabled:cursor-not-allowed disabled:opacity-70 disabled:active:translate-y-0 aria-busy:cursor-progress aria-busy:opacity-100";

/** Text button: underline 2px, offset 4px. Still a 44px target. For "Copy link instead" and other secondary actions. */
export const secondaryButtonClass =
  "inline-flex min-h-11 shrink-0 touch-manipulation items-center justify-center gap-2 px-1 text-[15px] font-semibold text-fg " +
  "underline decoration-2 underline-offset-4 hover:decoration-[3px] focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-fg";

/** The "→" that nudges 3px when its button is hovered. Put it last inside a button or link. */
export function Arrow() {
  return (
    <span aria-hidden="true" className="arrow">
      →
    </span>
  );
}

export type ControlProps = { id: string; "aria-describedby": string; "aria-invalid": true | undefined };

/**
 * Label + control + one message slot. The label sits above (never a placeholder-as-label). The slot shows the error
 * if there is one, else the hint, and always reserves a line, so a validation error never shifts the layout.
 */
export function Field({
  label,
  hint,
  error,
  optional,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  optional?: boolean;
  children: (control: ControlProps) => ReactNode;
}) {
  const id = useId();
  const messageId = `${id}-msg`;
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="flex items-baseline justify-between gap-2 text-[15px] font-semibold">
        {label}
        {optional ? <span className="font-normal text-muted">Optional</span> : null}
      </label>
      {children({ id, "aria-describedby": messageId, "aria-invalid": error ? true : undefined })}
      <p id={messageId} aria-live="polite" className={`min-h-5 text-sm ${error ? "font-semibold text-fg" : "text-muted"}`}>
        {error ?? hint}
      </p>
    </div>
  );
}

/** Dollar input: the "$" is decoration only; the value stays a plain number string. */
export function MoneyInput(props: Omit<ComponentProps<"input">, "type" | "inputMode" | "autoComplete">) {
  return (
    <div className="relative">
      <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-[18px] flex items-center mono text-[17px] text-on-paper-2">
        $
      </span>
      <input
        {...props}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        spellCheck={false}
        data-1p-ignore
        data-lpignore="true"
        className={`${inputClass} pl-9 tabular-nums`}
      />
    </div>
  );
}

/** Busy indicator: three dots stepping at 6 Hz, beside the ux-flow label ("Getting your line…"). Still under reduced motion. */
export function Spinner() {
  return (
    <span aria-hidden="true" className="busy-dots">
      <i />
      <i />
      <i />
    </span>
  );
}

/** The lock: a stroked shackle on a solid body (design-system 6.5), in currentColor. */
export function LockIcon() {
  return <DotIcon name="lock" className="size-5 shrink-0" />;
}

/** Inline status box. Callers keep it inside an `aria-live` region so changes are announced. No red: an error is a 3px rule. */
export function Notice({ tone, title, children }: { tone: "error" | "info"; title: string; children?: ReactNode }) {
  const frame = tone === "error" ? "border-[3px] border-fg" : "border-2 border-border";
  return (
    <div className={`flex flex-col gap-2 rounded-control p-4 ${frame}`}>
      <p className="font-semibold text-balance">{title}</p>
      {children}
    </div>
  );
}
