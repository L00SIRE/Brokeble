// POST /ops/sweep, called by the agent's due_job every 30 s. Every action is a conditional UPDATE, so overlapping sweeps are safe.
// Each step, and each share or order inside a step, is isolated: one bad row or one failed query never blocks the others
// (above all (g) outbox redelivery, the only path for a venue→agent hook whose first delivery failed).
import { sql } from "../db";
import { cybsService, timeoutReversalDone } from "../cybs";
import { deliver, enqueue } from "../outbox";
import { runOp } from "../payments";
import { cancelOrder, finishCancel, MAX_REJECTED_REVERSALS, reverseShare } from "../orders/cancel";
import { payUrl, rotateToken, type OrderRow, type ShareRow } from "../orders/store";

export type SweepResult = {
  ok: boolean;
  timeout_reversed: number;
  expired_cancelled: number;
  outbox_delivered: number;
  nonces_purged: number;
  needs_attention: number;
  /** Step names that threw (each also logged with its error code). Empty when ok. */
  failed: string[];
  /** First error code per failed step (errCode: SQLSTATE / errno / error name, never a message), so the agent log can
   * tell a connection-level failure (e.g. CONNECT_TIMEOUT, ECONNREFUSED, XX000 from the pooler) from a query bug. */
  codes: Record<string, string>;
};

/** Error code only (a Postgres SQLSTATE, a Node errno or the error name): never a message, which could carry values. */
export const errCode = (e: unknown): string => {
  const c = (e as { code?: unknown } | null)?.code;
  return typeof c === "string" || typeof c === "number" ? String(c) : e instanceof Error ? e.name : "unknown";
};

