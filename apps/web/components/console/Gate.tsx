// The gate (design-system §0 P1 "all-or-nothing", §7.2): every lane's feed meets one bus, a connector runs into the
// meter, and money moves only when the bus is full. "Held so far $126 of $168 · Charged $0" until n of n; then
// "Captured, all or nothing $168" in go. A release shows "$0 charged" with outline-only cells: no red, ever.
import type { ConsoleState } from "@/lib/consoleReducer";
import { meterFor, type Money } from "@/lib/consoleView";
import { Counters } from "./Counters";
import { MONO } from "./Panel";

/** `n` is seatCount: null while friends can still join, so the title never claims "2 of 2" for a 4-person plan. */
export function GateTitle({ n }: { n: number | null }) {
  return (
    <p className="col-start-2 row-start-2 self-end pb-[1.1cqw] pl-[2.4cqw] font-display text-[1.75cqw] leading-[1.05] font-[680] tracking-[-.03em] @max-[860px]:order-3 @max-[860px]:self-start @max-[860px]:pt-4 @max-[860px]:pb-1 @max-[860px]:pl-0 @max-[860px]:text-[19px]">
      {n ? `Charged only at ${n} of ${n}.` : "Charged only when all are in."}
    </p>
  );
}

const CONNECTOR: Record<Money["mode"], string> = {
  empty: "bg-(--c-rule)",
  holding: "bg-(--c-rule)",
  full: "bg-(--c-held-line)",
  captured: "bg-(--c-go-line)",
  released: "bg-(--c-rule)",
};

function Cells({ money }: { money: Money }) {
  const n = money.n || 4;
  const lit = money.mode === "released" ? money.releasedCount : money.heldCount;
  const on = money.mode === "captured" ? "bg-(--c-go-line)" : money.mode === "released" ? "shadow-[inset_0_0_0_.12cqw_var(--c-line)]" : "bg-(--c-held-line)";
  return (
    <div aria-hidden="true" data-avoid className="mt-[.7cqw] grid max-w-[15cqw] gap-[.35cqw] @max-[860px]:max-w-44 @max-[860px]:gap-1" style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}>
      {Array.from({ length: n }, (_, i) => (
        <i key={i} className={`block h-[.6cqw] min-h-1.5 rounded-[.15cqw] transition-colors duration-200 ${i < lit ? on : "bg-(--c-rule)"}`} />
      ))}
    </div>
  );
}

export function Gate({ money, counters }: { money: Money; counters: ConsoleState["counters"] }) {
  const meter = meterFor(money);
  return (
    <aside aria-label="Money" className="relative col-start-2 row-start-3 flex min-h-0 flex-col pl-[2.4cqw] @max-[860px]:order-4 @max-[860px]:pl-0">
      <div aria-live="polite" aria-atomic="true" className="relative pt-[.6cqw] pb-[.9cqw] @max-[860px]:pt-2 @max-[860px]:pb-4">
        <i aria-hidden="true" className={`absolute top-[3cqw] left-[-2.4cqw] h-[.2cqw] w-[1.8cqw] transition-colors duration-200 @max-[860px]:hidden ${CONNECTOR[money.mode]}`} />
        <p className="text-[max(13px,1.15cqw)] text-(--c-2)">{meter.label}</p>
        <p className="mt-[.3cqw] flex items-baseline gap-[.7cqw] font-display leading-none font-[740] tracking-[-.045em] whitespace-nowrap">
          <span className={`text-[4.3cqw] @max-[860px]:text-[44px] ${money.mode === "captured" ? "text-(--c-go-text)" : ""}`}>{meter.number}</span>
          {meter.of ? <span className="text-[1.9cqw] tracking-[-.02em] text-(--c-2) @max-[860px]:text-lg">{meter.of}</span> : null}
        </p>
        <p className={`${MONO} mt-[.6cqw] text-[max(13px,1.25cqw)]`}>
          {meter.sub.text}
          <b className="font-bold">{meter.sub.strong}</b>
          {meter.sub.rest}
        </p>
        <Cells money={money} />
      </div>
      <Counters counters={counters} />
    </aside>
  );
}
