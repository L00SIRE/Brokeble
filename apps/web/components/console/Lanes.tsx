import type { LaneStage } from "@tab/shared";
import { usd } from "@/lib/format";
import type { ConsoleState, LaneView } from "@/lib/consoleReducer";
import { Panel, Waiting } from "./Panel";

// The journey a person walks. GATED and LINK_SENT sit between Voted and Held (the hold gate / pay link), so they
// light the Voted segment and show their own name in the badge.
const SEGMENTS = ["Invited", "Joined", "Locked", "Voted", "Held", "Captured"] as const;
const SEGMENT_OF: Record<LaneStage, number> = {
  INVITED: 0,
  JOINED: 1,
  BUDGET_LOCKED: 2,
  PREFS_DONE: 2,
  VOTED: 3,
  GATED: 3,
  LINK_SENT: 3,
  HELD: 4,
  CAPTURED: 5,
  RELEASED: -1,
  DECLINED: -1,
};

const badgeTone = (stage: LaneStage): string =>
  stage === "CAPTURED" ? "bg-ok/15 text-ok" : stage === "HELD" ? "bg-accent/15 text-accent" : stage === "DECLINED" ? "bg-danger/15 text-danger" : stage === "RELEASED" ? "bg-warn/15 text-warn" : "bg-surface-2 text-muted";

function Lane({ lane }: { lane: LaneView }) {
  const at = SEGMENT_OF[lane.stage];
  const ended = at < 0;
  // The budget is a secret only the person's delegate sees; the lock appears once it is saved.
  const locked = at >= 2 || lane.stage === "RELEASED";
  return (
    <li className="grid gap-2 rounded-lg bg-surface-2 px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <span className="truncate text-(length:--text-console-key) font-semibold">{lane.first_name}</span>
        <span className="flex items-center gap-3">
          {locked ? (
            <span role="img" aria-label="Budget kept private" title="Budget kept private" className="text-lock">
              🔒
            </span>
          ) : null}
          <span className={`rounded-md px-3 py-0.5 font-mono text-(length:--text-console-label) ${badgeTone(lane.stage)}`}>{lane.stage}</span>
        </span>
      </div>
      <ol aria-label={`${lane.first_name} progress`} className="grid grid-cols-6 gap-1.5">
        {SEGMENTS.map((label, i) => (
          <li key={label} className="grid gap-1">
            <span className={`h-2 rounded-full ${ended ? "bg-border" : i < at ? "bg-ok" : i === at ? (lane.stage === "CAPTURED" ? "bg-ok" : "bg-accent") : "bg-border"}`} />
            <span className={`text-center text-(length:--text-console-label) leading-none ${!ended && i === at ? "text-fg" : "text-muted"}`}>{label}</span>
          </li>
        ))}
      </ol>
      {lane.amount_cents !== null || lane.cybs_id_short ? (
        <p className="flex items-baseline justify-between font-mono text-(length:--text-console-label)">
          <span className="text-(length:--text-console-body) font-semibold">{lane.amount_cents !== null ? usd(lane.amount_cents) : ""}</span>
          <span className="text-muted">{lane.cybs_id_short ?? ""}</span>
        </p>
      ) : null}
    </li>
  );
}

/** People: one lane per participant. Never renders a budget; only the share amount (public) and the Cybersource id. */
export function LanesPanel({ lanes, tally }: { lanes: readonly LaneView[]; tally: ConsoleState["tally"] }) {
  const ordered = [...lanes].sort((a, b) => a.lane - b.lane);
  return (
    <Panel title="People">
      {ordered.length === 0 ? (
        <Waiting>Waiting for people to join</Waiting>
      ) : (
        <div className="flex h-full flex-col gap-3">
          {tally ? (
            <p className="text-(length:--text-console-body) text-muted">
              <span className="text-(length:--text-console-key) font-semibold text-fg">
                {tally.voted}/{tally.total}
              </span>{" "}
              voted
            </p>
          ) : null}
          <ul className="grid min-h-0 flex-1 content-start gap-3 overflow-y-auto">
            {ordered.map((lane) => (
              <Lane key={lane.lane} lane={lane} />
            ))}
          </ul>
        </div>
      )}
    </Panel>
  );
}
