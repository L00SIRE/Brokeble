import type { ShareStatus } from "@tab/shared";
import { usd } from "@/lib/format";
import type { LaneView, LedgerRow } from "@/lib/consoleReducer";
import { Panel, Waiting } from "./Panel";

const TONE: Record<ShareStatus, string> = {
  PENDING: "text-muted",
  AUTHORIZING: "text-warn",
  AUTHORIZED: "text-accent",
  DECLINED: "text-danger",
  AUTH_UNKNOWN: "text-warn",
  TIMEOUT_REVERSING: "text-warn",
  CAPTURING: "text-accent",
  CAPTURED: "text-ok",
  REVERSING: "text-warn",
  RELEASED: "text-warn",
  VOID: "text-muted",
};

/** One row per lane: share status, amount and Cybersource id. Rows flip together on capture or release. */
export function LedgerPanel({ rows, lanes }: { rows: readonly LedgerRow[]; lanes: readonly LaneView[] }) {
  const names = new Map(lanes.map((l) => [l.lane, l.first_name]));
  const ordered = [...rows].sort((a, b) => a.lane - b.lane);
  const total = ordered.reduce((sum, r) => sum + r.amount_cents, 0);
  return (
    <Panel title="Ledger">
      {ordered.length === 0 ? (
        <Waiting>No holds yet</Waiting>
      ) : (
        <table className="w-full border-separate border-spacing-y-1 text-left">
          <thead className="sr-only">
            <tr>
              <th>Person</th>
              <th>Status</th>
              <th>Amount</th>
              <th>Cybersource id</th>
            </tr>
          </thead>
          <tbody>
            {ordered.map((r) => (
              <tr key={r.lane}>
                <th scope="row" className="pr-3 font-semibold">
                  {names.get(r.lane) ?? `Lane ${r.lane}`}
                </th>
                <td className={`pr-3 font-mono text-(length:--text-console-label) font-medium ${TONE[r.status]}`}>{r.status}</td>
                <td className="pr-3 text-right font-mono font-semibold tabular-nums">{usd(r.amount_cents)}</td>
                <td className="text-right font-mono text-(length:--text-console-label) text-muted">{r.cybs_id_short ?? "—"}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-border">
              <th scope="row" className="pt-1 text-muted">
                Total
              </th>
              <td />
              <td className="pt-1 text-right font-mono font-semibold tabular-nums">{usd(total)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      )}
    </Panel>
  );
}
