import type { DeliveryDot, SystemLine } from "@/lib/consoleReducer";

const DOT: Record<DeliveryDot["status"], string> = {
  accepted: "bg-muted",
  dispatched: "bg-accent",
  delivered: "bg-ok",
  failed: "bg-danger",
};

const LEVEL: Record<SystemLine["level"], string> = { info: "text-muted", warn: "text-warn", error: "text-danger" };

/** Message delivery lifecycle dots (accepted → dispatched → delivered) and the latest system messages. */
export function ConsoleFooter({ deliveries, system }: { deliveries: readonly DeliveryDot[]; system: readonly SystemLine[] }) {
  return (
    <footer className="grid grid-cols-[auto_1fr] items-center gap-6 font-mono text-(length:--text-console-label) text-muted">
      <ul aria-label="Message delivery" className="flex items-center gap-2">
        {deliveries.length === 0 ? <li>no messages yet</li> : null}
        {deliveries.map((d) => (
          <li key={d.message_id_short} title={`${d.message_id_short} ${d.status}${d.lane !== null ? ` · lane ${d.lane}` : ""}`} className="flex items-center gap-1.5">
            <span className={`size-4 rounded-full ${DOT[d.status]}`} />
            <span className="sr-only">
              {d.status}
            </span>
          </li>
        ))}
      </ul>
      <ul aria-label="System messages" className="grid grid-cols-2 gap-x-6">
        {system.map((s) => (
          <li key={s.id} className={`truncate ${LEVEL[s.level]}`}>
            {s.msg}
          </li>
        ))}
      </ul>
    </footer>
  );
}
