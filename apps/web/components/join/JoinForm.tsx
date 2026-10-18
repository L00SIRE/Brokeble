"use client";

// /j/[code] join form (B plan T8; never cut). Posts to the agent, then hands off to the sms: deep link plus the visible
// number and code. Privacy: the budget lives only in uncontrolled inputs and the request body. It is never logged,
// persisted to storage or sent to analytics (there is none).
import { type FormEvent, useEffect, useRef, useState } from "react";
import type { JoinResponse } from "@/lib/agent";
import { joinPlan } from "@/lib/agentRequest";
import { firstError } from "@/lib/formUtils";
import {
  JOIN_FAILURE_COPY,
  JOIN_FIELD_ORDER,
  type JoinField,
  type JoinFailure,
  mapJoinIssues,
  validateJoin,
} from "@/lib/joinForm";
import { formatPhone } from "@/lib/normalizePhone";
import { CopyButton } from "./CopyButton";
import { buttonClass, Field, inputClass, LockIcon, MoneyInput, Notice, Spinner } from "./ui";

type Errors = Partial<Record<JoinField, string>>;
type View = { kind: "form" } | { kind: "done"; result: JoinResponse } | { kind: "closed"; failure: JoinFailure };
type Banner = { kind: "failure"; failure: JoinFailure } | { kind: "network" };

const INPUT_NAME: Record<JoinField, string> = {
  phone: "phone",
  firstName: "first_name",
  budgetTarget: "budget_target",
  budgetMax: "budget_max",
  consent: "consent",
};

export function JoinForm({ code }: { code: string }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [view, setView] = useState<View>({ kind: "form" });
  const [errors, setErrors] = useState<Errors>({});
  const [banner, setBanner] = useState<Banner | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Focus after the fieldset is re-enabled; disabled controls can't take focus.
  useEffect(() => {
    const field = firstError(JOIN_FIELD_ORDER, errors);
    if (field) (formRef.current?.elements.namedItem(INPUT_NAME[field]) as HTMLElement | null)?.focus();
  }, [errors]);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting) return;
    const data = new FormData(e.currentTarget);
    const text = (name: string) => String(data.get(name) ?? "");
    const checked = validateJoin(code, {
      phone: text("phone"),
      firstName: text("first_name"),
      budgetTarget: text("budget_target"),
      budgetMax: text("budget_max"),
      consent: data.get("consent") !== null,
    });
    setBanner(null);
    if (!checked.ok) {
      setErrors(checked.errors);
      return;
    }
    setErrors({});
    setSubmitting(true);
    const out = await joinPlan(checked.body);
    setSubmitting(false);
    if (out.kind === "ok") return setView({ kind: "done", result: out.data });
    if (out.kind === "network") return setBanner({ kind: "network" });

    const failure: JoinFailure = out.error;
    if (failure === "invalid") {
      const mapped = mapJoinIssues(out.issues);
      setErrors(mapped.errors);
      if (mapped.rest || Object.keys(mapped.errors).length === 0) setBanner({ kind: "failure", failure });
    } else if (JOIN_FAILURE_COPY[failure].terminal) {
      setView({ kind: "closed", failure });
    } else {
      setBanner({ kind: "failure", failure });
    }
  }

  if (view.kind === "done") return <JoinSuccess result={view.result} />;
  if (view.kind === "closed") {
    const copy = JOIN_FAILURE_COPY[view.failure];
    return (
      <div aria-live="polite">
        <Notice tone="error" title={copy.title}>
          <p className="text-muted">{copy.body}</p>
        </Notice>
      </div>
    );
  }

  return (
    <form ref={formRef} onSubmit={onSubmit} noValidate aria-label={`Join plan ${code}`}>
      <fieldset disabled={submitting} className="flex min-w-0 flex-col gap-4">
        <legend className="sr-only">Your details</legend>

        <Field label="Phone number" hint="The number you'll text SquadTab from." error={errors.phone}>
          {(c) => (
            <input
              {...c}
              name="phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              spellCheck={false}
              required
              placeholder="(310) 555-0123"
              className={inputClass}
            />
          )}
        </Field>

        <Field label="First name" hint="What SquadTab should call you." error={errors.firstName}>
          {(c) => (
            <input
              {...c}
              name="first_name"
              type="text"
              autoComplete="given-name"
              autoCapitalize="words"
              maxLength={40}
              required
              placeholder="Leo"
              className={inputClass}
            />
          )}
        </Field>

        <div role="group" aria-labelledby="budget-heading" className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-4">
          <div className="flex items-center gap-2 text-lock">
            <LockIcon />
            <h2 id="budget-heading" className="text-base font-semibold text-fg">
              Your budget <span className="font-normal text-muted">(optional)</span>
            </h2>
          </div>
          <p className="text-sm text-pretty text-muted">
            Target is what you'd like to spend, all-in. Hard max is the most you'd ever pay. Skip it and SquadTab will ask you by text.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Target" error={errors.budgetTarget}>
              {(c) => <MoneyInput {...c} name="budget_target" placeholder="60" />}
            </Field>
            <Field label="Hard max" error={errors.budgetMax}>
              {(c) => <MoneyInput {...c} name="budget_max" placeholder="80" />}
            </Field>
          </div>
          <p className="text-sm font-medium">Only SquadTab's code checks prices against this. Nobody in the group sees it.</p>
        </div>

        <div>
          <label className="flex min-h-11 items-start gap-3 py-1">
            <input
              type="checkbox"
              name="consent"
              aria-invalid={errors.consent ? true : undefined}
              aria-describedby="consent-msg"
              className="mt-0.5 size-6 shrink-0 accent-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            />
            <span className="text-sm text-pretty">
              I agree that SquadTab may text me about this plan. SquadTab keeps my number only for this plan, and I can text "forget me" to delete it.
            </span>
          </label>
          <p id="consent-msg" aria-live="polite" className="min-h-5 text-sm text-danger">
            {errors.consent}
          </p>
        </div>

        <div aria-live="polite">
          {banner ? (
            <Notice tone="error" title={banner.kind === "network" ? "Couldn't reach SquadTab" : JOIN_FAILURE_COPY[banner.failure].title}>
              <p className="text-sm text-muted">
                {banner.kind === "network" ? "Check your connection. Your details weren't sent." : JOIN_FAILURE_COPY[banner.failure].body}
              </p>
              {banner.kind === "network" || banner.failure !== "invalid" ? (
                <button type="button" onClick={() => formRef.current?.requestSubmit()} className="self-start text-sm font-semibold text-accent underline underline-offset-4">
                  Try again
                </button>
              ) : null}
            </Notice>
          ) : null}
        </div>

        <button type="submit" className={buttonClass}>
          {submitting ? (
            <>
              <Spinner />
              Joining…
            </>
          ) : (
            "Join plan"
          )}
        </button>
      </fieldset>
    </form>
  );
}

