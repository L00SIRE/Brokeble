// Operator footer (rendered only with ?ops=1): message delivery dots, the latest system lines and dropped frames.
// No red (design-system §3.1): a failed delivery is a dashed ring and says "failed" in text.
import type { DeliveryDot, SystemLine } from "@/lib/consoleReducer";
import { MONO } from "./Panel";

const DOT: Record<DeliveryDot["status"], string> = {
  accepted: "border-2 border-(--c-line)",
  dispatched: "bg-(--c-2)",
  delivered: "bg-(--c-fg)",
  failed: "border-2 border-dashed border-(--c-fg)",
};

const LEVEL: Record<SystemLine["level"], string> = { info: "text-(--c-2)", warn: "text-(--c-fg)", error: "font-bold text-(--c-fg)" };

export function ConsoleFooter({ deliveries, system, invalid }: { deliveries: readonly DeliveryDot[]; system: readonly SystemLine[]; invalid: number }) {
  return (
    <footer className={`${MONO} grid gap-3 border-t border-(--c-rule) px-[2.1cqw] py-3 text-[13px] text-(--c-2) md:grid-cols-[auto_1fr]`}>
      <div className="flex flex-wrap items-center gap-3">
        <span>Delivery</span>
        <ul aria-label="Message delivery" className="flex flex-wrap items-center gap-2">
          {deliveries.length === 0 ? <li>no messages yet</li> : null}
          {deliveries.map((d) => (
            <li key={d.message_id_short} title={`${d.message_id_short} ${d.status}${d.lane !== null ? ` · lane ${d.lane}` : ""}`}>
              <span aria-hidden="true" className={`block size-3.5 rounded-full ${DOT[d.status]}`} />
              <span className="sr-only">{d.status}</span>
            </li>
          ))}
        </ul>
        {invalid > 0 ? <span className="text-(--c-fg)">{invalid} invalid frames dropped</span> : null}
      </div>
      <ul aria-label="System messages" className="grid gap-x-6 gap-y-1 md:grid-cols-2">
        {system.map((s) => (
          <li key={s.id} className={`break-words ${LEVEL[s.level]}`}>
            {s.level === "info" ? "" : `${s.level}: `}
            {s.msg}
          </li>
        ))}
      </ul>
    </footer>
  );
}
