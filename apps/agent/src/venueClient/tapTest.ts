import type { CommitResult, ConsentSet, OrderStatus } from "@tab/shared";
import type { TapTestKind, VenuePort } from "../ports/types";

const EXPECT: Record<TapTestKind, number> = { wrong_tag: 1, expired: 3, replay: 4, tamper: 6 };

/**
 * The consent body for a negative TAP test. Unlike consentFromOrder (the real commit path), it tolerates shares with no
 * payment id yet (APPROVING with someone unpaid, after a cancel or a timeout release): the venue rebuilds the same set
 * with `?? ""` and never captures an order that is not OPEN with every share AUTHORIZED, so the test only exercises TAP.
 */
export function testConsent(order: OrderStatus): ConsentSet {
  return {
    order_id: order.order_id,
    total_cents: order.total_cents,
    shares: order.shares.map((s) => ({ share_id: s.share_id, cybs_payment_id: s.cybs_payment_id ?? "", amount_cents: s.amount_cents })),
  };
}

/** Negative TAP modes for the console panel. Expected rejection step: wrong_tag 1, expired 3, replay 4, tamper 6. */
export async function runTapTest(kind: TapTestKind, orderId: string, venue: VenuePort): Promise<CommitResult & { expected_step: number }> {
  const order = await venue.getOrder(orderId);
  // A replay's first leg would capture a fully held OPEN order, so refuse that state (other states make leg one a no-op).
  if (kind === "replay" && order.status === "OPEN" && order.shares.length > 0 && order.shares.every((s) => s.status === "AUTHORIZED")) {
    throw new Error("replay test refused: the first request would capture this order");
  }
  return { ...(await venue.commit(orderId, testConsent(order), kind)), expected_step: EXPECT[kind] };
}
