// Plays the agent against a running venue using the REAL agent client + signer.
//   VENUE_BASE_URL=http://localhost:3001 TAP_KEY_ID=… TAP_PRIVATE_KEY_PEM_B64=… \
//   pnpm --filter @tab/venue exec tsx scripts/agent-sim.ts happy|cancel|tamper|replay|expired|wrong_tag [--auto]
// --auto pays each share by calling the pay API with the mock outcome (CYBS_MODE=mock on the venue only).
import { randomBytes } from "node:crypto";
import { consentFromOrder } from "@tab/shared/tap";
import { LiveVenue } from "../../agent/src/venueClient/index";
import { createSigner } from "../../agent/src/tap/signer";

const mode = process.argv[2] ?? "happy";
const auto = process.argv.includes("--auto");
const need = (k: string) => process.env[k] ?? (() => { throw new Error(`${k} required`); })();
const baseUrl = need("VENUE_BASE_URL");
const venue = new LiveVenue({
  baseUrl,
  signer: () => createSigner({ keyId: need("TAP_KEY_ID"), privateKeyPemB64: need("TAP_PRIVATE_KEY_PEM_B64") }),
  emit: (e) => console.log(`  [sse] ${e.type}`),
  fetch,
});

const bundle = {
  bundle_key: "bnd_" + randomBytes(5).toString("hex"), date: "2026-10-18",
  dinner: { name: "Sim Dinner", address: "1 Sim St, Los Angeles", time: "18:00", est_high_pp_usd: 22 },
  show: { name: "Sim Show", address: "2 Sim St, Los Angeles", time: "20:00", est_high_pp_usd: 8 },
};
console.log("available:", await venue.checkAvailability(bundle.bundle_key));
const order = await venue.createOrder({
  plan_ref: crypto.randomUUID(), plan_version: 1, bundle, party_size: 3,
  payer_refs: Array.from({ length: 3 }, () => randomBytes(16).toString("hex")), deadline_at: new Date(Date.now() + 3_600_000).toISOString(),
});
console.log("order", order.order_id, "total", order.total_cents);
for (const s of order.shares) console.log("  pay:", s.pay_url);

if (auto) {
  for (const s of order.shares) {
    const token = s.pay_url.split("/pay/")[1]!;
    const r = await fetch(new URL(`/api/pay/${token}/authorize`, baseUrl), {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ save_card: false, bill_to: { first_name: "Sim", last_name: "Payer", postal_code: "90024" } }),
    });
    console.log("  authorize →", (await r.json()).state);
  }
}
for (let i = 0; i < 60; i++) {
  const o = await venue.getOrder(order.order_id);
  if (o.shares.every((s) => s.status === "AUTHORIZED")) break;
  if (i === 59) throw new Error("timed out waiting for holds");
  console.log("  waiting for holds:", o.shares.map((s) => s.status).join(","));
  await new Promise((r) => setTimeout(r, 3000));
}

const held = await venue.getOrder(order.order_id);
if (mode === "cancel") {
  const c = await venue.cancel(order.order_id, "sim: someone is out");
  console.log("cancel →", c.status, c.shares.map((s) => s.status).join(","));
} else {
  const test = mode === "happy" ? undefined : (mode as "tamper" | "replay" | "expired" | "wrong_tag");
  const r = await venue.commit(order.order_id, consentFromOrder(held), test);
  console.log("commit →", r.result, "accepted:", r.tap.accepted, r.tap.reason ?? "");
  for (const s of r.tap.steps) console.log(`  ${s.ok ? "✓" : "✗"} ${s.n} ${s.name}: ${s.detail}`);
  console.log("  business:", r.tap.business);
  const after = await venue.getOrder(order.order_id);
  console.log("order now:", after.status, after.shares.map((s) => s.status).join(","));
}
