"use client";

// CREAO lane (B plan T9/T12): one chip per Scout/Concierge run (status, elapsed ticking from first sight, live/cached,
// "Open run" when a share link exists) above the last streamed progress lines.
import { useEffect, useState } from "react";
import type { CreaoRunView, ProgressLine } from "@/lib/consoleReducer";
import { Panel, Waiting } from "./Panel";

const TERMINAL = new Set(["completed", "failed", "cancelled", "timed_out"]);
export const isTerminal = (status: string) => TERMINAL.has(status);

export function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Terminal runs show the server's final elapsed_ms; live ones tick, never below the last server-reported value. */
export const elapsedFor = (run: CreaoRunView, now: number): number =>
  isTerminal(run.status) ? run.elapsed_ms : Math.max(run.elapsed_ms, now - run.first_seen_at);

const statusTone = (status: string) =>
  status === "completed" ? "text-ok" : status === "failed" || status === "timed_out" ? "text-danger" : isTerminal(status) ? "text-muted" : "text-accent";

const label = (kind: string, category: string | null) => (category ? `${kind.replace(/_/g, " ")} · ${category}` : kind.replace(/_/g, " "));

function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

function RunChip({ run, now }: { run: CreaoRunView; now: number }) {
  return (
    <li className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-border bg-surface-2 px-3 py-2">
      <span className="font-medium capitalize">{label(run.kind, run.category)}</span>
      <span translate="no" className="font-mono text-(length:--text-console-label) text-muted">
        {run.run_id.slice(0, 8)}
      </span>
      <span className={`font-medium ${statusTone(run.status)}`}>{run.status.replace(/_/g, " ")}</span>
      <span className="font-mono text-muted">{formatElapsed(elapsedFor(run, now))}</span>
      <span className="rounded-full border border-border px-2 text-(length:--text-console-label) uppercase tracking-wide text-muted">{run.source}</span>
      {run.share_url && (
        <a
          href={run.share_url}
          target="_blank"
          rel="noopener noreferrer"
          className="ml-auto rounded text-accent underline underline-offset-4 hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          Open Run
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
      )}
    </li>
  );
}

export function CreaoLane({ runs, progress }: { runs: readonly CreaoRunView[]; progress: readonly ProgressLine[] }) {
  const now = useNow(runs.some((r) => !isTerminal(r.status)));
  return (
    <Panel title="CREAO">
      {runs.length === 0 && progress.length === 0 ? (
        <Waiting />
      ) : (
        <div tabIndex={0} aria-label="CREAO runs" className="flex max-h-48 flex-col gap-3 overflow-y-auto">
          {runs.length > 0 && (
            <ul className="flex flex-col gap-2">
              {runs.map((r) => (
                <RunChip key={r.run_id} run={r} now={now} />
              ))}
            </ul>
          )}
          {/* polite live region: new lines are announced without stealing focus */}
          <div aria-live="polite">
            <ol aria-label="CREAO progress" className="flex flex-col gap-1 font-mono text-(length:--text-console-label) text-muted">
              {progress.map((p) => (
                <li key={p.id} className="min-w-0 break-words">
                  <span className="text-accent">{p.category ?? p.kind}</span> {p.step}
                </li>
              ))}
            </ol>
          </div>
        </div>
      )}
    </Panel>
  );
}
