"use client";

// Lanes (design-system §7.1, §3.2): one row per person, read left to right as lamp · who + private budget proof ·
// journey rail · amount · state chip · feed into the gate. Shape carries every state as well as color (solid, outline,
// dashed; WCAG 1.4.1). Never renders a budget: the redaction bar is the same width for everyone.
import type { CSSProperties } from "react";
import { Lamp } from "@/components/brand/Lamps";
import type { ConsoleState, LaneView, LedgerRow } from "@/lib/consoleReducer";
import { amountFor, chipFor, displayName, laneSummary, lookFor, proofFor, railFor, type Look, type Rail } from "@/lib/consoleView";
import { LedgerId, ledgerIdFor } from "./Ledger";
import { MONO } from "./Panel";
import { RedactBar, UnsetBar } from "./RedactBar";

const LANE_GRID =
  "grid grid-cols-[1.5cqw_19.6cqw_minmax(0,1fr)_10cqw_9.6cqw_3cqw] items-center gap-x-[1.15cqw] border-b border-(--c-rule) " +
  "@max-[860px]:grid-cols-[16px_minmax(0,1fr)_auto_auto] @max-[860px]:gap-x-2.5 @max-[860px]:gap-y-2.5 @max-[860px]:py-3 " +
  "@max-[860px]:[grid-template-areas:'lamp_who_amt_chip'_'._rail_rail_rail']";

const BAR = "h-[1.25cqw] w-[5.5cqw] @max-[860px]:h-3 @max-[860px]:w-14";

/** Stagger (§7.4): capture flips lanes top to bottom 90ms apart, release goes dashed 140ms apart. */
const delayFor = (look: Look, index: number): string => (look === "captured" ? `${index * 90}ms` : look === "released" ? `${index * 140}ms` : "0ms");

const CHIP: Record<Look, string> = {
  idle: "border-(--c-line) text-(--c-fg)",
  held: "border-(--c-held-edge) bg-(--c-held) text-(--c-ink)",
  captured: "border-(--c-go-edge) bg-(--c-go) text-(--c-ink)",
  released: "border-dashed border-(--c-line) text-(--c-fg)",
  declined: "border-dashed border-(--c-line) text-(--c-fg)",
};

const DASHED = "bg-[repeating-linear-gradient(90deg,var(--c-3)_0_.4cqw,transparent_.4cqw_.8cqw)]";
const FEED_LINE: Record<Look, string> = { idle: DASHED, held: "bg-(--c-held-line)", captured: "bg-(--c-go-line)", released: DASHED, declined: DASHED };
const FEED_SEG: Record<Look, string> = { idle: "bg-(--c-rule)", held: "bg-(--c-held-line)", captured: "bg-(--c-go-line)", released: "bg-(--c-rule)", declined: "bg-(--c-rule)" };

const TRANSITION = "transition-[background-color,border-color,color] duration-200 delay-(--d)";

function Station({ label, mark, captured }: Rail["stations"][number] & { captured: boolean }) {
  const box =
    mark === "now"
      ? "border-(--c-held-edge) bg-(--c-held)"
      : mark === "done"
        ? captured
          ? "border-(--c-go-edge) bg-(--c-go)"
          : "border-(--c-fg) bg-(--c-fg)"
        : mark === "end"
          ? "border-(--c-fg) bg-(--c-bg) bg-[linear-gradient(135deg,transparent_42%,var(--c-fg)_42%_58%,transparent_58%)]"
          : "border-(--c-line) bg-(--c-bg)";
  const text = mark === "todo" ? "text-(--c-2)" : mark === "done" ? "text-(--c-fg)" : "font-[650] text-(--c-fg)";
  return (
    <span className={`relative grid gap-[.4cqw] text-[max(14px,1.1cqw)] leading-none whitespace-nowrap ${text}`}>
      <i className={`block size-[1.1cqw] min-h-2.5 min-w-2.5 rounded-[.2cqw] border-[.16cqw] ${TRANSITION} ${box}`} />
      {label}
    </span>
  );
}

