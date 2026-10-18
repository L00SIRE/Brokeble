"use client";

// Signed agent request (design-system §7.2 "TAP summary"): a 3-line human summary and the merchant's six checks in
// plain words. Wording is fixed by PLAN §1: "Verified by merchant", "Key directory: mock"; never "Visa-verified".
// With ?ops=1 the raw evidence (signature base, business checks) and the tamper/replay/expired/wrong-tag buttons
// appear below; the projector view stays readable from 5 m.
import type { TapStep } from "@tab/shared";
import { useEffect, useState } from "react";
import { DotIcon } from "@/components/brand/DotIcon";
import type { ConsoleState } from "@/lib/consoleReducer";
import { tapSummary, type TapLine } from "@/lib/consoleView";
import { MONO, Panel } from "./Panel";

export type TapTestKind = "tamper" | "replay" | "expired" | "wrong_tag";
const TEST_BUTTONS: readonly { kind: TapTestKind; label: string }[] = [
  { kind: "tamper", label: "Tamper" },
  { kind: "replay", label: "Replay" },
  { kind: "expired", label: "Expired" },
  { kind: "wrong_tag", label: "Wrong tag" },
];

export const STEP_NAMES: readonly TapStep["name"][] = ["tag", "params", "timestamps", "nonce", "key", "signature"];

/** Plain words for the six verifier steps (§7.2). */
export const STEP_LABEL: Readonly<Record<TapStep["name"], string>> = {
  tag: "Agent known",
  params: "Details sealed",
  timestamps: "Not expired",
  nonce: "Never reused",
  key: "Key on file",
  signature: "Signature good",
};

/** Always six rows in protocol order; a step the verifier never reached (it stops at the first failure) is `null`. */
export const stepRows = (steps: readonly TapStep[]): { name: TapStep["name"]; step: TapStep | null }[] =>
  STEP_NAMES.map((name) => ({ name, step: steps.find((s) => s.name === name) ?? null }));

/** Pass: a dot check in go. Not reached: one dot. Failed: an empty box, plus the word "failed" (no check or cross characters, §10). */
function Mark({ ok }: { ok: boolean | null }) {
  if (ok === true) return <DotIcon name="check" color="var(--c-go-text)" className="size-[1.2cqw] min-h-3.5 min-w-3.5" />;
  if (ok === false) return <DotIcon name="box" className="size-[1.2cqw] min-h-3.5 min-w-3.5" />;
  return <DotIcon name="wait" className="size-[1.2cqw] min-h-3.5 min-w-3.5" />;
}

function Line({ line, last }: { line: TapLine; last: boolean }) {
  return (
    <li className="flex flex-wrap items-center gap-[.7cqw] text-[max(14px,1.2cqw)] leading-[1.2]">
      <Mark ok={line.ok} />
      <span className={line.ok === null ? "text-(--c-2)" : ""}>
        {line.text}
        {line.strong ? <b className="font-[650]">{line.strong}</b> : null}
      </span>
      {last ? (
        <span className={`${MONO} ml-[.4cqw] rounded-[.3cqw] border border-dashed border-(--c-line) px-[.5cqw] py-[.1cqw] text-[max(11px,.95cqw)] text-(--c-2)`}>Key directory: mock</span>
      ) : null}
    </li>
  );
}

function Steps({ steps, replayKey }: { steps: readonly TapStep[]; replayKey: string }) {
  return (
    <ol key={replayKey} className="mt-[.6cqw] grid grid-cols-[repeat(3,auto)] justify-start gap-x-[1.6cqw] gap-y-[.25cqw] @max-[860px]:grid-cols-[repeat(2,auto)]">
      {stepRows(steps).map(({ name, step }, i) => (
        <li
          key={name}
          className={`flex items-center gap-[.4cqw] text-[max(12px,.98cqw)] whitespace-nowrap ${step?.ok ? "text-(--c-fg) motion-safe:animate-[c-step-in_.3s_ease-out_both]" : step ? "font-[650] text-(--c-fg)" : "text-(--c-2)"}`}
          // §7.4: the steps tick 250ms apart when the merchant's verdict lands.
          style={step?.ok ? { animationDelay: `${i * 250}ms` } : undefined}
        >
          <Mark ok={step ? step.ok : null} />
          {STEP_LABEL[name]}
          {step && !step.ok ? " · failed" : null}
        </li>
      ))}
    </ol>
  );
}

