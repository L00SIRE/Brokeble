"use client";

// CREAO research agents (design-system §7.2): one row per real run, "kind · category", a 22-cell track and a mono
// status, then the latest streamed step with its actor in bold. Honest by construction (§10 bans fake progress): a
// cell lights only for a `creao.progress` step this console actually received for that run, and the track fills only
// when the run's own `creao.run` status says completed. The concierge row before capture is a stated wait, not a run.
import { useEffect, useRef, useState } from "react";
import type { CreaoRunView, ProgressLine } from "@/lib/consoleReducer";
import { MONO, Panel } from "./Panel";

const TERMINAL = new Set(["completed", "failed", "cancelled", "timed_out"]);
export const isTerminal = (status: string) => TERMINAL.has(status);

export const TRACK_CELLS = 22;
const MAX_ROWS = 3;

export function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Terminal runs show the server's final elapsed_ms; live ones tick, never below the last server-reported value. */
export const elapsedFor = (run: CreaoRunView, now: number): number =>
  isTerminal(run.status) ? run.elapsed_ms : Math.max(run.elapsed_ms, now - run.first_seen_at);

const ACTOR: Readonly<Record<string, string>> = { scout: "Scout", concierge: "Concierge", scout_live_demo: "Live scout" };
const actorFor = (kind: string) => ACTOR[kind] ?? kind.replace(/_/g, " ");
export const runLabel = (kind: string, category: string | null) => `${actorFor(kind)} · ${category ?? (kind === "concierge" ? "booking" : "research")}`;

/** Mono status: "done 0:41", "booking 0:03", "searching 0:12", "failed 0:30", "stopped". */
export function runStatus(run: CreaoRunView, now: number): string {
  const t = formatElapsed(elapsedFor(run, now));
  const tail = run.source === "cached" ? " · cached" : "";
  switch (run.status) {
    case "completed":
      return `done ${t}${tail}`;
    case "failed":
      return `failed ${t}${tail}`;
    case "timed_out":
      return `timed out ${t}${tail}`;
    case "cancelled":
      return `stopped${tail}`;
    default:
      return `${run.kind === "concierge" ? "booking" : "searching"} ${t}${tail}`;
  }
}

/** Lit cells: every step received for the run (capped), all of them once the run itself reports completed. */
export const litCells = (run: CreaoRunView, steps: number): number => (run.status === "completed" ? TRACK_CELLS : Math.min(TRACK_CELLS, steps));

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

/**
 * Steps seen per run. The reducer keeps only the last few progress lines, so the count accumulates here by line id
 * (idempotent, so a double render cannot double count). A line without a run id goes to the newest unfinished run of
 * the same kind and category.
 */
function useStepCounts(runs: readonly CreaoRunView[], progress: readonly ProgressLine[]): Map<string, number> {
  const seen = useRef(new Map<string, Set<number>>());
  for (const p of progress) {
    const owner =
      p.run_id ??
      runs
        .filter((r) => r.kind === p.kind && r.category === p.category && !isTerminal(r.status))
        .toSorted((a, b) => b.first_seen_at - a.first_seen_at)[0]?.run_id;
    if (!owner) continue;
    let ids = seen.current.get(owner);
    if (!ids) seen.current.set(owner, (ids = new Set()));
    ids.add(p.id);
  }
  return new Map([...seen.current].map(([id, ids]) => [id, ids.size]));
}

function Track({ lit, dim }: { lit: number; dim: boolean }) {
  return (
    <span aria-hidden="true" className={`${MONO} overflow-hidden text-[max(11px,1cqw)] tracking-[.02em] whitespace-nowrap text-(--c-rule) [font-variation-settings:'wdth'_75]`}>
      <b className={`font-normal ${dim ? "text-(--c-2)" : "text-(--c-fg)"}`}>{"▮".repeat(lit)}</b>
      {"▯".repeat(TRACK_CELLS - lit)}
    </span>
  );
}