/** The journey rail. RELEASED keeps its history solid to Held, then runs dashed to its end mark (§3.2). */
function RailView({ rail, captured, faint }: { rail: Rail; captured: boolean; faint?: boolean }) {
  const solid = Math.max(0, rail.solidTo);
  const dashedFrom = rail.ended ? solid : faint ? 0 : null;
  return (
    <div aria-hidden="true" data-avoid className="relative grid grid-cols-4 @max-[860px]:[grid-area:rail]">
      <i className="absolute top-[.55cqw] left-[.55cqw] h-[.16cqw] min-h-px w-3/4 bg-(--c-rule)" />
      {solid > 0 ? (
        <i
          className={`absolute top-[.55cqw] left-[.55cqw] h-[.16cqw] min-h-px w-3/4 origin-left transition-transform duration-500 ease-(--ease-snap) ${captured ? "bg-(--c-go-line)" : "bg-(--c-fg)"}`}
          style={{ transform: `scaleX(${solid / 3})` }}
        />
      ) : null}
      {dashedFrom !== null ? (
        <i
          className="absolute top-[.55cqw] h-[.16cqw] min-h-px bg-[repeating-linear-gradient(90deg,var(--c-fg)_0_.5cqw,transparent_.5cqw_.8cqw)]"
          style={{ left: `calc(.55cqw + ${dashedFrom * 25}%)`, width: `${(3 - dashedFrom) * 25}%` }}
        />
      ) : null}
      {rail.stations.map((s) => (
        <Station key={s.label} {...s} captured={captured} />
      ))}
    </div>
  );
}

function Feed({ look }: { look: Look }) {
  return (
    <span aria-hidden="true" data-avoid data-feed className="relative self-stretch @max-[860px]:hidden">
      <i className={`absolute inset-x-0 top-1/2 -mt-[.1cqw] h-[.2cqw] ${TRANSITION} ${FEED_LINE[look]}`} />
      <i className={`absolute top-[.35cqw] right-0 bottom-[.35cqw] w-[.6cqw] rounded-[.15cqw] ${TRANSITION} ${FEED_SEG[look]}`} />
    </span>
  );
}

function Lane({ lane, index, dense, share, shortlist, ledger }: { lane: LaneView; index: number; dense: boolean; share: number | null; shortlist: ConsoleState["shortlist"]; ledger: Record<number, LedgerRow> }) {
  const look = lookFor(lane.stage);
  const amount = amountFor(lane, share);
  const proof = proofFor(lane.stage, { shortlist, share });
  return (
    <li data-lane={lane.lane} data-look={look} className={LANE_GRID} style={{ "--d": delayFor(look, index) } as CSSProperties}>
      <span data-lamp data-avoid className="grid place-items-center @max-[860px]:[grid-area:lamp]">
        <Lamp state={lane.stage} className="size-[1.3cqw] min-h-3 min-w-3 border-[.17cqw] delay-(--d)" />
      </span>
      <span className="grid min-w-0 gap-[.5cqw] @max-[860px]:[grid-area:who]">
        <span className={`font-display leading-none font-[680] tracking-[-.035em] break-words ${dense ? "text-[1.6cqw]" : "text-[2.2cqw]"} @max-[860px]:text-[21px]`}>{displayName(lane)}</span>
        <span className="flex min-w-0 items-center gap-[.7cqw] text-[max(15px,1.2cqw)] leading-tight whitespace-nowrap text-(--c-2) @max-[860px]:flex-wrap @max-[860px]:whitespace-normal">
          {proof.kind === "unset" ? <UnsetBar className={BAR} /> : <RedactBar salt={lane.lane} className={BAR} />}
          {/* Clipped to the who column: no proof string may cross into the rail. */}
          <span className="min-w-0 overflow-hidden text-ellipsis">
            {proof.text}
            {proof.fits ? (
              <>
                {" · "}
                <b className="font-[650] text-(--c-fg)">{proof.fits}</b>
              </>
            ) : null}
          </span>
        </span>
      </span>
      <RailView rail={railFor(lane.stage)} captured={look === "captured"} />
      <span className="grid justify-items-end gap-[.15cqw] @max-[860px]:[grid-area:amt]">
        <span className={`${MONO} text-[1.7cqw] leading-none font-[650] tracking-[-.02em] ${TRANSITION} ${amount.quiet ? "text-(--c-2)" : "text-(--c-fg)"} @max-[860px]:text-base`}>
          {amount.value}
        </span>
        <span className="text-right text-[max(15px,1.2cqw)] leading-none whitespace-nowrap text-(--c-2) @max-[860px]:hidden">{amount.caption}</span>
        <LedgerId id={ledgerIdFor(lane, ledger)} />
      </span>
      <span
        key={lane.stage}
        data-avoid
        className={`justify-self-end rounded-[.35cqw] border-[.15cqw] px-[.6cqw] py-[.4cqw] ${MONO} text-[max(16px,1.35cqw)] font-bold tracking-[.04em] whitespace-nowrap ${TRANSITION} ${CHIP[look]} motion-safe:animate-[c-chip-in_.42s_cubic-bezier(.2,.8,.2,1)] @max-[860px]:[grid-area:chip]`}
      >
        {chipFor(lane.stage)}
      </span>
      <Feed look={look} />
      <span className="sr-only">{laneSummary(lane, share)}</span>
    </li>
  );
}

