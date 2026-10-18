import { consentFromOrder } from "@tab/shared/tap";
import type { CommitResult } from "@tab/shared";
import type { TapTestKind, VenuePort } from "../ports/types";

const EXPECT: Record<TapTestKind, number> = { wrong_tag: 1, expired: 3, replay: 4, tamper: 6 };

/** Negative TAP modes for the console panel. Expected rejection step: wrong_tag 1, expired 3, replay 4, tamper 6. */
export async function runTapTest(kind: TapTestKind, orderId: string, venue: VenuePort): Promise<CommitResult & { expected_step: number }> {
  const order = await venue.getOrder(orderId);
  // A replay's first leg would capture a fully held OPEN order, so refuse that state (other states make leg one a no-op).
  if (kind === "replay" && order.status === "OPEN" && order.shares.length > 0 && order.shares.every((s) => s.status === "AUTHORIZED")) {
    throw new Error("replay test refused: the first request would capture this order");
  }
  const consent = consentFromOrder(order);
  return { ...(await venue.commit(orderId, consent, kind)), expected_step: EXPECT[kind] };
}
