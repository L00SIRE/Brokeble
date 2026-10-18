// POST /ops/sweep, called by the agent's due_job every 30 s. Every action is a conditional UPDATE, so overlapping sweeps are safe.
import { sql } from "../db";
import { cybsService } from "../cybs";
import { deliver, enqueue } from "../outbox";
import { runOp } from "../payments";
import { cancelOrder, finishCancel, reverseShare } from "../orders/cancel";
import { payUrl, rotateToken, type OrderRow, type ShareRow } from "../orders/store";

export async function sweep() {
  const out = { ok: true, timeout_reversed: 0, expired_cancelled: 0, outbox_delivered: 0, nonces_purged: 0 };

  // (a) AUTHORIZING whose function died → AUTH_UNKNOWN; TIMEOUT_REVERSING that died → AUTH_UNKNOWN again
  await sql()`update venue.shares set status = 'AUTH_UNKNOWN', updated_at = now() where status = 'AUTHORIZING' and updated_at < now() - interval '90 seconds'`;
  await sql()`update venue.shares set status = 'AUTH_UNKNOWN', updated_at = now() where status = 'TIMEOUT_REVERSING' and updated_at < now() - interval '120 seconds'`;

  // (b) AUTH_UNKNOWN > 60 s → timeout reversal by the original auth transactionId (never a blind retry of the auth)
  const unknown = await sql()<{ id: string }[]>`select id from venue.shares where status = 'AUTH_UNKNOWN' and updated_at < now() - interval '60 seconds'`;
  for (const { id } of unknown) {
    const [s] = await sql()<ShareRow[]>`
      update venue.shares set status = 'TIMEOUT_REVERSING', updated_at = now()
      where id = ${id} and status = 'AUTH_UNKNOWN' and updated_at < now() - interval '60 seconds' returning *`;
    if (!s) continue;
    const [auth] = await sql()<{ transaction_id: string }[]>`
      select transaction_id from venue.payment_ops where share_id = ${s.id} and op = 'auth' order by attempt desc limit 1`;
    if (!auth) {
      await sql()`update venue.shares set status = 'AUTH_UNKNOWN', updated_at = now() where id = ${s.id}`;
      continue;
    }
    const { outcome } = await runOp(s.id, "timeout_reverse", ({ code }) =>
      cybsService().timeoutReverse(code, auth.transaction_id, s.amount_cents, "auth outcome unknown"),
    );
    const released = outcome.kind === "ok" || outcome.kind === "rejected"; // 4xx meaning per S5 (PLAN §19) must be confirmed
    if (!released) {
      await sql()`update venue.shares set status = 'AUTH_UNKNOWN', updated_at = now() where id = ${s.id}`;
      continue;
    }
    out.timeout_reversed++;
    const ids: number[] = [];
    await sql().begin(async (tx) => {
      const [o] = await tx<OrderRow[]>`select * from venue.orders where id = ${s.order_id} for update`;
      await tx`update venue.shares set status = 'RELEASED', updated_at = now() where id = ${s.id}`;
      if (o!.status === "OPEN") {
        const r = await rotateToken(tx as never, s.id, o!.deadline_at);
        ids.push(await enqueue(tx as never, { order: o!, share: { id: s.id, payer_ref: s.payer_ref }, type: "share.released", data: { retry: true, pay_url: payUrl(r.token), expires_at: r.expires_at } }));
      } else {
        ids.push(await enqueue(tx as never, { order: o!, share: { id: s.id, payer_ref: s.payer_ref }, type: "share.released", data: { retry: false } }));
      }
    });
    await deliver(ids);
    await finishCancel(s.order_id, "cancelled");
  }

  // (c) OPEN orders past their deadline → cancel (reverse all)
  const late = await sql()<{ id: string }[]>`select id from venue.orders where status = 'OPEN' and deadline_at < now()`;
  for (const { id } of late) {
    await cancelOrder(id, "deadline_passed");
    out.expired_cancelled++;
  }

  // (d) CANCELLING orders → finish
  const cancelling = await sql()<{ id: string }[]>`select id from venue.orders where status = 'CANCELLING'`;
  for (const { id } of cancelling) await finishCancel(id, "cancelled");

  // (e) stuck reversals
  const stuck = await sql()<{ id: string }[]>`select id from venue.shares where status = 'REVERSING' and updated_at < now() - interval '60 seconds'`;
  for (const { id } of stuck) await reverseShare(id);

  // (f) COMMITTING too long → needs attention
  const committing = await sql()<OrderRow[]>`
    update venue.orders set status = 'NEEDS_ATTENTION', updated_at = now()
    where status = 'COMMITTING' and updated_at < now() - interval '2 minutes' returning *`;
  for (const o of committing) {
    const left = await sql()<{ id: string }[]>`select id from venue.shares where order_id = ${o.id} and status <> 'CAPTURED'`;
    const evId = await enqueue(sql(), { order: o, type: "order.needs_attention", data: { share_ids: left.map((s) => s.id) } });
    await deliver([evId]);
  }

  // (g) outbox redelivery
  const pending = await sql()<{ id: string }[]>`select id::text from venue.outbox where delivered_at is null and attempts < 20 order by id limit 50`;
  out.outbox_delivered = await deliver(pending.map((r) => Number(r.id)));

  // (h) nonce purge
  const purged = await sql()`delete from venue.tap_nonces where seen_at < now() - interval '8 min' returning nonce`;
  out.nonces_purged = purged.length;
  return out;
}
