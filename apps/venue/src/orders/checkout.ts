import type { CommitResult, TapVerifyReport } from "@tab/shared";
import { sql } from "../db";
import { cybsService, cybsSource } from "../cybs";
import { deliver, enqueue } from "../outbox";
import { runOp } from "../payments";
import { decideCommit, type CommitDecision } from "./commit";
import type { OrderRow, ShareRow } from "./store";

type Captures = CommitResult["captures"];

async function capturesFromDb(orderId: string): Promise<Captures> {
  const rows = await sql()<{ id: string; status: string; cap: string | null }[]>`
    select s.id, s.status,
      (select cybs_id from venue.payment_ops p where p.share_id = s.id and p.op = 'capture' and p.status = 'ok' order by attempt desc limit 1) as cap
    from venue.shares s where s.order_id = ${orderId} order by s.id`;
  return rows.map((r) => ({ share_id: r.id, status: r.status as never, cybs_capture_id: r.cap }));
}

/** Capture-all, only after a TAP-verified commit whose body equals the rebuilt consent set (M4/M5). */
export async function checkout(orderId: string, body: Buffer, tap: TapVerifyReport): Promise<{ status: number; result: CommitResult }> {
  let decision: CommitDecision | null = null;
  let shares: ShareRow[] = [];
  let order: OrderRow | undefined;
  const ids: number[] = [];
  await sql().begin(async (tx) => {
    [order] = await tx<OrderRow[]>`select * from venue.orders where id = ${orderId} for update`;
    if (!order) return;
    shares = await tx<ShareRow[]>`select * from venue.shares where order_id = ${orderId} order by id for update`;
    decision = decideCommit(
      { id: order.id, status: order.status, total_cents: order.total_cents },
      shares.map((s) => ({ id: s.id, status: s.status, amount_cents: s.amount_cents, cybs_payment_id: s.cybs_payment_id })),
      body,
    );
    if (decision.kind === "proceed") {
      await tx`update venue.orders set status = 'COMMITTING', updated_at = now() where id = ${orderId} and status = 'OPEN'`;
    }
  });
  const reject = async (status: number, d: CommitDecision | null, reason: string) => ({
    status,
    result: {
      order_id: orderId, result: "rejected" as const,
      tap: { ...tap, business: d?.business ?? null, accepted: false, reason },
      captures: [] as Captures,
    },
  });
  if (!order || !decision) return reject(404, null, "unknown order");
  const d = decision as CommitDecision;
  if (d.kind === "idempotent") {
    return { status: 200, result: { order_id: orderId, result: "captured", tap: { ...tap, business: d.business }, captures: await capturesFromDb(orderId) } };
  }
  if (d.kind === "not_open") return reject(409, d, `order is ${order.status}`);
  if (d.kind === "rejected") {
    const why = !d.business.all_authorized ? "not every share is authorized" : !d.business.sum_matches ? "shares do not sum to the total" : "consent set does not match the order";
    return reject(409, d, why);
  }

  // Captures run outside the transaction, sorted by share_id. Never retried.
  const sorted = [...shares].sort((a, b) => (a.id < b.id ? -1 : 1));
  let captured = 0;
  for (const s of sorted) {
    const claim = await sql()`update venue.shares set status = 'CAPTURING', updated_at = now() where id = ${s.id} and status = 'AUTHORIZED' returning id`;
    if (!claim.length) break;
    const { outcome } = await runOp(s.id, "capture", ({ code }) => cybsService().capture(s.cybs_payment_id!, code, s.amount_cents));
    if (outcome.kind !== "ok") break;
    const capId: string | null = (outcome.data as any)?.id ?? null;
    const evIds: number[] = [];
    await sql().begin(async (tx) => {
      await tx`update venue.shares set status = 'CAPTURED', updated_at = now() where id = ${s.id}`;
      evIds.push(await enqueue(tx as never, {
        order: order!, share: { id: s.id, payer_ref: s.payer_ref }, type: "share.captured",
        data: { amount_cents: s.amount_cents, cybs_capture_id_short: capId ? capId.slice(-8) : null, cybs_source: cybsSource().id },
      }));
    });
    await deliver(evIds);
    captured++;
  }

  if (captured === sorted.length) {
    await sql().begin(async (tx) => {
      await tx`update venue.orders set status = 'CAPTURED', updated_at = now() where id = ${orderId}`;
      ids.push(await enqueue(tx as never, { order: order!, type: "order.captured", data: { total_cents: order!.total_cents } }));
    });
    await deliver(ids);
    return { status: 200, result: { order_id: orderId, result: "captured", tap: { ...tap, business: d.business }, captures: await capturesFromDb(orderId) } };
  }

  const left = sorted.slice(captured).map((s) => s.id);
  await sql().begin(async (tx) => {
    await tx`update venue.orders set status = 'NEEDS_ATTENTION', updated_at = now() where id = ${orderId}`;
    ids.push(await enqueue(tx as never, { order: order!, type: "order.needs_attention", data: { share_ids: left } }));
  });
  await deliver(ids);
  return {
    status: 409,
    result: {
      order_id: orderId, result: captured > 0 ? "partial" : "rejected",
      tap: { ...tap, business: d.business, accepted: captured > 0, reason: "a capture did not complete; order needs attention" },
      captures: await capturesFromDb(orderId),
    },
  };
}
