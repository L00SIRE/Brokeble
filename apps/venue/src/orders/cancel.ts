import type { OrderStatus } from "@tab/shared";
import { sql } from "../db";
import { cybsService, reversalDone } from "../cybs";
import { deliver, enqueue } from "../outbox";
import { runOp } from "../payments";
import { rotateToken, loadOrderView, type OrderRow, type ShareRow } from "./store";

/**
 * After this many rejected (4xx, not "already reversed") reversals a share stops being retried: the rejection is
 * permanent, so the sweep moves its order to NEEDS_ATTENTION instead of calling Cybersource every 30 s forever.
 */
export const MAX_REJECTED_REVERSALS = 5;

/**
 * Reverse one hold. Claims the share first (conditional UPDATE) so overlapping callers never double-reverse.
 * Only AUTHORIZED, stale REVERSING (under the rejection cap) or, with authorizingPaymentId, AUTHORIZING shares are
 * claimed, never CAPTURING/CAPTURED: Cybersource answers MISSING_AUTH for an already-captured auth too, which
 * reversalDone() reads as "no hold remains".
 */
export async function reverseShare(
  shareId: string,
  o?: { authorizingPaymentId?: string; retryLink?: boolean },
): Promise<"RELEASED" | "pending"> {
  const [s] = o?.authorizingPaymentId
    ? await sql()<ShareRow[]>`
        update venue.shares set status = 'REVERSING', cybs_payment_id = ${o.authorizingPaymentId}, updated_at = now()
        where id = ${shareId} and status = 'AUTHORIZING' returning *`
    : await sql()<ShareRow[]>`
        update venue.shares set status = 'REVERSING', updated_at = now()
        where id = ${shareId} and (status = 'AUTHORIZED' or (status = 'REVERSING' and updated_at < now() - interval '60 seconds'))
          and (select count(*) from venue.payment_ops p
               where p.share_id = ${shareId} and p.op = 'reverse' and p.status = 'rejected') < ${MAX_REJECTED_REVERSALS}
        returning *`;
  if (!s || !s.cybs_payment_id) return "pending";
  const paymentId = s.cybs_payment_id;
  const { outcome } = await runOp(s.id, "reverse", ({ code }) =>
    cybsService().reverse(paymentId, code, s.amount_cents, "order cancelled"),
  );
  if (!reversalDone(outcome)) {
    await sql()`update venue.shares set updated_at = now() where id = ${s.id} and status = 'REVERSING'`;
    return "pending"; // stays REVERSING; the sweep retries
  }
  const ids: number[] = [];
  await sql().begin(async (tx) => {
    const [r] = await tx`update venue.shares set status = 'RELEASED', updated_at = now() where id = ${s.id} and status = 'REVERSING' returning id`;
    if (!r) return;
    const [ord] = await tx<OrderRow[]>`select * from venue.orders where id = ${s.order_id}`;
    ids.push(await enqueue(tx as never, { order: ord!, share: { id: s.id, payer_ref: s.payer_ref }, type: "share.released", data: { retry: false } }));
  });
  await deliver(ids);
  return "RELEASED";
}

/** Voids unpaid shares, reverses held ones, and closes the order once every share is terminal. Idempotent. */
export async function finishCancel(orderId: string, reason: string): Promise<void> {
  const [o0] = await sql()<OrderRow[]>`select * from venue.orders where id = ${orderId}`;
  if (!o0 || (o0.status !== "CANCELLING" && o0.status !== "CANCELLED")) return;
  await sql()`
    update venue.shares set status = 'VOID', updated_at = now()
    where order_id = ${orderId} and status in ('PENDING','DECLINED')`;
  const held = await sql()<{ id: string }[]>`
    select id from venue.shares where order_id = ${orderId} and (status = 'AUTHORIZED' or (status = 'REVERSING' and updated_at < now() - interval '60 seconds'))`;
  for (const s of held) await reverseShare(s.id);
  const ids: number[] = [];
  await sql().begin(async (tx) => {
    const [open] = await tx`
      select 1 as x from venue.shares where order_id = ${orderId} and status not in ('VOID','RELEASED','DECLINED') limit 1`;
    if (open) return;
    const [r] = await tx<OrderRow[]>`
      update venue.orders set status = 'CANCELLED', updated_at = now() where id = ${orderId} and status = 'CANCELLING' returning *`;
    if (r) ids.push(await enqueue(tx as never, { order: r, type: "order.cancelled", data: { reason } }));
  });
  await deliver(ids);
}

/** OPEN → CANCELLING (only one caller wins), then finish. Others get the current status. */
export async function cancelOrder(orderId: string, reason: string): Promise<OrderStatus | null> {
  const won = await sql()`
    update venue.orders set status = 'CANCELLING', updated_at = now() where id = ${orderId} and status = 'OPEN' returning id`;
  if (won.length) await finishCancel(orderId, reason);
  return loadOrderView(sql(), orderId);
}

/** A cancelled order's share gets a fresh single-use link only while the order is still OPEN. */
export async function reissueLink(shareId: string, orderId: string) {
  const [o] = await sql()<OrderRow[]>`select * from venue.orders where id = ${orderId}`;
  if (!o || o.status !== "OPEN") return null;
  return rotateToken(sql(), shareId, o.deadline_at);
}
