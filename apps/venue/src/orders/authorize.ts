import { z } from "zod";
import { sql } from "../db";
import { cardFromAuth, classifyAuth, cybsService, cybsSource, reversalDone, type CybsOutcome, type AuthResp } from "../cybs";
import { isSandboxHost } from "../cybs/config";
import { env } from "../env";
import { hashToken } from "../token";
import { deliver, enqueue } from "../outbox";
import { runOp } from "../payments";
import { payUrl, rotateToken, type OrderRow, type ShareRow } from "./store";
import { finishCancel, reverseShare } from "./cancel";

export const AuthorizeBody = z.strictObject({
  transientTokenJwt: z.string().min(1).max(8000).optional(),
  save_card: z.boolean().default(false),
  sandbox_test_card: z.boolean().default(false),
  bill_to: z.strictObject({
    first_name: z.string().min(1).max(60),
    last_name: z.string().max(60).default(""),
    postal_code: z.string().min(3).max(10),
    email: z.email().optional(),
  }),
});
export type AuthorizeBody = z.infer<typeof AuthorizeBody>;

export type PayState =
  | { state: "ready"; amount_cents: number; saved: { brand: string | null; last4: string | null } | null }
  | { state: "held"; amount_cents: number; card: { brand: string | null; last4: string | null } | null }
  | { state: "declined"; retry_url: string }
  | { state: "booked"; amount_cents: number }
  | { state: "already_held"; amount_cents: number }
  | { state: "cancelled" }
  | { state: "expired" }
  | { state: "unconfirmed" };

/** Pure: which of the 7 states a bearer link is in. GET never consumes the token. */
export function pageState(share: ShareRow | undefined, order: OrderRow | undefined, now: Date): PayState["state"] {
  if (!share || !order) return "expired";
  if (order.status === "CANCELLING" || order.status === "CANCELLED" || share.status === "VOID" || share.status === "RELEASED") return "cancelled";
  if (share.status === "CAPTURED") return "booked";
  if (share.status === "AUTHORIZED" || share.status === "CAPTURING") return "already_held";
  if (["AUTHORIZING", "AUTH_UNKNOWN", "TIMEOUT_REVERSING", "REVERSING"].includes(share.status)) return "unconfirmed";
  if (share.status === "PENDING" && !share.token_used_at && share.token_expires_at > now && order.status === "OPEN" && order.deadline_at > now) return "ready";
  return "expired";
}

export async function loadByToken(token: string) {
  const hash = hashToken(token);
  const [share] = await sql()<ShareRow[]>`select * from venue.shares where token_hash = ${hash}`;
  if (!share) return { share: undefined, order: undefined };
  const [order] = await sql()<OrderRow[]>`select * from venue.orders where id = ${share.order_id}`;
  return { share, order };
}

export async function savedCard(payerRef: string) {
  const [c] = await sql()<{ cybs_customer_id: string; card_brand: string | null; card_last4: string | null }[]>`
    select cybs_customer_id, card_brand, card_last4 from venue.customers where payer_ref = ${payerRef}`;
  return c ?? null;
}