/**
 * Lane rhythm (§7.1, about 70px at 1280×720): fixed rows from the top, never stretched to fill the board. A long roster
 * shrinks the rows to fit (minmax(0, …)), so the gate never scrolls.
 */
const ROW = "minmax(0, 5.6cqw)";

/** The empty console's lanes: the real future shape (hollow lamps, dashed rails) at 40% opacity (§7.3). */
function OpenSeat() {
  const rail: Rail = { stations: railFor("INVITED").stations, solidTo: -1, ended: false };
  return (
    <li aria-hidden="true" className={`${LANE_GRID} opacity-40`}>
      <span className="grid place-items-center @max-[860px]:[grid-area:lamp]">
        <Lamp state="VOTED" className="size-[1.3cqw] min-h-3 min-w-3 border-[.17cqw]" />
      </span>
      <span className="grid gap-[.5cqw] @max-[860px]:[grid-area:who]">
        <span className="font-display text-[2.2cqw] leading-none font-[680] tracking-[-.035em] text-(--c-2) @max-[860px]:text-[21px]">Open seat</span>
        <UnsetBar className={BAR} />
      </span>
      <RailView rail={rail} captured={false} faint />
      <span />
      <span />
      <Feed look="idle" />
    </li>
  );
}

const OPEN_SEATS = [1, 2, 3, 4];

export function Lanes({ lanes, share, shortlist, ledger }: { lanes: readonly LaneView[]; share: number | null; shortlist: ConsoleState["shortlist"]; ledger: Record<number, LedgerRow> }) {
  const rows = lanes.length || OPEN_SEATS.length;
  const dense = lanes.length > 5;
  return (
    <ul
      aria-label="People"
      className="col-start-1 row-start-3 grid min-h-0 content-start border-t border-(--c-rule) @max-[860px]:[grid-template-rows:none!important]"
      style={{ gridTemplateRows: `repeat(${rows}, ${ROW})` }}
    >
      {lanes.length === 0 ? (
        <>
          <li className="sr-only">No one has joined yet.</li>
          {OPEN_SEATS.map((n) => (
            <OpenSeat key={n} />
          ))}
        </>
      ) : (
        lanes.map((lane, i) => <Lane key={lane.lane} lane={lane} index={i} dense={dense} share={share} shortlist={shortlist} ledger={ledger} />)
      )}
    </ul>
  );
}
