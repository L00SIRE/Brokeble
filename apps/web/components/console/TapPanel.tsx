"use client";

// TAP panel (B plan T12): the signed agent request and the merchant's six-step verification. Wording is fixed by
// PLAN §1: "Signed agent request (Visa Trusted Agent Protocol) ✓ verified by merchant", "Key directory: mock";
// never "Visa-verified". The tamper/replay/expired/wrong-tag buttons appear only when the page can reach /ops/tap-test.
import type { TapStep } from "@tab/shared";
import { useState } from "react";
import type { ConsoleState } from "@/lib/consoleReducer";
import { Panel, Waiting } from "./Panel";

export type TapTestKind = "tamper" | "replay" | "expired" | "wrong_tag";
const TEST_BUTTONS: readonly { kind: TapTestKind; label: string }[] = [
  { kind: "tamper", label: "Tamper" },
  { kind: "replay", label: "Replay" },
  { kind: "expired", label: "Expired" },
  { kind: "wrong_tag", label: "Wrong Tag" },
];

export const STEP_NAMES: readonly TapStep["name"][] = ["tag", "params", "timestamps", "nonce", "key", "signature"];

/** Always six rows in protocol order; a step the verifier never reached (it stops at the first failure) is `null`. */
export const stepRows = (steps: readonly TapStep[]): { name: TapStep["name"]; step: TapStep | null }[] =>
  STEP_NAMES.map((name) => ({ name, step: steps.find((s) => s.name === name) ?? null }));

function Mark({ ok }: { ok: boolean | null }) {
  if (ok === null) return <span className="text-muted" aria-label="not reached">–</span>;
  return ok ? (
    <span className="text-ok" aria-label="passed">✓</span>
  ) : (
    <span className="text-danger" aria-label="failed">✗</span>
  );
}

function Steps({ steps }: { steps: readonly TapStep[] }) {
  return (
    <ol className="flex flex-col gap-1">
      {stepRows(steps).map(({ name, step }, i) => (
        <li key={name} className="grid min-w-0 grid-cols-[1.5rem_10rem_1fr] items-baseline gap-x-2">
          <Mark ok={step ? step.ok : null} />
          <span className="font-mono capitalize">{`${i + 1} ${name}`}</span>
          <span className="min-w-0 break-words font-mono text-(length:--text-console-label) text-muted">{step?.detail ?? "not reached"}</span>
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
    <ul className="flex flex-wrap gap-x-4 gap-y-1">
      {checks.map(([name, ok]) => (
        <li key={name}>
          <Mark ok={ok} /> {name}
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
      setResult(`Sent ${kind.replace("_", " ")} test. Watch the steps above.`);
    } catch {
      // Error text can carry URLs; show a fixed next step instead.
      setResult("Request failed. Check the operator key and that an order exists.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-muted">Break it:</span>
      {TEST_BUTTONS.map(({ kind, label }) => (
        <button
          key={kind}
          type="button"
          disabled={busy}
          onClick={() => run(kind)}
          className="touch-manipulation rounded-lg border border-border bg-surface-2 px-3 py-1 font-medium hover:border-accent hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50"
        >
          {label}
        </button>
      ))}
      <span role="status" aria-live="polite" className="text-(length:--text-console-label) text-muted">
        {busy ? "Sending…" : result}
      </span>
    </div>
  );
}

export function TapPanel({
  signed,
  verify,
  onTapTest,
}: {
  signed: ConsoleState["tapSigned"];
  verify: ConsoleState["tapVerify"];
  /** POSTs /ops/tap-test; omit to hide the buttons (no operator key). Must reject on failure. */
  onTapTest?: (kind: TapTestKind) => Promise<unknown>;
}) {
  const report = verify?.report ?? null;
  return (
    <Panel title="Signed agent request (Visa Trusted Agent Protocol)" className="min-h-48">
      {!signed && !report ? (
        <Waiting />
      ) : (
        <div className="flex max-h-full flex-col gap-3 overflow-y-auto">
          <p className="flex flex-wrap items-baseline gap-x-3">
            {report ? (
              <span className={`font-semibold ${report.accepted ? "text-ok" : "text-danger"}`}>
                {report.accepted ? "✓ Verified by merchant" : `✗ Rejected by merchant${report.reason ? `: ${report.reason}` : ""}`}
              </span>
            ) : (
              <span className="font-semibold text-accent">Signed, awaiting merchant…</span>
            )}
            <span className="rounded-full border border-border px-2 text-(length:--text-console-label) text-muted">Key directory: mock</span>
          </p>
          {signed && (
            <div className="min-w-0 font-mono text-(length:--text-console-label)">
              <p>
                <span className="text-accent">{signed.method}</span> {signed.path}
              </p>
              <p className="break-all text-muted">{signed.signature_input}</p>
              <p className="text-muted">sig {signed.signature_short}</p>
            </div>
          )}
          {report && (
            <>
              <Steps steps={report.steps} />
              {report.business && <BusinessChecks business={report.business} />}
              <pre aria-label="Signature base" className="max-h-32 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-bg p-2 font-mono text-(length:--text-console-label) text-muted">
                {report.signature_base}
              </pre>
            </>
          )}
          {onTapTest && <TestButtons onTapTest={onTapTest} />}
        </div>
      )}
    </Panel>
  );
}
