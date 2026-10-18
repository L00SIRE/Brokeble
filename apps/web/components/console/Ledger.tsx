import type { LaneView, LedgerRow } from "@/lib/consoleReducer";
import { MONO } from "./Panel";

/**
 * The Cybersource id for a lane, newest source first: the lane event, then the ledger row. The agent already labels a
 * simulated id "SIM …" and a sandbox id "sandbox …" (venueClient/ledger.ts), so a fake id never passes for a real one.
 */
export const ledgerIdFor = (lane: LaneView, ledger: Record<number, LedgerRow>): string | null => lane.cybs_id_short ?? ledger[lane.lane]?.cybs_id_short ?? null;

/** The ledger id as a lane caption (design-system §12.4 task 9): proof the hold is a real authorization. */
export function LedgerId({ id }: { id: string | null }) {
  if (!id) return null;
  return (
    <span translate="no" className={`${MONO} text-[max(12px,.95cqw)] leading-none whitespace-nowrap text-(--c-3) @max-[860px]:hidden`}>
      <span className="sr-only">Cybersource id </span>
      {id}
    </span>
  );
}
