"use client";

// "/" organizer form (B plan T8; minimal, the demo uses the seed). Creates a plan and shows the QR and join link.
import { type FormEvent, useEffect, useRef, useState } from "react";
import type { CreatePlanResponse } from "@/lib/agent";
import { createPlan } from "@/lib/agentRequest";
import { CREATE_FIELD_ORDER, type CreateField, localToday, mapCreateIssues, validateCreatePlan } from "@/lib/createPlanForm";
import { firstError } from "@/lib/formUtils";
import { CopyButton } from "./CopyButton";
import { buttonClass, Field, inputClass, Notice, Spinner } from "./ui";

type Errors = Partial<Record<CreateField, string>>;
type Banner = "network" | "rate_limited" | "failed";

const INPUT_NAME: Record<CreateField, string> = {
  title: "title",
  area: "area",
  date: "date",
  timeStart: "time_start",
  timeEnd: "time_end",
  partyTarget: "party_target",
  firstName: "first_name",
  phone: "phone",
};

const BANNER_COPY: Record<Banner, { title: string; body: string }> = {
  network: { title: "Couldn't reach Tab", body: "Check your connection. Nothing was created." },
  rate_limited: { title: "Too many plans from this connection", body: "Wait a minute, then try again." },
  failed: { title: "Something went wrong on our side", body: "Nothing was created. Please try again." },
};

export function CreatePlanForm() {
  const formRef = useRef<HTMLFormElement>(null);
  const [created, setCreated] = useState<CreatePlanResponse | null>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [banner, setBanner] = useState<Banner | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const field = firstError(CREATE_FIELD_ORDER, errors);
    if (field) (formRef.current?.elements.namedItem(INPUT_NAME[field]) as HTMLElement | null)?.focus();
  }, [errors]);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting) return;
    const data = new FormData(e.currentTarget);
    const text = (name: string) => String(data.get(name) ?? "");
    const checked = validateCreatePlan(
      {
        title: text("title"),
        area: text("area"),
        date: text("date"),
        timeStart: text("time_start"),
        timeEnd: text("time_end"),
        partyTarget: text("party_target"),
        firstName: text("first_name"),
        phone: text("phone"),
      },
      localToday(),
    );
    setBanner(null);
    if (!checked.ok) {
      setErrors(checked.errors);
      return;
    }
    setErrors({});
    setSubmitting(true);
    const out = await createPlan(checked.body);
    setSubmitting(false);
    if (out.kind === "ok") return setCreated(out.data);
    if (out.kind === "network") return setBanner("network");
    if (out.error === "invalid") {
      const mapped = mapCreateIssues(out.issues);
      setErrors(mapped.errors);
      if (mapped.rest || Object.keys(mapped.errors).length === 0) setBanner("failed");
      return;
    }
    setBanner(out.error === "rate_limited" ? "rate_limited" : "failed");
  }

  if (created) return <PlanCreated result={created} />;

  return (
    <form ref={formRef} onSubmit={onSubmit} noValidate aria-label="Create a plan">
      <fieldset disabled={submitting} className="flex min-w-0 flex-col gap-4">
        <legend className="sr-only">Plan details</legend>

        <Field label="What's the plan?" error={errors.title}>
          {(c) => <input {...c} name="title" type="text" maxLength={80} required autoComplete="off" placeholder="Saturday dinner and a show" className={inputClass} />}
        </Field>

        <Field label="Where?" hint="A neighborhood or city." error={errors.area}>
          {(c) => <input {...c} name="area" type="text" maxLength={60} required autoComplete="off" placeholder="Santa Monica" className={inputClass} />}
        </Field>

        <Field label="Date" error={errors.date}>
          {(c) => <input {...c} name="date" type="date" required className={`${inputClass} appearance-none`} />}
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Start" error={errors.timeStart}>
            {(c) => <input {...c} name="time_start" type="time" required defaultValue="18:00" className={`${inputClass} tabular-nums`} />}
          </Field>
          <Field label="End" error={errors.timeEnd}>
            {(c) => <input {...c} name="time_end" type="time" required defaultValue="22:00" className={`${inputClass} tabular-nums`} />}
          </Field>
        </div>

        <Field label="How many people?" hint="Between 2 and 8, including you." error={errors.partyTarget}>
          {(c) => <input {...c} name="party_target" type="text" inputMode="numeric" pattern="[2-8]" maxLength={1} required defaultValue="4" autoComplete="off" className={`${inputClass} tabular-nums`} />}
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Your first name" error={errors.firstName}>
            {(c) => <input {...c} name="first_name" type="text" autoComplete="given-name" autoCapitalize="words" maxLength={40} required placeholder="Maya" className={inputClass} />}
          </Field>
          <Field label="Your phone" error={errors.phone}>
            {(c) => <input {...c} name="phone" type="tel" inputMode="tel" autoComplete="tel" spellCheck={false} required placeholder="(310) 555-0123" className={inputClass} />}
          </Field>
        </div>

        <div aria-live="polite">
          {banner ? (
            <Notice tone="error" title={BANNER_COPY[banner].title}>
              <p className="text-sm text-muted">{BANNER_COPY[banner].body}</p>
              <button type="button" onClick={() => formRef.current?.requestSubmit()} className="self-start text-sm font-semibold text-accent underline underline-offset-4">
                Try again
              </button>
            </Notice>
          ) : null}
        </div>

        <button type="submit" className={buttonClass}>
          {submitting ? (
            <>
              <Spinner />
              Creating…
            </>
          ) : (
            "Create plan"
          )}
        </button>
      </fieldset>
    </form>
  );
}

/** Result: QR as <img src="data:image/svg+xml…"> (never dangerouslySetInnerHTML), the join link with a copy button. */
export function PlanCreated({ result }: { result: CreatePlanResponse }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);

  return (
    <section aria-labelledby="created-heading" className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <h2 id="created-heading" ref={heading} tabIndex={-1} className="text-xl font-semibold text-balance outline-none">
          Your plan is ready
        </h2>
        <p className="text-pretty text-muted">Paste this link in your group chat. Tab never joins it.</p>
      </div>

      {/* A data: URI is not optimizable by next/image; the SVG comes from our own agent and renders as an inert image. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(result.qr_svg)}`}
        alt={`QR code to join plan ${result.code}`}
        width={256}
        height={256}
        className="mx-auto size-64 rounded-2xl bg-white p-3"
      />

      <div className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-surface p-4">
        <div className="min-w-0">
          <p className="text-sm text-muted">
            Join link · code <span className="font-mono tabular-nums">{result.code}</span>
          </p>
          <p className="font-mono text-sm break-all select-all">{result.join_url}</p>
        </div>
        <CopyButton value={result.join_url} what="join link" />
      </div>
    </section>
  );
}
