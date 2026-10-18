import { usd0 } from "@/lib/format";
import type { ConsoleState } from "@/lib/consoleReducer";
import { Panel, Waiting } from "./Panel";

/** "CREAO found N → plain-code filter kept M" and the three PublicBundle cards. Budgets never reach this slice. */
export function ShortlistPanel({ shortlist }: { shortlist: ConsoleState["shortlist"] }) {
  return (
    <Panel title="Shortlist">
      {!shortlist ? (
        <Waiting>Waiting for research</Waiting>
      ) : (
        <div className="flex h-full flex-col gap-3">
          <p className="flex flex-wrap items-baseline gap-x-3 text-(length:--text-console-body) text-muted">
            <span>CREAO found</span>
            <b className="text-(length:--text-console-key) font-semibold text-fg">{shortlist.from_count}</b>
            <span aria-hidden>→</span>
            <span>plain-code filter kept</span>
            <b className="text-(length:--text-console-key) font-semibold text-ok">{shortlist.survived_count}</b>
            <span className="font-mono text-(length:--text-console-label)">v{shortlist.version}</span>
          </p>
          <ol className="grid min-h-0 flex-1 grid-cols-3 gap-3">
            {shortlist.bundles.map((b) => (
              <li key={b.id} className="flex min-h-0 flex-col gap-1 overflow-hidden rounded-lg bg-surface-2 p-3">
                <div className="flex items-baseline justify-between">
                  <span className="text-(length:--text-console-key) font-semibold text-accent">{b.index}</span>
                  <span className="font-mono text-(length:--text-console-body) font-semibold">{usd0(b.all_in_pp_cents)}/pp</span>
                </div>
                <p className="text-(length:--text-console-label) font-medium leading-snug">{b.title}</p>
                <p className="font-mono text-[0.9rem] text-muted">
                  {b.dinner_time} dinner · {b.show_start}–{b.show_end_est} show
                </p>
                <p className="line-clamp-3 text-[0.95rem] leading-snug text-muted">{b.pitch}</p>
              </li>
            ))}
          </ol>
        </div>
      )}
    </Panel>
  );
}