export async function sweep(): Promise<SweepResult> {
  const out = { timeout_reversed: 0, expired_cancelled: 0, outbox_delivered: 0, nonces_purged: 0, needs_attention: 0 };
  const failed: string[] = [];
  const codes: Record<string, string> = {};
  const note = (name: string, e: unknown) => {
    const code = errCode(e);
    if (!failed.includes(name)) {
      failed.push(name);
      codes[name] = code;
    }
    console.error("venue sweep step failed", name, code);
  };
  const step = async (name: string, f: () => Promise<void>) => {
    try {
      await f();
    } catch (e) {
      note(name, e);
    }
  };
  /** Runs f for each row; a throw on one row is noted and the loop continues. */
  const each = async <R>(name: string, rows: readonly R[], f: (r: R) => Promise<void>) => {
    for (const r of rows) {
      try {
        await f(r);
      } catch (e) {
        note(name, e);
      }
    }
  };

  // (g) outbox redelivery, first: it must run even when a later step is broken
  await step("g_outbox", async () => {
    const pending = await sql()<{ id: string }[]>`select id::text from venue.outbox where delivered_at is null and attempts < 20 order by id limit 50`;
    out.outbox_delivered = await deliver(pending.map((r) => Number(r.id)));
  });

  // (a) AUTHORIZING whose function died → AUTH_UNKNOWN; TIMEOUT_REVERSING that died → AUTH_UNKNOWN again
  await step("a_stale", async () => {
    await sql()`update venue.shares set status = 'AUTH_UNKNOWN', updated_at = now() where status = 'AUTHORIZING' and updated_at < now() - interval '90 seconds'`;
    await sql()`update venue.shares set status = 'AUTH_UNKNOWN', updated_at = now() where status = 'TIMEOUT_REVERSING' and updated_at < now() - interval '120 seconds'`;
  });

  // (b) AUTH_UNKNOWN > 60 s → timeout reversal by the original auth transactionId (never a blind retry of the auth)
  await step("b_timeout_reverse", async () => {
    const unknown = await sql()<{ id: string }[]>`
      select s.id from venue.shares s where s.status = 'AUTH_UNKNOWN' and s.updated_at < now() - interval '60 seconds'
        and (select count(*) from venue.payment_ops p where p.share_id = s.id and p.op = 'timeout_reverse') < 5`;
    await each("b_timeout_reverse", unknown, async ({ id }) => {
      const [s] = await sql()<ShareRow[]>`
        update venue.shares set status = 'TIMEOUT_REVERSING', updated_at = now()
        where id = ${id} and status = 'AUTH_UNKNOWN' and updated_at < now() - interval '60 seconds' returning *`;
      if (!s) return;
      const [auth] = await sql()<{ transaction_id: string }[]>`
        select transaction_id from venue.payment_ops where share_id = ${s.id} and op = 'auth' order by attempt desc limit 1`;
      if (!auth) {
        await sql()`update venue.shares set status = 'AUTH_UNKNOWN', updated_at = now() where id = ${s.id}`;
        return;
      }
      const { outcome } = await runOp(s.id, "timeout_reverse", ({ code }) =>
        cybsService().timeoutReverse(code, auth.transaction_id, s.amount_cents, "auth outcome unknown"),
      );
      const released = timeoutReversalDone(outcome); // a 401/403/404/429 or 5xx must never release a share that may still hold funds
      if (!released) {
        await sql()`update venue.shares set status = 'AUTH_UNKNOWN', updated_at = now() where id = ${s.id}`;
        return;
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
    });
  });

  // (c) OPEN orders past their deadline → cancel (reverse all)
  await step("c_deadline", async () => {
    const late = await sql()<{ id: string }[]>`select id from venue.orders where status = 'OPEN' and deadline_at < now()`;
    await each("c_deadline", late, async ({ id }) => {
      await cancelOrder(id, "deadline_passed");
      out.expired_cancelled++;
    });
  });

  // (d) CANCELLING orders → finish
  await step("d_cancelling", async () => {
    const cancelling = await sql()<{ id: string }[]>`select id from venue.orders where status = 'CANCELLING'`;
    await each("d_cancelling", cancelling, ({ id }) => finishCancel(id, "cancelled"));
  });

  // (e) stuck reversals (reverseShare itself refuses a share whose reversal was rejected MAX_REJECTED_REVERSALS times)
  await step("e_stuck_reversals", async () => {
    const stuck = await sql()<{ id: string }[]>`
      select s.id from venue.shares s where s.status = 'REVERSING' and s.updated_at < now() - interval '60 seconds'
        and (select count(*) from venue.payment_ops p where p.share_id = s.id and p.op = 'reverse' and p.status = 'rejected') < ${MAX_REJECTED_REVERSALS}`;
    await each("e_stuck_reversals", stuck, async ({ id }) => {
      await reverseShare(id);
    });
  });

  // (e2) a reversal Cybersource keeps rejecting is permanent: stop retrying, never claim "released", and surface it to the
  // operator (order → NEEDS_ATTENTION; the agent turns order.needs_attention into a system:error, no DMs)
  await step("e2_reversal_cap", async () => {
    const capped = await sql()<{ id: string; order_id: string }[]>`
      select s.id, s.order_id from venue.shares s join venue.orders o on o.id = s.order_id
      where s.status = 'REVERSING' and o.status = 'CANCELLING'
        and (select count(*) from venue.payment_ops p where p.share_id = s.id and p.op = 'reverse' and p.status = 'rejected') >= ${MAX_REJECTED_REVERSALS}`;
    const byOrder = new Map<string, string[]>();
    for (const c of capped) byOrder.set(c.order_id, [...(byOrder.get(c.order_id) ?? []), c.id]);
    await each("e2_reversal_cap", [...byOrder], async ([orderId, shareIds]) => {
      const ids: number[] = [];
      await sql().begin(async (tx) => {
        const [o] = await tx<OrderRow[]>`
          update venue.orders set status = 'NEEDS_ATTENTION', updated_at = now() where id = ${orderId} and status = 'CANCELLING' returning *`;
        if (o) ids.push(await enqueue(tx as never, { order: o, type: "order.needs_attention", data: { share_ids: shareIds } }));
      });
      if (ids.length) out.needs_attention++;
      await deliver(ids);
    });
  });

  // (f) COMMITTING too long → needs attention
  await step("f_committing", async () => {
    const committing = await sql()<OrderRow[]>`
      update venue.orders set status = 'NEEDS_ATTENTION', updated_at = now()
      where status = 'COMMITTING' and updated_at < now() - interval '2 minutes' returning *`;
    await each("f_committing", committing, async (o) => {
      const left = await sql()<{ id: string }[]>`select id from venue.shares where order_id = ${o.id} and status <> 'CAPTURED'`;
      const evId = await enqueue(sql(), { order: o, type: "order.needs_attention", data: { share_ids: left.map((s) => s.id) } });
      out.needs_attention++;
      await deliver([evId]);
    });
  });

  // (h) nonce purge
  await step("h_nonces", async () => {
    const purged = await sql()`delete from venue.tap_nonces where seen_at < now() - interval '8 min' returning nonce`;
    out.nonces_purged = purged.length;
  });

  return { ok: failed.length === 0, ...out, failed, codes };
}