/** POST /api/pay/[token]/authorize: consume the token atomically, authorize once, classify, never blind-retry. */
export async function authorize(token: string, body: AuthorizeBody): Promise<PayState | { error: string; status: number }> {
  const { share: pre } = await loadByToken(token);
  if (!pre) return { state: "expired" };
  const customer = await savedCard(pre.payer_ref);
  const live = env().CYBS_MODE === "live";
  const usable = !!body.transientTokenJwt || !!customer || body.sandbox_test_card || !live;
  if (!usable) return { error: "card_required", status: 400 };
  if (body.sandbox_test_card && !isSandboxHost(env().CYBS_RUN_ENV)) return { error: "not_allowed", status: 400 };

  // Consume the token atomically; every precondition rides on the same statement.
  const hash = hashToken(token);
  const [s] = await sql()<(ShareRow & { deadline_at: Date })[]>`
    update venue.shares s set token_used_at = now(), status = 'AUTHORIZING', updated_at = now()
    from venue.orders o
    where s.order_id = o.id and s.token_hash = ${hash} and s.token_used_at is null
      and s.token_expires_at > now() and s.status = 'PENDING' and o.status = 'OPEN' and o.deadline_at > now()
    returning s.*, o.deadline_at`;
  if (!s) {
    const cur = await loadByToken(token);
    return { state: pageState(cur.share, cur.order, new Date()) } as PayState;
  }
  const [order] = await sql()<OrderRow[]>`select * from venue.orders where id = ${s.order_id}`;
  const ord = order!;
  const pending: number[] = [];
  pending.push(await enqueue(sql(), { order: ord, share: { id: s.id, payer_ref: s.payer_ref }, type: "share.authorizing" }));
  void deliver(pending);

  const oneTap = !body.transientTokenJwt && !!customer && !body.sandbox_test_card;
  let outcome: CybsOutcome<AuthResp>;
  let transactionId: string;
  try {
    const r = await runOp(s.id, "auth", (ids) =>
      cybsService().authorize({
        code: ids.code, transactionId: ids.transactionId, amountCents: s.amount_cents,
        billTo: { first_name: body.bill_to.first_name, last_name: body.bill_to.last_name || body.bill_to.first_name, postal_code: body.bill_to.postal_code, email: body.bill_to.email },
        transientTokenJwt: body.transientTokenJwt, saveCard: body.save_card, customerId: customer?.cybs_customer_id,
        sandboxTestCard: body.sandbox_test_card,
      }),
    );
    outcome = r.outcome;
    transactionId = r.transactionId;
  } catch {
    outcome = { kind: "unknown", http: null, code: "LOCAL_ERROR" }; // never blind-retry; the sweep reverses by transactionId
    transactionId = "";
  }
  void transactionId;

  const cls = classifyAuth(outcome);
  const data = outcome.kind === "ok" ? outcome.data : undefined;

  if (cls.next === "AUTH_UNKNOWN") return unconfirmed(ord, s);

  if (cls.next === "DECLINED") {
    if (cls.reverse && data?.id) {
      // funds may be held: reverse before calling this a decline
      const r = await runOp(s.id, "reverse", ({ code }) => cybsService().reverse(data.id!, code, s.amount_cents, "auth not clean"));
      if (!reversalDone(r.outcome)) return unconfirmed(ord, s);
    }
    return declined(ord, s);
  }

  // AUTHORIZED: re-check the order under its row lock (also serializes with checkout and cancel).
  const card = cardFromAuth(data!, body.transientTokenJwt);
  const brand = card.brand ?? customer?.card_brand ?? null;
  const last4 = card.last4 ?? customer?.card_last4 ?? (body.sandbox_test_card ? "1111" : null); // the sandbox test card PAN is fixed
  const ids: number[] = [];
  const outcomeState = await sql().begin(async (tx) => {
    const [o] = await tx<OrderRow[]>`select * from venue.orders where id = ${s.order_id} for update`;
    if (o!.status !== "OPEN") return "late" as const;
    await tx`
      update venue.shares set status = 'AUTHORIZED', cybs_payment_id = ${data!.id!}, card_brand = ${brand}, card_last4 = ${last4}, updated_at = now()
      where id = ${s.id}`;
    const t = data!.tokenInformation;
    if (body.save_card && !oneTap && t?.customer?.id) {
      await tx`
        insert into venue.customers (payer_ref, cybs_customer_id, cybs_payment_instrument_id, card_brand, card_last4)
        values (${s.payer_ref}, ${t.customer.id}, ${t.paymentInstrument?.id ?? null}, ${brand}, ${last4})
        on conflict (payer_ref) do update set cybs_customer_id = excluded.cybs_customer_id,
          cybs_payment_instrument_id = excluded.cybs_payment_instrument_id, card_brand = excluded.card_brand, card_last4 = excluded.card_last4`;
    }
    ids.push(await enqueue(tx as never, {
      order: o!, share: { id: s.id, payer_ref: s.payer_ref }, type: "share.authorized",
      data: { amount_cents: s.amount_cents, card_brand: brand, card_last4: last4, cybs_payment_id_short: data!.id!.slice(-8), cybs_source: cybsSource().id },
    }));
    return "held" as const;
  });
  await deliver(ids);
  if (outcomeState === "late") {
    await reverseShare(s.id, { authorizingPaymentId: data!.id! }); // order closed while we were authorizing
    await finishCancel(s.order_id, "cancelled");
    return { state: "cancelled" };
  }
  return { state: "held", amount_cents: s.amount_cents, card: { brand, last4 } };
}

async function declined(ord: OrderRow, s: ShareRow): Promise<PayState> {
  const ids: number[] = [];
  let url: string | null = null;
  await sql().begin(async (tx) => {
    const [o] = await tx<OrderRow[]>`select * from venue.orders where id = ${s.order_id} for update`;
    if (o!.status !== "OPEN") {
      await tx`update venue.shares set status = 'PENDING', updated_at = now() where id = ${s.id}`; // finishCancel voids it
      return;
    }
    const r = await rotateToken(tx as never, s.id, ord.deadline_at);
    url = payUrl(r.token);
    ids.push(await enqueue(tx as never, { order: o!, share: { id: s.id, payer_ref: s.payer_ref }, type: "share.declined", data: { pay_url: url, expires_at: r.expires_at } }));
  });
  await deliver(ids);
  if (!url) {
    await finishCancel(s.order_id, "cancelled");
    return { state: "cancelled" };
  }
  return { state: "declined", retry_url: url };
}

async function unconfirmed(ord: OrderRow, s: ShareRow): Promise<PayState> {
  const ids: number[] = [];
  await sql().begin(async (tx) => {
    await tx`update venue.shares set status = 'AUTH_UNKNOWN', updated_at = now() where id = ${s.id} and status = 'AUTHORIZING'`;
    ids.push(await enqueue(tx as never, { order: ord, share: { id: s.id, payer_ref: s.payer_ref }, type: "share.auth_unknown" }));
  });
  await deliver(ids);
  return { state: "unconfirmed" };
}