/** Success: a big "Text SquadTab" link to sms_href, plus the number and join_text in plain text with copy buttons, because
 * iOS honouring the prefilled body is UNVERIFIED and sms: does nothing on desktop. */
export function JoinSuccess({ result }: { result: JoinResponse }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);
  // The server builds sms_href, but a link target is a trust boundary: only ever render an sms: scheme.
  const canOpen = result.sms_href.startsWith("sms:");

  return (
    <section aria-labelledby="joined-heading" className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <h2 id="joined-heading" ref={heading} tabIndex={-1} className="text-xl font-semibold text-balance outline-none">
          You're in. One last step.
        </h2>
        <p className="text-pretty text-muted">Send SquadTab your first message to finish joining. SquadTab can't text you first.</p>
      </div>

      {canOpen ? (
        <a href={result.sms_href} className={`${buttonClass} h-14 text-lg`}>
          Text SquadTab
        </a>
      ) : null}

      <ul className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-4">
        <CopyRow label="Text this number" shown={formatPhone(result.assigned_number)} value={result.assigned_number} />
        <CopyRow label="Send this message" shown={result.join_text} value={result.join_text} />
      </ul>

      <p className="text-sm text-pretty text-muted">
        Send it as your first message. On a computer? Send it from your phone.
      </p>
      <p className="text-sm text-pretty text-muted">
        Make sure your iPhone texts from the number you just entered: Settings → Apps → Messages → Send &amp; Receive → Start New Conversations From.
      </p>
    </section>
  );
}

function CopyRow({ label, shown, value }: { label: string; shown: string; value: string }) {
  return (
    <li className="flex items-center justify-between gap-3">
      <div className="flex min-w-0 flex-col">
        <span className="text-sm text-muted">{label}</span>
        <span className="font-mono text-lg tabular-nums break-words select-all">{shown}</span>
      </div>
      <CopyButton value={value} what={label.toLowerCase()} />
    </li>
  );
}
