import { type ComponentProps, type ReactNode, useId } from "react";

/** 48px tall, 16px text (no iOS zoom), visible focus ring, red border when aria-invalid. */
export const inputClass =
  "h-12 w-full touch-manipulation rounded-xl border border-border bg-surface-2 px-4 text-base text-fg placeholder:text-muted/70 " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent aria-invalid:border-danger read-only:opacity-70";

export const buttonClass =
  "inline-flex h-12 w-full touch-manipulation items-center justify-center gap-2 rounded-xl bg-accent px-5 text-base font-semibold text-bg " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fg disabled:cursor-not-allowed disabled:opacity-60";

export const secondaryButtonClass =
  "inline-flex h-11 shrink-0 touch-manipulation items-center justify-center rounded-lg border border-border bg-surface-2 px-4 text-sm font-medium text-fg " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

export type ControlProps = { id: string; "aria-describedby": string; "aria-invalid": true | undefined };

/**
 * Label + control + one message slot. The slot shows the error if there is one, else the hint, and always reserves a
 * line, so a validation error never shifts the layout.
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
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="flex items-baseline justify-between gap-2 text-sm font-medium">
        {label}
        {optional ? <span className="font-normal text-muted">Optional</span> : null}
      </label>
      {children({ id, "aria-describedby": messageId, "aria-invalid": error ? true : undefined })}
      <p id={messageId} aria-live="polite" className={`min-h-5 text-sm ${error ? "text-danger" : "text-muted"}`}>
        {error ?? hint}
      </p>
    </div>
  );
}

/** Dollar input: the "$" is decoration only; the value stays a plain number string. */
export function MoneyInput(props: Omit<ComponentProps<"input">, "type" | "inputMode" | "autoComplete">) {
  return (
    <div className="relative">
      <span aria-hidden className="pointer-events-none absolute inset-y-0 left-4 flex items-center text-muted">
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
        className={`${inputClass} pl-8 tabular-nums`}
      />
    </div>
  );
}

export function Spinner() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="size-5 motion-safe:animate-spin" fill="none" stroke="currentColor" strokeWidth="3">
      <circle cx="12" cy="12" r="9" opacity=".25" />
      <path d="M21 12a9 9 0 0 0-9-9" strokeLinecap="round" />
    </svg>
  );
}

export function LockIcon() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="size-5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}

/** Inline status box. Callers keep it inside an `aria-live` region so changes are announced. */
export function Notice({ tone, title, children }: { tone: "error" | "info"; title: string; children?: ReactNode }) {
  const color = tone === "error" ? "border-danger/50 bg-danger/10" : "border-border bg-surface";
  return (
    <div className={`flex flex-col gap-2 rounded-xl border p-4 ${color}`}>
      <p className="font-medium text-balance">{title}</p>
      {children}
    </div>
  );
}