const ROW = "grid grid-cols-[11cqw_minmax(0,1fr)_auto] items-center gap-[1cqw] text-[max(13px,1.1cqw)] @max-[860px]:grid-cols-[118px_minmax(0,1fr)_auto] @max-[860px]:gap-2.5";
const STAT = `${MONO} text-right text-[max(12px,.98cqw)] whitespace-nowrap text-(--c-2) @max-[860px]:whitespace-normal`;

function RunRow({ run, steps, now }: { run: CreaoRunView; steps: number; now: number }) {
  return (
    <li className={ROW}>
      <span>{runLabel(run.kind, run.category)}</span>
      <Track lit={litCells(run, steps)} dim={isTerminal(run.status) && run.status !== "completed"} />
      <span className={STAT}>
        {runStatus(run, now)}
        {run.share_url ? (
          <>
            {" · "}
            <a href={run.share_url} target="_blank" rel="noopener noreferrer" className="text-(--c-fg) underline decoration-2 underline-offset-4">
              Open run
              <span className="sr-only">
                {" "}
                <span translate="no">{run.run_id.slice(0, 8)}</span> (opens in a new tab)
              </span>
            </a>
          </>
        ) : null}
      </span>
    </li>
  );
}

/** The concierge before it exists: it books only after capture, so it waits for n of n (or stopped on a release). */
function ConciergeWait({ state, n }: { state: "waits" | "stopped"; n: number }) {
  return (
    <li className={ROW}>
      <span>{runLabel("concierge", null)}</span>
      <Track lit={0} dim />
      <span className={STAT}>{state === "stopped" ? "stopped" : `waits for ${n} of ${n}`}</span>
    </li>
  );
}

const sourcesAside = (runs: readonly CreaoRunView[]) => {
  const live = runs.some((r) => r.source === "live");
  const cached = runs.some((r) => r.source === "cached");
  return live && cached ? "live and cached runs" : cached ? "cached runs" : "live runs";
};

export function CreaoLane({
  runs,
  progress,
  concierge = null,
  n = 0,
}: {
  runs: readonly CreaoRunView[];
  progress: readonly ProgressLine[];
  /** The concierge's stated wait when no concierge run exists yet: "waits" before capture, "stopped" after a release. */
  concierge?: "waits" | "stopped" | null;
  n?: number;
}) {
  const now = useNow(runs.some((r) => !isTerminal(r.status)));
  const steps = useStepCounts(runs, progress);
  const shown = runs.toSorted((a, b) => a.first_seen_at - b.first_seen_at).slice(-MAX_ROWS);
  const hasConciergeRun = runs.some((r) => r.kind === "concierge");
  const wait = !hasConciergeRun && concierge ? concierge : null;
  const last = progress.at(-1);
  return (
    <Panel title="CREAO research agents" aside={sourcesAside(runs)}>
      {shown.length === 0 && !wait ? (
        <p className="text-[max(13px,1.1cqw)] text-(--c-2)">Research starts when every budget is in.</p>
      ) : (
        <ul className="grid gap-[.4cqw]">
          {(wait ? shown.slice(-(MAX_ROWS - 1)) : shown).map((r) => (
            <RunRow key={r.run_id} run={r} steps={steps.get(r.run_id) ?? 0} now={now} />
          ))}
          {wait ? <ConciergeWait state={wait} n={n} /> : null}
        </ul>
      )}
      {/* role=log is an implicit polite live region: a new step is announced without stealing focus. */}
      <p role="log" aria-label="CREAO progress" className="mt-[.5cqw] text-[max(13px,1.1cqw)] leading-[1.3] text-pretty">
        {wait === "stopped" ? (
          <>
            <b className="font-[650]">Concierge stopped.</b> Nothing booked, nothing charged.
          </>
        ) : last ? (
          <>
            <b className="font-[650]">{actorFor(last.kind)}:</b> {last.step}
          </>
        ) : null}
      </p>
    </Panel>
  );
}
