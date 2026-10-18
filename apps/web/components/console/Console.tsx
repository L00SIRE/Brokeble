"use client";

// Trust Console (design-system §7): snapshot on open, then SSE frames through reduceScoped (the pure consoleReducer
// behind a plan scope and a commit-order guard); every sentence and number is derived in lib/consoleView.ts. A 16:9
// board read from 5 m: header, status sentence, lanes feeding one gate, the privacy band, then the signed request and
// the research agents. Sizes are container-relative (cqw), so it scales from 1280×720 to 1920×1080 and stays inside
// the viewport at any aspect ratio.
//
// `children` is the page's ops slot (OpsBar, mounted with ?ops=1): its presence also shows the operator footer, the
// TAP break-it buttons and the Ink | Paper (projector) switch. `?theme=paper` puts the console on its paper ground.
import { useSearchParams } from "next/navigation";
import { useCallback, useMemo, useReducer, useRef, type ReactNode } from "react";
import { agent } from "@/lib/agent";
import { useMotion } from "@/lib/motion/MotionProvider";
import {
  initialScopedState,
  money as moneyOf,
  planFacts,
  planMeta,
  reduceScoped,
  seatCount,
  settledLanes,
  shareCents,
  sortLanes,
  statusLine,
  type Status,
} from "@/lib/consoleView";
import { readOperatorKey } from "@/lib/operatorKey";
import { useConsoleStream } from "@/lib/useConsoleStream";
import { ConsoleField } from "./ConsoleField";
import { ConsoleFooter } from "./ConsoleFooter";
import { ConsoleHeader, ThemeSwitch } from "./ConsoleHeader";
import { CreaoLane } from "./CreaoLane";
import { Gate, GateTitle } from "./Gate";
import { Lanes } from "./Lanes";
import { CONSOLE_CSS, ConsoleMotion, type ConsoleTheme } from "./Panel";
import { StatusLine } from "./StatusLine";
import { TapPanel, type TapTestKind } from "./TapPanel";
import { XrayPanel } from "./Xray";

export function Console({ consoleKey, children }: { consoleKey: string | null; children?: ReactNode }) {
  const [state, dispatch] = useReducer(reduceScoped, initialScopedState);
  const { status: stream, invalidCount } = useConsoleStream(consoleKey, dispatch);
  const theme: ConsoleTheme = useSearchParams().get("theme") === "paper" ? "paper" : "ink";
  // One app-wide Pause motion (D1's MotionProvider): it also pauses CSS animations through <html data-motion>.
  const { paused, reduced, setPaused } = useMotion();
  const togglePause = useCallback(() => setPaused(!paused), [paused, setPaused]);
  const contentRef = useRef<HTMLDivElement>(null);
  const ops = children != null;

  // Every derivation reads the settled lanes, so a CONFIRMED plan shows captured everywhere at once.
  const laneMap = useMemo(() => settledLanes(state.lanes, state.plan), [state.lanes, state.plan]);
  const view = useMemo(() => ({ ...state, lanes: laneMap }), [state, laneMap]);
  const lanes = useMemo(() => sortLanes(laneMap), [laneMap]);
  const share = useMemo(() => shareCents(lanes, state.ledger), [lanes, state.ledger]);
  const money = useMemo(() => moneyOf(view), [view]);
  const seats = seatCount(view);
  const facts = useMemo(() => planFacts(state.xray), [state.xray]);
  const motion = useMemo(() => ({ paused, theme }), [paused, theme]);
  const contexts = useMemo(() => Object.values(state.xray), [state.xray]);
  const runs = useMemo(() => Object.values(state.creaoRuns), [state.creaoRuns]);

  // The concierge books only after capture: before that it visibly waits for n of n; after a release it stopped.
  const stopped = money.mode === "released" || state.plan?.state === "CANCELLED" || state.plan?.state === "CANCELLING";
  const concierge = stopped ? "stopped" : money.mode !== "captured" && money.heldCount > 0 ? "waits" : null;
  // TAP failure-injection buttons appear only with the ops bar (?ops=1); they reuse its operator key.
  const onTapTest = ops ? (kind: TapTestKind) => agent.tapTest(readOperatorKey(), kind) : undefined;
  // Without a usable key nothing is read: say so in the line read from 5 m, never "Waiting for the group" (§7.3).
  const status: Status = !consoleKey
    ? { big: "Not connected.", small: "Add the console key to the link to watch the plan live." }
    : stream === "unauthorized"
      ? { big: "Not connected.", small: "The console key was refused. Check the link." }
      : statusLine(view);

  return (
    <ConsoleMotion value={motion}>
      <style href="squadtab-console" precedence="default">
        {CONSOLE_CSS}
      </style>
      {/* data-ground remaps the brand kit's legacy aliases (used by OpsBar) to the same ground. */}
      <main data-console data-theme={theme} data-ground={theme} className="min-h-dvh bg-(--c-bg) font-sans text-(--c-fg) tabular-nums">
        <div className="@container mx-auto w-[min(100%,calc(100dvh*16/9))]">
          <div className="relative isolate h-dvh min-h-[22rem] overflow-hidden @max-[860px]:h-auto @max-[860px]:min-h-dvh">
            <ConsoleField lanes={lanes} live={stream === "open"} content={contentRef} version={state.applied.at(-1) ?? 0} />
            <div
              ref={contentRef}
              className="relative z-[1] grid h-full grid-cols-[minmax(0,1fr)_27.5cqw] grid-rows-[auto_auto_minmax(0,1fr)_auto_auto] px-[2.1cqw] pt-[1.5cqw] pb-[1.4cqw] @max-[860px]:flex @max-[860px]:flex-col @max-[860px]:px-4 @max-[860px]:py-[18px]"
            >
              <ConsoleHeader meta={planMeta(facts, seats)} stream={consoleKey ? stream : "missing"} paused={paused} showPause={!reduced} onTogglePause={togglePause}>
                {ops ? <ThemeSwitch theme={theme} /> : null}
              </ConsoleHeader>
              <StatusLine status={status} />
              <GateTitle n={seats} />
              <Lanes lanes={lanes} share={share} shortlist={state.shortlist} ledger={state.ledger} />
              <Gate money={money} counters={state.counters} />
              <XrayPanel contexts={contexts} lanes={laneMap} shortlist={state.shortlist} share={share} />
              <div className="col-span-full row-start-5 grid grid-cols-2 gap-x-[2.4cqw] border-t border-(--c-rule) pt-[1.1cqw] @max-[860px]:order-6 @max-[860px]:grid-cols-1 @max-[860px]:gap-[18px] @max-[860px]:pt-4">
                <TapPanel signed={state.tapSigned} verify={state.tapVerify} onTapTest={onTapTest} />
                <CreaoLane runs={runs} progress={state.progress} concierge={concierge} n={lanes.length} />
              </div>
            </div>
          </div>
          {ops ? (
            <>
              <ConsoleFooter deliveries={state.deliveries} system={state.system} invalid={invalidCount} />
              <div className="px-[2.1cqw] pb-4">{children}</div>
            </>
          ) : null}
        </div>
      </main>
    </ConsoleMotion>
  );
}
