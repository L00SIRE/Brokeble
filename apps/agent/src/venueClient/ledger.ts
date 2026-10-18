// Maps venue events onto the console: SSE `ledger` and `counters`. Never puts a pay_url or any constraint value in an event.
import type { VenueEvent, ShareStatus } from "@tab/shared";
import { sql } from "../db";
import { emit } from "../events";

const STATUS: Partial<Record<VenueEvent["type"], ShareStatus>> = {
  "share.authorizing": "AUTHORIZING", "share.authorized": "AUTHORIZED", "share.declined": "DECLINED",
  "share.auth_unknown": "AUTH_UNKNOWN", "share.released": "RELEASED", "share.captured": "CAPTURED",
};

export async function emitLedger(ev: VenueEvent): Promise<void> {
  const status = STATUS[ev.type];
  if (status && ev.payer_ref && ev.share_id) {
    const [row] = await sql<{ lane: number; amount: number | null }[]>`
      select pa.lane, b.all_in_pp_cents as amount
      from app.plans p
      join app.users u on u.payer_ref = ${ev.payer_ref}
      join app.participants pa on pa.plan_id = p.id and pa.user_id = u.id
      left join app.bundles b on b.plan_id = p.id and b.plan_version = p.version and b.id = p.chosen_bundle_id
      where p.ref = ${ev.plan_ref}`;
    if (row) {
      const amount = typeof ev.data.amount_cents === "number" ? ev.data.amount_cents : (row.amount ?? 0);
      const short = ev.data.cybs_payment_id_short ?? ev.data.cybs_capture_id_short;
      // Label where the id came from so a simulated id never looks like a real one (the agent never reads CYBS_*; M1).
      const prefix = ev.data.cybs_source === "sim" ? "SIM " : ev.data.cybs_source === "testrest" ? "sandbox " : "";
      await emit({
        type: "ledger", order_id: ev.order_id, lane: row.lane, status, amount_cents: amount,
        cybs_id_short: typeof short === "string" ? `${prefix}…${short}` : null,
      });
    }
  }
  await emitCounters();
}

/** Computed from the DB so a restart never zeroes the console. */
export async function emitCounters(): Promise<void> {
  const [r] = await sql<{ converted: string; released: string }[]>`
    select (select count(*) from app.plans where state = 'CONFIRMED')::text as converted,
           (select count(*) from app.events where type = 'ledger' and data->>'status' = 'RELEASED')::text as released`;
  await emit({
    type: "counters", groups_converted: Number(r!.converted), fronted_by_individual_cents: 0, holds_released: Number(r!.released),
  });
}
