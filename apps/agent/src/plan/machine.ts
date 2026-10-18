// Plan state machine (PLAN §7, M5). Every transition is one conditional UPDATE that bumps updated_at, emits
// `plan.state` in the same transaction, and returns a row only to the winner. Owner A.
import type { LaneStage } from "@tab/shared";
import { sql, type Tx } from "../db";
import { emit } from "../events";
import type { PlanState } from "../repo/types";

export type { PlanState } from "../repo/types";

/** Participant stage order for "≥" checks (A plan T3). RELEASED and DECLINED are terminal and rank below INVITED. */
export const STAGE_ORDER: readonly LaneStage[] = ["INVITED", "JOINED", "BUDGET_LOCKED", "PREFS_DONE", "VOTED", "GATED", "LINK_SENT", "HELD", "CAPTURED"];
export const TERMINAL_STAGES: readonly LaneStage[] = ["RELEASED", "DECLINED"];

/** True iff `stage` is in STAGE_ORDER at or after `min` (terminal stages are never ≥ anything). */
export function stageAtLeast(stage: LaneStage, min: LaneStage): boolean {
  const i = STAGE_ORDER.indexOf(stage);
  const m = STAGE_ORDER.indexOf(min);
  return i >= 0 && m >= 0 && i >= m;
}

export type Transition = { id: string; version: number; from_state: PlanState };

export type TransitionOptions = {
  /** Optimistic guard: only transition while the plan is at this version. */
  version?: number;
  bumpVersion?: boolean;
  /** Runs inside the winning transaction, after the UPDATE and the `plan.state` event; a throw rolls everything back. */
  inTx?: (tx: Tx, t: Transition) => Promise<void>;
};

/**
 * `with prev as (select … for update) update app.plans … where prev.state = any($froms) [and version=$version]`
 * inside sql.begin, then emit(plan.state {from: from_state, to, version}, tx). Null = lost the race: the caller does
 * nothing. SHOWCASE never transitions (B's live-Scout row), so naming it is a programming error.
 */
export async function transition(
  planId: string,
  from: PlanState | readonly PlanState[],
  to: PlanState,
  opts: TransitionOptions = {},
): Promise<Transition | null> {
  const froms: PlanState[] = typeof from === "string" ? [from] : [...from];
  if (to === "SHOWCASE" || froms.includes("SHOWCASE")) throw new Error("plan.transition: SHOWCASE never transitions");
  if (froms.length === 0) throw new Error("plan.transition: empty from-state list");
  return sql.begin(async (tx) => {
    const [r] = await tx<Transition[]>`
      with prev as (select id, state from app.plans where id = ${planId} for update)
      update app.plans p set state = ${to}, updated_at = now()
        ${opts.bumpVersion ? tx`, version = p.version + 1` : tx``}
      from prev
      where p.id = prev.id and prev.state = any(${tx.array(froms)})
        ${opts.version !== undefined ? tx`and p.version = ${opts.version}` : tx``}
      returning p.id::text as id, p.version, prev.state as from_state`;
    if (!r) return null;
    const t: Transition = { id: r.id, version: r.version, from_state: r.from_state };
    await emit({ type: "plan.state", plan_id: planId, from: t.from_state, to, version: t.version }, tx);
    if (opts.inTx) await opts.inTx(tx, t);
    return t;
  });
}
