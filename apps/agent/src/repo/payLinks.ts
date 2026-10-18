// app.pay_links (db/migrations/004_pay_links.sql, A plan T9). pay_url is a single-use bearer link to pay one's own
// share: never log it, emit it on SSE or put it in an X-ray preview. Owner A.
import { sql, type Db } from "../db";
import type { PayLinkRow } from "./types";

/** Upserts on (plan_id, user_id, plan_version); a declined/released retry replaces the URL. */
export async function upsertPayLink(l: Omit<PayLinkRow, "updated_at">, tx: Db = sql): Promise<void> {
  await tx`
    insert into app.pay_links (plan_id, user_id, plan_version, share_id, amount_cents, pay_url, expires_at)
    values (${l.plan_id}, ${l.user_id}, ${l.plan_version}, ${l.share_id}, ${l.amount_cents}, ${l.pay_url}, ${l.expires_at})
    on conflict (plan_id, user_id, plan_version) do update set share_id = excluded.share_id,
      amount_cents = excluded.amount_cents, pay_url = excluded.pay_url, expires_at = excluded.expires_at, updated_at = now()`;
}

/** One link, or null (T_REPING, holdGate YES). */
export async function getPayLink(planId: string, userId: string, planVersion: number, tx: Db = sql): Promise<PayLinkRow | null> {
  const [row] = await tx<PayLinkRow[]>`
    select * from app.pay_links where plan_id = ${planId} and user_id = ${userId} and plan_version = ${planVersion}`;
  return row ?? null;
}

/** "forget me". */
export async function deletePayLinksForUser(userId: string, tx: Db = sql): Promise<void> {
  await tx`delete from app.pay_links where user_id = ${userId}`;
}
