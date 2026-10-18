"use client";

// The one-field phone step (ux-flow §4.1, design-system 6.2–6.3). Composed, not configured:
//   <PhoneStep aria-label="Start a plan">
//     <PhoneField label="Text SquadTab from" />
//     <FirstText text="…" />
//     <SubmitButton busy="Getting your line…">Start in iMessage</SubmitButton>
//     <Legal>By continuing, …</Legal>
//   </PhoneStep>
import { type FormEvent, type ReactNode, useEffect, useId, useRef } from "react";
import { primaryButton, phoneInput } from "./classes";
import { useFlow } from "./FlowContext";

export function PhoneStep({ children, "aria-label": label }: { children: ReactNode; "aria-label": string }) {
  const { state, actions } = useFlow();
  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    void actions.submit(new FormData(e.currentTarget));
  }
  return (
    <form onSubmit={onSubmit} noValidate aria-label={label} aria-busy={state.submitting || undefined}>
      {/* Disabled while submitting: no duplicate taps (ux-flow §6). FormData is read before the fieldset locks. */}
      <fieldset disabled={state.submitting} className="m-0 grid min-w-0 gap-2.5 border-0 p-0">
        {children}
      </fieldset>
    </form>
  );
}

/** Label above (never placeholder-as-label), one tel input, one message slot that only appears on error. */
export function PhoneField({ label }: { label: string }) {
  const { state, actions, meta } = useFlow();
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const error = state.fieldErrors.phone;

  // "Wrong number? Fix it": the number comes back prefilled and selected (ux-flow §4.3).
  useEffect(() => {
    if (!meta.selectDraft.current) return;
    meta.selectDraft.current = false;
    const input = inputRef.current;
    if (!input) return;
    const disclosure = input.closest("details");
    if (disclosure) disclosure.open = true; // desktop: the field lives in "Or enter your number here"
    input.focus();
    input.select();
  }, [meta.selectDraft]);

  // A failed submit moves focus to the field that needs fixing.
  useEffect(() => {
    if (error) inputRef.current?.focus();
  }, [error]);

  return (
    <div className="grid gap-2">
      <label htmlFor={id} className="text-[15px] font-[650]">
        {label}
      </label>
      <input
        ref={inputRef}
        id={id}
        key={state.draft}
        defaultValue={state.draft}
        name="phone"
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        enterKeyHint="go"
        spellCheck={false}
        placeholder="(310) 555-0123"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        // Editing the number clears its error, so a fixed number never keeps the 3px border and sentence.
        onInput={error ? () => actions.clearFieldError("phone") : undefined}
        className={phoneInput}
      />
      {error ? (
        // role="alert": focus is usually already in the field on Go, so moving it there announces nothing new.
        <p id={`${id}-error`} role="alert" className="text-[15px] font-semibold text-pretty">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Primary submit with the busy label and the 6 Hz three-dot sequence. Request errors appear just above it. */
export function SubmitButton({ children, busy }: { children: ReactNode; busy: string }) {
  const { state } = useFlow();
  return (
    <>
      <div aria-live="polite" className="empty:hidden">
        {state.banner ? (
          <div className="grid gap-1 rounded-control border-[3px] border-current px-3.5 py-3">
            <p className="font-semibold text-balance">{state.banner.title}</p>
            <p className="text-[15px] text-muted text-pretty">{state.banner.body}</p>
          </div>
        ) : null}
      </div>
      <button type="submit" className={primaryButton}>
        {state.submitting ? (
          <>
            <span>{busy}</span>
            <span className="busy-dots" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
          </>
        ) : (
          <>
            {children}
            <span className="arrow" aria-hidden="true">
              →
            </span>
          </>
        )}
      </button>
    </>
  );
}

/** "You send the first text. Details": the consent sentence lives in the disclosure (design-system 6.3). */
export function Legal({ children, summary = "You send the first text. Details" }: { children: ReactNode; summary?: string }) {
  return (
    <details className="legal">
      <summary>{summary}</summary>
      <p>{children}</p>
    </details>
  );
}
