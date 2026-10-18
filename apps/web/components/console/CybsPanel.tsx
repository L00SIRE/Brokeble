"use client";

// "In Cybersource" (operator view, ?ops=1): each payment of the latest order as Cybersource itself reports it. The
// venue looks every recorded transaction up live (Transaction Details) and returns allowlisted fields only; this panel
// polls that through the agent. Nothing here comes from SquadTab's own ledger except the request id we recorded.
import { useEffect, useState } from "react";
import { AgentError, agent, type CybsResponse, type CybsRow } from "@/lib/agent";
import { readOperatorKey } from "@/lib/operatorKey";
import { MONO, Panel } from "./Panel";

const POLL_MS = 5_000;
const COLS = "Share,Operation,Status,Amount,Card,Submitted,Processor,Cybersource request id".split(",");

type Fetched = Extract<CybsResponse, { available: true }>;
export type CybsState =
  | { kind: "loading" }
  | { kind: "nokey" }
  | { kind: "error"; why: string }
  | { kind: "unavailable"; reason: string }
  | { kind: "ready"; data: Fetched };

const UNAVAILABLE: Record<string, string> = {
  no_order: "No order yet. Payments appear here once a plan reaches ordering.",
  venue_simulated: "This deployment's venue is simulated, so there is no Cybersource record to fetch.",
  venue_unreachable: "The venue could not be reached just now. Retrying.",
};

/** Poll every few seconds while the tab is visible. The key is read per tick so typing it into the ops bar is enough. */
export function useCybersource(): CybsState {
  const [state, setState] = useState<CybsState>({ kind: "loading" });
  useEffect(() => {
    const ctl = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      const key = readOperatorKey();
      if (!key) setState({ kind: "nokey" });
      else if (!document.hidden) {
        try {
          const r = await agent.cybersource(key, ctl.signal);
          setState(r.available ? { kind: "ready", data: r } : { kind: "unavailable", reason: r.reason });
        } catch (e) {
          if (!ctl.signal.aborted) setState({ kind: "error", why: e instanceof AgentError && e.status === 401 ? "wrong operator key" : "agent unreachable" });
        }
      }
      if (!ctl.signal.aborted) timer = setTimeout(tick, POLL_MS);
    };
    void tick();
    return () => {
      ctl.abort();
      clearTimeout(timer);
    };
  }, []);
  return state;
}

/** "2026-10-18T14:03:22Z" → "14:03:22 UTC"; anything else is shown as is. */
export const submitted = (t: string | null): string => {
  const m = t?.match(/T(\d{2}:\d{2}:\d{2})/);
  return m ? `${m[1]} UTC` : (t ?? "·");
};

export const amountOf = (r: CybsRow): string => {
  const n = Number(r.txn?.amount);
  if (!r.txn?.amount || !Number.isFinite(n)) return "·";
  return `${!r.txn.currency || r.txn.currency === "USD" ? "$" : `${r.txn.currency} `}${n.toFixed(2)}`;
};

const LOOKUP_NOTE: Record<CybsRow["lookup"], string> = {
  live: "",
  pending: "Cybersource has not indexed this yet",
  unavailable: "Lookup unavailable",
  simulated: "Simulated id, not in Cybersource",
  none: "No Cybersource id recorded",
};

function Row({ r }: { r: CybsRow }) {
  const t = r.txn;
  const note = LOOKUP_NOTE[r.lookup];
  const dim = "text-(--c-2)";
  return (
    <tr className="border-t border-(--c-rule) align-top">
      <td className="py-[.35cqw] pr-[1cqw]">{r.seq}</td>
      <td className="pr-[1cqw] font-[650] whitespace-nowrap">{t?.operation ?? { auth: "Authorization hold", capture: "Capture", reverse: "Reversal", timeout_reverse: "Reversal" }[r.op]}</td>
      <td className="pr-[1cqw] whitespace-nowrap">
        {t ? (
          <>
            <span className="font-[650]">{t.status ?? t.message ?? "·"}</span>
            <span className={dim}> · reason {t.reason_code ?? "·"}</span>
          </>
        ) : (
          <span className={dim}>{note}</span>
        )}
      </td>
      <td className={`${MONO} pr-[1cqw] whitespace-nowrap`}>{amountOf(r)}</td>
      <td className="pr-[1cqw] whitespace-nowrap">{t?.card_type ? `${t.card_type}${t.card_last4 ? ` ···· ${t.card_last4}` : ""}` : "·"}</td>
      <td className={`${MONO} pr-[1cqw] whitespace-nowrap`}>{submitted(t?.submit_time ?? null)}</td>
      <td className="pr-[1cqw] whitespace-nowrap">{t?.processor ?? "·"}</td>
      <td translate="no" className={`${MONO} break-all`}>
        {r.cybs_id ?? "·"}
      </td>
    </tr>
  );
}

/** Pure view, so it renders (and is tested) without a network. */
export function CybsView({ state }: { state: CybsState }) {
  const data = state.kind === "ready" ? state.data : null;
  return (
    <Panel title="In Cybersource" aside="fetched live from Cybersource">
      <div role="status" aria-live="polite" className="text-[max(12px,.98cqw)] text-(--c-2)">
        {state.kind === "loading" ? "Asking Cybersource…" : null}
        {state.kind === "nokey" ? "Enter the operator key in the ops bar below to load this." : null}
        {state.kind === "error" ? `Could not load: ${state.why}.` : null}
        {state.kind === "unavailable" ? (UNAVAILABLE[state.reason] ?? "Not available right now.") : null}
        {data ? (
          <>
            <span className="text-(--c-fg)">{data.environment ?? "no environment"}</span>
            {" · "}
            {data.source.label}
            {data.rows[0]?.txn?.merchant_id ? ` · merchant ${data.rows[0].txn.merchant_id}` : ""}
            {" · order "}
            <span className={MONO}>{data.order_id ?? "none"}</span>
          </>
        ) : null}
      </div>
      {data && data.rows.length > 0 ? (
        <div className="mt-[.5cqw] overflow-x-auto">
          <table className="w-full min-w-[46rem] border-collapse text-left text-[max(12px,1cqw)] leading-tight">
            <caption className="sr-only">Cybersource transactions for the latest order, as reported by Cybersource</caption>
            <thead>
              <tr className="text-(--c-2)">
                {COLS.map((c) => (
                  <th key={c} scope="col" className="pr-[1cqw] pb-[.25cqw] font-normal whitespace-nowrap">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <Row key={`${r.seq}-${r.op}-${r.attempt}`} r={r} />
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {data && data.rows.length === 0 ? <p className="mt-[.4cqw] text-[max(12px,.98cqw)] text-(--c-2)">No payments recorded for this order yet.</p> : null}
    </Panel>
  );
}

export function CybsPanel() {
  return <CybsView state={useCybersource()} />;
}
