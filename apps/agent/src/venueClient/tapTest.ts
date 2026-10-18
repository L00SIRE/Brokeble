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
  // Every kind is non-committing by construction: wrong_tag/expired/tamper fail TAP verification, and replay signs a forged
  // consent set (see venueClient forgeConsent) that the business check always refuses. Safe in every order state.
  return { ...(await venue.commit(orderId, testConsent(order), kind)), expected_step: EXPECT[kind] };
}
