// app.inbound_events: dedupe for Photon deliveries, CREAO webhooks and venue hooks. Owner A.
import { sql, type Db } from "../db";
import type { InboundSource } from "./types";

/** True if (source, eventId) was already handled. */
export async function seenInbound(source: InboundSource, eventId: string, tx: Db = sql): Promise<boolean> {
  const [row] = await tx<{ ok: boolean }[]>`
    select exists(select 1 from app.inbound_events where source = ${source} and event_id = ${eventId}) as ok`;
  return row!.ok;
}

/** Insert-or-ignore AFTER a successful handle (Photon consumer, venue hook): a crash before this means a redelivery. */
export async function markInboundSeen(source: InboundSource, eventId: string, tx: Db = sql): Promise<void> {
  await insertInboundEvent(source, eventId, tx);
}

/** Insert-or-ignore BEFORE acting (CREAO webhook hint). True if this call inserted it. */
export async function insertInboundEvent(source: InboundSource, eventId: string, tx: Db = sql): Promise<boolean> {
  const rows = await tx`
    insert into app.inbound_events (source, event_id) values (${source}, ${eventId})
    on conflict (source, event_id) do nothing returning event_id`;
  return rows.length > 0;
}
