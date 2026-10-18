// The Visa money beat, end to end, narrated. Uses the REAL agent client + TAP signer against a running venue.
//   pnpm demo            (from apps/venue; needs the venue running: pnpm demo:serve)
// Beat 1: three friends each place their own hold → agent signs the exact consent set → venue verifies 6 TAP steps → captures all.
// Beat 2: the agent's request is tampered by $1 → TAP step 6 rejects → nothing captured → "I'm out" → every hold released.
import { randomBytes } from "node:crypto";
import { consentFromOrder } from "@tab/shared/tap";
import type { CommitResult, OrderStatus } from "@tab/shared";
import { LiveVenue } from "../../agent/src/venueClient/index";
import { createSigner } from "../../agent/src/tap/signer";

const need = (k: string) => process.env[k] ?? (() => { throw new Error(`${k} required (see .env.demo-agent)`); })();
const baseUrl = need("VENUE_BASE_URL");
const venue = new LiveVenue({
  baseUrl,
  signer: () => createSigner({ keyId: need("TAP_KEY_ID"), privateKeyPemB64: need("TAP_PRIVATE_KEY_PEM_B64") }),
  emit: () => {},
  fetch,
});

const c = { b: "\x1b[1m", d: "\x1b[2m", g: "\x1b[32m", r: "\x1b[31m", y: "\x1b[33m", x: "\x1b[0m" };
const say = (s: string) => console.log(s);
const step = (s: string) => say(`\n${c.b}▸ ${s}${c.x}`);
const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const tail = (id: string | null) => (id ? `…${id.slice(-8)}` : "-");
const FRIENDS = ["Christian", "Dawson", "Suman"];

async function newHeldOrder(): Promise<OrderStatus> {
  const bundle = {
    bundle_key: "bnd_" + randomBytes(5).toString("hex"), date: "2026-10-18",
    dinner: { name: "Noodle Lab", address: "1 Demo St, Los Angeles", time: "18:30", est_high_pp_usd: 12 },
    show: { name: "Open Mic at The Cellar", address: "2 Demo St, Los Angeles", time: "20:30", est_high_pp_usd: 12 },
  };
  const order = await venue.createOrder({
    plan_ref: crypto.randomUUID(), plan_version: 1, bundle, party_size: 3,
    payer_refs: FRIENDS.map(() => randomBytes(16).toString("hex")), deadline_at: new Date(Date.now() + 3_600_000).toISOString(),
  });
  say(`  order ${order.order_id} · ${usd(order.total_cents)} total · ${usd(order.shares[0]!.amount_cents)} each, priced by the venue (never by the agent)`);
  for (const [i, s] of order.shares.entries()) {
    const token = s.pay_url.split("/pay/")[1]!;
    const r = await fetch(new URL(`/api/pay/${token}/authorize`, baseUrl), {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ save_card: false, sandbox_test_card: true, bill_to: { first_name: FRIENDS[i], last_name: "Demo", postal_code: "90024" } }),
    });
    const j = (await r.json()) as { state: string; card?: { brand: string | null; last4: string | null } };
    say(`  ${FRIENDS[i]!.padEnd(9)} ${j.state === "held" ? c.g + "HELD" : c.r + j.state.toUpperCase()}${c.x} ${usd(s.amount_cents)} on ${j.card?.brand ?? "card"} ••${j.card?.last4 ?? "????"}  ${c.d}(their own authorization, capture:false)${c.x}`);
  }
  const o = await venue.getOrder(order.order_id);
  say(`  ${c.d}Cybersource auth ids: ${o.shares.map((s) => tail(s.cybs_payment_id)).join("  ")}${c.x}`);
  return o;
}

function printTap(r: CommitResult) {
  for (const s of r.tap.steps) say(`    ${s.ok ? c.g + "✓" : c.r + "✗"} ${s.n} ${s.name.padEnd(10)}${c.x} ${s.detail}`);
  if (r.tap.business) {
    const b = r.tap.business;
    say(`    ${c.d}business: all_authorized=${b.all_authorized} sum_matches=${b.sum_matches} consent_matches=${b.consent_matches}${c.x}`);
  }
}

say(`${c.b}SquadTab · venue money flow${c.x}  ${c.d}${baseUrl}${c.x}`);

step("Beat 1 — nobody pays until everyone's in");
const o1 = await newHeldOrder();
step("Agent signs the exact consent set (Visa Trusted Agent Protocol, Ed25519, RFC 9421) → venue verifies");
const r1 = await venue.commit(o1.order_id, consentFromOrder(o1));
printTap(r1);
say(`  result: ${r1.result === "captured" ? c.g : c.r}${r1.result.toUpperCase()}${c.x}  captures: ${r1.captures.map((x) => `${x.status} ${tail(x.cybs_capture_id)}`).join("  ")}`);

step("Beat 2 — someone tampers with the signed request ($1 on one share)");
const o2 = await newHeldOrder();
const r2 = await venue.commit(o2.order_id, consentFromOrder(o2), "tamper");
printTap(r2);
const after = await venue.getOrder(o2.order_id);
say(`  result: ${c.r}${r2.result.toUpperCase()}${c.x} — nothing captured; shares still ${[...new Set(after.shares.map((s) => s.status))].join(",")}`);

step("Wrong-intent and expired requests are refused too");
for (const kind of ["replay", "wrong_tag", "expired"] as const) {
  if (kind === "replay") continue; // replay's first leg would capture a fully held order; shown in the unit tests and tap-test panel
  const r = await venue.commit(o2.order_id, consentFromOrder(after), kind);
  const bad = r.tap.steps.find((s) => !s.ok);
  say(`  ${kind.padEnd(9)} → ${c.r}rejected${c.x} at step ${bad?.n} (${bad?.name}): ${bad?.detail}`);
}

step("\"I'm out\" — one friend drops, so every hold is released");
const cancelled = await venue.cancel(o2.order_id, "a friend is out");
say(`  order ${cancelled.status}: ${cancelled.shares.map((s) => s.status).join(", ")}`);
say(`  ${c.y}"Nobody was charged; your pending authorization was released."${c.x}`);
