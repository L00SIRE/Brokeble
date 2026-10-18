// Transactional outbox: events are enqueued in the same transaction as the state change, then delivered to the agent
// with an HMAC over `ts.body`. A redelivery carries the same event_id so the agent's inbound_events dedupe works.
import { createHmac } from "node:crypto";
import type postgres from "postgres";
import type { VenueEvent } from "@tab/shared";
import { env } from "../env";
import { eventId } from "../ids";
import { sql } from "../db";

export type Q = postgres.Sql;
type EventType = Exclude<VenueEvent["type"], "tap.verified">;

export async function enqueue(
  q: Q,
  o: { order: { id: string; plan_ref: string }; share?: { id: string; payer_ref: string }; type: EventType; data?: Record<string, unknown> },
): Promise<number> {
  const event: VenueEvent = {
    event_id: eventId(),
    at: new Date().toISOString(),
    order_id: o.order.id,
    plan_ref: o.order.plan_ref,
    type: o.type,
    share_id: o.share?.id ?? null,
    payer_ref: o.share?.payer_ref ?? null,
    data: o.data ?? {},
  };
  const [r] = await q<{ id: string }[]>`insert into venue.outbox (event) values (${q.json(event as never)}) returning id::text`;
  return Number(r!.id);
}

/** Best-effort delivery; failures leave the row for the sweep. Never throws. */
export async function deliver(ids: number[]): Promise<number> {
  let delivered = 0;
  for (const id of ids) {
    const [row] = await sql()<{ event: VenueEvent }[]>`
      update venue.outbox set attempts = attempts + 1 where id = ${id} and delivered_at is null returning event`;
    if (!row) continue;
    try {
      const body = JSON.stringify(row.event);
      const ts = Math.floor(Date.now() / 1000).toString();
      const sig = createHmac("sha256", env().VENUE_HOOK_SECRET).update(`${ts}.${body}`).digest("hex");
      const res = await fetch(env().AGENT_HOOK_URL, {
        method: "POST",
        headers: { "content-type": "application/json", "x-tab-timestamp": ts, "x-tab-signature": `sha256=${sig}` },
        body,
        signal: AbortSignal.timeout(3000),
      });
      if (res.ok) {
        await sql()`update venue.outbox set delivered_at = now() where id = ${id}`;
        delivered++;
      }
    } catch {
      /* the sweep redelivers */
    }
  }
  return delivered;
}
