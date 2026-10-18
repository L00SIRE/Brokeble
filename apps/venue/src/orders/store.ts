import type postgres from "postgres";
import type { OrderStatus } from "@tab/shared";
import { env } from "../env";
import { newToken } from "../token";

export type Q = postgres.Sql;

export type OrderRow = {
  id: string; plan_ref: string; plan_version: number; status: OrderStatus["status"];
  bundle: any; items: any; party_size: number; total_cents: number; deadline_at: Date; updated_at: Date;
};
export type ShareRow = {
  id: string; order_id: string; payer_ref: string; amount_cents: number; status: string;
  token_hash: Buffer; token_expires_at: Date; token_used_at: Date | null;
  cybs_payment_id: string | null; card_brand: string | null; card_last4: string | null; updated_at: Date;
};

export const payUrl = (token: string) => `${env().VENUE_PUBLIC_URL.replace(/\/$/, "")}/pay/${token}`;

export async function loadOrderView(q: Q, orderId: string): Promise<OrderStatus | null> {
  const [o] = await q<OrderRow[]>`select * from venue.orders where id = ${orderId}`;
  if (!o) return null;
  const shares = await q<ShareRow[]>`select * from venue.shares where order_id = ${orderId} order by id`;
  return {
    order_id: o.id, plan_ref: o.plan_ref, plan_version: o.plan_version, status: o.status, total_cents: o.total_cents,
    shares: shares.map((s) => ({
      share_id: s.id, payer_ref: s.payer_ref, amount_cents: s.amount_cents, status: s.status as never,
      cybs_payment_id: s.cybs_payment_id, card_last4: s.card_last4,
    })),
    updated_at: o.updated_at.toISOString(),
  };
}

/** Issues a fresh single-use token for a PENDING share: new hash, unused, expiry = least(now+TTL, deadline). */
export async function rotateToken(q: Q, shareId: string, deadline: Date): Promise<{ token: string; expires_at: string }> {
  const { token, hash } = newToken();
  const exp = new Date(Math.min(Date.now() + env().PAY_LINK_TTL_MIN * 60_000, deadline.getTime()));
  await q`
    update venue.shares set token_hash = ${hash}, token_used_at = null, token_expires_at = ${exp}, status = 'PENDING', updated_at = now()
    where id = ${shareId}`;
  return { token, expires_at: exp.toISOString() };
}
