// app.outbound_messages: idempotency ledger for notify(). Stores template_id only, never message text. Owner A.
import type { TemplateId } from "@tab/shared";
import { sql, type Db } from "../db";

export type OutboundClaim = { idempotency_key: string; user_id: string | null; plan_id: string | null; template_id: TemplateId };

/**
 * Claims a send key: insert 'pending', or re-claim a row whose status is not 'accepted'/'blocked_inbound'
 * (same Photon key on retry, Photon dedupes). False = already sent or blocked: do not send.
 */
export async function claimOutbound(c: OutboundClaim, tx: Db = sql): Promise<boolean> {
  const rows = await tx`
    insert into app.outbound_messages (idempotency_key, user_id, plan_id, template_id, status)
    values (${c.idempotency_key}, ${c.user_id}, ${c.plan_id}, ${c.template_id}, 'pending')
    on conflict (idempotency_key) do update set status = 'pending', updated_at = now()
      where app.outbound_messages.status not in ('accepted', 'blocked_inbound')
    returning idempotency_key`;
  return rows.length > 0;
}

/** status='accepted', photon_message_id set. */
export async function markOutboundAccepted(idempotencyKey: string, photonMessageId: string, tx: Db = sql): Promise<void> {
  await tx`
    update app.outbound_messages set status = 'accepted', photon_message_id = ${photonMessageId}, updated_at = now()
    where idempotency_key = ${idempotencyKey}`;
}

/** status='failed:<problemCode>'. Never downgrades a row Photon already accepted. */
export async function markOutboundFailed(idempotencyKey: string, problemCode: string, tx: Db = sql): Promise<void> {
  await tx`
    update app.outbound_messages set status = ${`failed:${problemCode}`}, updated_at = now()
    where idempotency_key = ${idempotencyKey} and status <> 'accepted'`;
}

/** Upserts status='blocked_inbound' (no dm_route, or SHARED_LINE_INBOUND_REQUIRED). Never downgrades 'accepted'. */
export async function markOutboundBlocked(c: OutboundClaim, tx: Db = sql): Promise<void> {
  await tx`
    insert into app.outbound_messages (idempotency_key, user_id, plan_id, template_id, status)
    values (${c.idempotency_key}, ${c.user_id}, ${c.plan_id}, ${c.template_id}, 'blocked_inbound')
    on conflict (idempotency_key) do update set status = 'blocked_inbound', updated_at = now()
      where app.outbound_messages.status <> 'accepted'`;
}

/** Maps a Photon message id back to its send (delivery SSE lane), or null for typing/read action messages. */
export async function findOutboundByPhotonMessageId(photonMessageId: string, tx: Db = sql): Promise<{ user_id: string | null; plan_id: string | null } | null> {
  const [row] = await tx<{ user_id: string | null; plan_id: string | null }[]>`
    select user_id, plan_id from app.outbound_messages where photon_message_id = ${photonMessageId} limit 1`;
  return row ?? null;
}

/** Distinct users already sent (or being sent) any of `templateIds` for this plan. Template ids only, never text. */
export async function usersSentTemplate(planId: string, templateIds: readonly TemplateId[], tx: Db = sql): Promise<Set<string>> {
  const rows = await tx<{ user_id: string }[]>`
    select distinct user_id::text as user_id from app.outbound_messages
    where plan_id = ${planId} and user_id is not null
      and template_id = any(${templateIds as string[]}) and status in ('pending', 'accepted')`;
  return new Set(rows.map((r) => r.user_id));
}
