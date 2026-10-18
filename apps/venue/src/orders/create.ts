import { CreateOrderRequest, type CreateOrderResponse, type OrderItem } from "@tab/shared";
import { sql } from "../db";
import { env } from "../env";
import { orderId as newOrderId, shareId as newShareId } from "../ids";
import { priceOrder } from "../pricing-bridge";
import { newToken } from "../token";
import { loadOrderView, payUrl, rotateToken, type OrderRow, type ShareRow } from "./store";

export class BadRequest extends Error {}

export async function createOrder(raw: unknown): Promise<{ status: 201 | 409; body: CreateOrderResponse | unknown }> {
  const req = CreateOrderRequest.parse(raw); // strict: extra fields (amounts) are rejected
  if (req.payer_refs.length !== req.party_size) throw new BadRequest("payer_refs.length must equal party_size");
  if (new Set(req.payer_refs).size !== req.payer_refs.length) throw new BadRequest("payer_refs must be unique");
  const deadline = new Date(req.deadline_at);
  const now = Date.now();
  if (!(deadline.getTime() > now && deadline.getTime() <= now + 7 * 86_400_000)) throw new BadRequest("deadline_at must be in the future and within 7 days");

  const priced = priceOrder(req.bundle, req.party_size);
  const oid = newOrderId();
  const ttlExp = new Date(Math.min(now + env().PAY_LINK_TTL_MIN * 60_000, deadline.getTime()));

  return sql().begin(async (tx) => {
    const ins = await tx<{ id: string }[]>`
      insert into venue.orders (id, plan_ref, plan_version, bundle, items, party_size, total_cents, deadline_at)
      values (${oid}, ${req.plan_ref}, ${req.plan_version}, ${tx.json(req.bundle as never)}, ${tx.json(priced.items as never)},
              ${req.party_size}, ${priced.total}, ${deadline})
      on conflict (plan_ref, plan_version) do nothing returning id`;
    if (ins.length === 0) {
      const [o] = await tx<OrderRow[]>`select * from venue.orders where plan_ref = ${req.plan_ref} and plan_version = ${req.plan_version} for update`;
      const shares = await tx<ShareRow[]>`select * from venue.shares where order_id = ${o!.id} order by id`;
      const safeRetry =
        o!.status === "OPEN" && shares.every((s) => s.status === "PENDING" && !s.token_used_at) &&
        shares.map((s) => s.payer_ref).sort().join() === [...req.payer_refs].sort().join();
      if (!safeRetry) return { status: 409 as const, body: await loadOrderView(tx as never, o!.id) };
      const out = [];
      for (const s of shares) {
        const r = await rotateToken(tx as never, s.id, o!.deadline_at);
        out.push({ share_id: s.id, payer_ref: s.payer_ref, amount_cents: s.amount_cents, pay_url: payUrl(r.token), expires_at: r.expires_at });
      }
      return {
        status: 201 as const,
        body: { order_id: o!.id, total_cents: o!.total_cents, currency: "USD" as const, items: o!.items as OrderItem[], shares: out },
      };
    }
    const out = [];
    for (const payer_ref of req.payer_refs) {
      const { token, hash } = newToken();
      const sid = newShareId();
      await tx`
        insert into venue.shares (id, order_id, payer_ref, amount_cents, token_hash, token_expires_at)
        values (${sid}, ${oid}, ${payer_ref}, ${priced.sharePp}, ${hash}, ${ttlExp})`;
      out.push({ share_id: sid, payer_ref, amount_cents: priced.sharePp, pay_url: payUrl(token), expires_at: ttlExp.toISOString() });
    }
    return { status: 201 as const, body: { order_id: oid, total_cents: priced.total, currency: "USD" as const, items: priced.items, shares: out } };
  }) as Promise<{ status: 201 | 409; body: CreateOrderResponse | unknown }>;
}
