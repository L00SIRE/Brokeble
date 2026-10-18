// Prints one /pay/<token> for a $1.00 test share. Dev tool: seeds the DB directly (the only place an amount is chosen by hand).
// Run: pnpm --filter @tab/venue exec tsx --env-file=<env> scripts/seed-test-share.ts
import { sql } from "../src/db";
import { env } from "../src/env";
import { orderId, shareId } from "../src/ids";
import { newToken } from "../src/token";

const oid = orderId(), sid = shareId(), { token, hash } = newToken();
const bundle = { bundle_key: "bnd_0123456789", date: "2026-10-18", dinner: { name: "Test", address: "1 Test St", time: "18:00", est_high_pp_usd: 1 }, show: { name: "Test", address: "2 Test St", time: "20:00", est_high_pp_usd: 0 } };
await sql().begin(async (tx) => {
  await tx`insert into venue.orders (id, plan_ref, plan_version, bundle, items, party_size, total_cents, deadline_at)
           values (${oid}, ${crypto.randomUUID()}, 1, ${tx.json(bundle)}, ${tx.json([])}, 2, 100, now() + interval '2 hours')`;
  await tx`insert into venue.shares (id, order_id, payer_ref, amount_cents, token_hash, token_expires_at)
           values (${sid}, ${oid}, ${"0".repeat(31) + "1"}, 100, ${hash}, now() + interval '30 minutes')`;
});
console.log(`${env().VENUE_PUBLIC_URL.replace(/\/$/, "")}/pay/${token}`);
await sql().end();
