"use client";

// Trust Console shell (B plan T9): snapshot on open, then SSE frames through the pure consoleReducer; each panel gets
// one slice. `children` is the optional ops bar slot (composed by the page, so no boolean mode prop).
import { useReducer, type ReactNode } from "react";
import { agent } from "@/lib/agent";
import { initialConsoleState, reduceConsole } from "@/lib/consoleReducer";
import { readOperatorKey } from "@/lib/operatorKey";
import { useConsoleStream } from "@/lib/useConsoleStream";
import { ConsoleFooter } from "./ConsoleFooter";
import { ConsoleHeader } from "./ConsoleHeader";
import { ShortlistPanel } from "./ConsoleShortlist";
import { CountersPanel } from "./Counters";
import { CreaoLane } from "./CreaoLane";
import { LanesPanel } from "./Lanes";
import { LedgerPanel } from "./Ledger";
import { TapPanel, type TapTestKind } from "./TapPanel";
import { XrayPanel } from "./Xray";

export function Console({ consoleKey, children }: { consoleKey: string | null; children?: ReactNode }) {
  const [state, dispatch] = useReducer(reduceConsole, initialConsoleState);
  const { status, invalidCount } = useConsoleStream(consoleKey, dispatch);
  const lanes = Object.values(state.lanes);
  // TAP failure-injection buttons appear only when the ops bar is mounted (?ops=1); they reuse its operator key.
  const onTapTest = children ? (kind: TapTestKind) => agent.ops("tap-test", readOperatorKey(), { kind }) : undefined;

  return (
    <main className="grid min-h-dvh gap-4 p-4 lg:h-dvh lg:min-h-[40rem] lg:grid-rows-[auto_1fr_auto_auto] lg:overflow-hidden lg:p-5 tabular-nums">
      <ConsoleHeader plan={state.plan} stream={consoleKey ? status : "missing"} invalid={invalidCount} />
      <div className="grid min-h-0 gap-4 lg:grid-cols-[1fr_1.25fr_1.1fr]">
        <LanesPanel lanes={lanes} tally={state.tally} />
        <div className="grid min-h-0 grid-rows-[auto_1fr] gap-4">
          <ShortlistPanel shortlist={state.shortlist} />
          <XrayPanel contexts={Object.values(state.xray)} />
        </div>
        <div className="grid min-h-0 grid-rows-[auto_1fr_auto] gap-4">
          <LedgerPanel rows={Object.values(state.ledger)} lanes={lanes} />
          <TapPanel signed={state.tapSigned} verify={state.tapVerify} onTapTest={onTapTest} />
          <CountersPanel counters={state.counters} />
        </div>
      </div>
      <CreaoLane runs={Object.values(state.creaoRuns)} progress={state.progress} />
      <ConsoleFooter deliveries={state.deliveries} system={state.system} />
      {children}
    </main>
  );
}
