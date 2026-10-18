import { usd } from "@/lib/format";
import type { ConsoleState } from "@/lib/consoleReducer";
import { Panel } from "./Panel";

function Stat({ value, label, tone = "text-fg" }: { value: string; label: string; tone?: string }) {
  return (
    <div className="flex flex-col-reverse justify-end gap-1">
      <dd className={`font-mono text-(length:--text-console-hero) font-semibold leading-none tabular-nums ${tone}`}>{value}</dd>
      <dt className="text-(length:--text-console-label) leading-tight text-muted">{label}</dt>
    </div>
  );
}

/** Groups converted all-or-nothing · dollars fronted by any individual · holds released. */
export function CountersPanel({ counters }: { counters: ConsoleState["counters"] }) {
  const dash = "—";
  return (
    <Panel title="Counters">
      <dl className="grid h-full grid-cols-3 items-center gap-4">
        <Stat value={counters ? String(counters.groups_converted) : dash} label="groups converted, all-or-nothing" tone="text-ok" />
        <Stat value={counters ? usd(counters.fronted_by_individual_cents) : dash} label="fronted by any individual" />
        <Stat value={counters ? String(counters.holds_released) : dash} label="holds released" tone="text-warn" />
      </dl>
    </Panel>
  );
}