type Business = NonNullable<NonNullable<ConsoleState["tapVerify"]>["report"]["business"]>;

function BusinessChecks({ business }: { business: Business }) {
  const checks = [
    ["All authorized", business.all_authorized],
    ["Sum matches", business.sum_matches],
    ["Consent matches", business.consent_matches],
  ] as const;
  return (
    <ul className="flex flex-wrap gap-x-[1.2cqw] gap-y-1 text-[max(12px,.98cqw)]">
      {checks.map(([name, ok]) => (
        <li key={name} className="flex items-center gap-[.4cqw]">
          <Mark ok={ok} />
          {name}
          {ok ? null : " · failed"}
        </li>
      ))}
    </ul>
  );
}

function TestButtons({ onTapTest }: { onTapTest: (kind: TapTestKind) => Promise<unknown> }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState("");
  async function run(kind: TapTestKind) {
    setBusy(true);
    setResult("");
    try {
      await onTapTest(kind);
      setResult(`Sent ${kind.replace("_", " ")} test. Watch the checks above.`);
    } catch {
      // Error text can carry URLs; show a fixed next step instead.
      setResult("Request failed. Check the operator key and that an order exists.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex flex-wrap items-center gap-2 text-[max(13px,1cqw)]">
      <span className="text-(--c-2)">Break it:</span>
      {TEST_BUTTONS.map(({ kind, label }) => (
        <button
          key={kind}
          type="button"
          disabled={busy}
          onClick={() => run(kind)}
          className="min-h-11 touch-manipulation rounded-[6px] border-2 border-(--c-line) px-3 font-semibold transition-colors hover:border-(--c-fg) disabled:opacity-50"
        >
          {label}
        </button>
      ))}
      <span role="status" aria-live="polite" className="text-(--c-2)">
        {busy ? "Sending…" : result}
      </span>
    </div>
  );
}

/** Re-renders once a minute while a signature is live, so "Expires in n min" stays true. */
function useMinuteClock(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

export function TapPanel({
  signed,
  verify,
  onTapTest,
}: {
  signed: ConsoleState["tapSigned"];
  verify: ConsoleState["tapVerify"];
  /** POSTs /ops/tap-test; omit to hide the buttons and raw evidence (no ops bar). Must reject on failure. */
  onTapTest?: (kind: TapTestKind) => Promise<unknown>;
}) {
  const now = useMinuteClock(signed !== null);
  const { phase, lines } = tapSummary(signed, verify, now);
  const report = verify?.report ?? null;
  return (
    <Panel title="Signed agent request" aside="Visa Trusted Agent Protocol">
      <ul aria-live="polite" className="grid gap-[.35cqw]">
        {lines.map((line, i) => (
          <Line key={i} line={line} last={i === lines.length - 1} />
        ))}
      </ul>
      <Steps steps={report?.steps ?? []} replayKey={`${phase}:${verify?.order_id ?? ""}`} />
      {onTapTest ? (
        <div className="mt-3 grid gap-2">
          {report?.business ? <BusinessChecks business={report.business} /> : null}
          {report ? (
            <pre aria-label="Signature base" className={`${MONO} max-h-32 overflow-auto rounded-[6px] border border-(--c-rule) p-2 text-[max(11px,.9cqw)] break-all whitespace-pre-wrap text-(--c-2)`}>
              {report.signature_base}
            </pre>
          ) : null}
          <TestButtons onTapTest={onTapTest} />
        </div>
      ) : null}
    </Panel>
  );
}
