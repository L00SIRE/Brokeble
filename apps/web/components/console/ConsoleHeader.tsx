import { PLAN_STEPS, stepFor, type PlanView } from "@/lib/consoleReducer";
import type { ConsoleStreamStatus } from "@/lib/useConsoleStream";

const STREAM_DOT: Record<ConsoleStreamStatus | "missing", string> = {
  idle: "bg-muted",
  connecting: "bg-warn",
  open: "bg-ok",
  reconnecting: "bg-warn",
  unauthorized: "bg-danger",
  missing: "bg-danger",
};

const STREAM_LABEL: Record<ConsoleStreamStatus | "missing", string> = {
  idle: "idle",
  connecting: "connecting",
  open: "live",
  reconnecting: "reconnecting",
  unauthorized: "bad console key",
  missing: "missing console key",
};

/** Plan state stepper (Gather → Research → Vote → Hold → Book) with the plan version and stream health. */
export function ConsoleHeader({ plan, stream, invalid }: { plan: PlanView | null; stream: ConsoleStreamStatus | "missing"; invalid: number }) {
  const step = plan ? stepFor(plan.state) : -1;
  const stopped = plan !== null && step < 0;
  return (
    <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
      <div className="flex items-baseline gap-5">
        <h1 className="text-(length:--text-console-key) font-semibold">Tab</h1>
        <p className="text-(length:--text-console-label) uppercase tracking-wide text-muted">Trust Console</p>
      </div>
      <nav aria-label="Plan progress" className="flex items-center gap-2">
        <ol className="flex items-center gap-2">
          {PLAN_STEPS.map((label, i) => {
            const state = i < step ? "done" : i === step ? "current" : "todo";
            return (
              <li
                key={label}
                aria-current={state === "current" ? "step" : undefined}
                className={`rounded-full border px-5 py-1.5 text-(length:--text-console-body) font-medium transition-colors ${
                  state === "current"
                    ? "border-accent bg-accent/15 text-accent"
                    : state === "done"
                      ? "border-ok/40 text-ok"
                      : "border-border text-muted"
                }`}
              >
                {state === "done" ? "✓ " : ""}
                {label}
              </li>
            );
          })}
        </ol>
        {stopped ? (
          <span className="rounded-full border border-danger/50 bg-danger/10 px-5 py-1.5 text-(length:--text-console-body) font-medium text-danger">{plan.state}</span>
        ) : null}
      </nav>
      <p role="status" className="flex items-center gap-3 font-mono text-(length:--text-console-label) text-muted">
        {plan ? <span>v{plan.version}</span> : null}
        <span aria-hidden className={`size-3 rounded-full ${STREAM_DOT[stream]}`} />
        <span>{STREAM_LABEL[stream]}</span>
        {invalid > 0 ? <span className="text-warn">{invalid} invalid</span> : null}
      </p>
    </header>
  );
}
