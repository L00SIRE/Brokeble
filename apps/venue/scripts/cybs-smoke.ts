// Sandbox smoke (PLAN §19 spikes S1/S2/S3/S5). Run from apps/venue: pnpm exec tsx --env-file=.env.local scripts/cybs-smoke.ts
// Override with CYBS_RUN_ENV=testrest.cybersource.com CYBS_AUTH_TYPE=http_signature. Uses the sandbox test card server-side. Prints status codes and key NAMES only; never tokens, PANs or credentials.
import { randomBytes } from "node:crypto";

Object.assign(process.env, {
  CYBS_MODE: "live", CYBS_RUN_ENV: process.env.CYBS_RUN_ENV ?? "apitest.cybersource.com", CYBS_AUTH_TYPE: process.env.CYBS_AUTH_TYPE ?? "jwt", VENUE_PUBLIC_URL: "http://localhost:3001", VENUE_PUBLIC_HOST: "localhost:3001",
  DATABASE_URL: "postgres://unused", TAP_KEY_DIRECTORY_JSON: "{}", AGENT_HOOK_URL: "http://localhost:9/hook",
  VENUE_HOOK_SECRET: "x".repeat(16), VENUE_OPS_KEY: "x".repeat(16),
});
const { liveCybs: c } = await import("../src/cybs/live");
const { cybsSource } = await import("../src/cybs/source");
console.log("source:", cybsSource().label);

const tag = randomBytes(4).toString("hex");
const keys = (o: unknown): string[] => (o && typeof o === "object" ? Object.keys(o as object) : []);
const show = (label: string, o: any) =>
  console.log(label, o.kind, o.http ?? "", o.kind === "ok" ? `status=${o.data?.status} id=${o.data?.id ? "…" + String(o.data.id).slice(-6) : "-"} keys=[${keys(o.data)}]` :
    o.kind === "rejected" ? `reason=${o.body?.reason} status=${o.body?.status} message=${String(o.body?.message ?? "").slice(0, 120)} details=${JSON.stringify(o.body?.details ?? []).slice(0, 200)}` : `code=${o.code}`);

const bill = { first_name: "Test", last_name: "Card", postal_code: "90024", email: "test@example.com" };
const auth = (code: string, tid = randomBytes(15).toString("hex"), amountCents = 100) =>
  c.authorize({ code, transactionId: tid, amountCents, billTo: bill, saveCard: false, sandboxTestCard: true });

console.log("== S1 auth (no TOKEN_CREATE, minimal billTo)");
const a1 = await auth(`smoke-${tag}-1`);
show("auth", a1);
if (a1.kind === "ok") {
  const d: any = a1.data;
  console.log("card block:", keys(d.paymentAccountInformation?.card), keys(d.paymentInformation?.card), "suffix/type present:", !!(d.paymentAccountInformation?.card ?? d.paymentInformation?.card));
}
console.log("== duplicate code");
show("dup", await auth(`smoke-${tag}-1`));

if (a1.kind === "ok" && a1.data.id) {
  console.log("== S3 reverse twice");
  show("rev1", await c.reverse(a1.data.id, `smoke-${tag}-rev1`, 100, "test"));
  show("rev2", await c.reverse(a1.data.id, `smoke-${tag}-rev2`, 100, "test"));
}

console.log("== S2 capture twice");
const a2 = await auth(`smoke-${tag}-2`);
show("auth2", a2);
if (a2.kind === "ok" && a2.data.id) {
  show("cap1", await c.capture(a2.data.id, `smoke-${tag}-cap1`, 100));
  show("cap2", await c.capture(a2.data.id, `smoke-${tag}-cap2`, 100));
}

console.log("== S5 timeout reversal: known transactionId, then never-sent");
const tid = randomBytes(15).toString("hex");
const a3 = await auth(`smoke-${tag}-3`, tid);
show("auth3", a3);
show("tr-known", await c.timeoutReverse(`smoke-${tag}-tr1`, tid, 100, "timeout"));
show("tr-never", await c.timeoutReverse(`smoke-${tag}-tr2`, randomBytes(15).toString("hex"), 100, "timeout"));
show("tr-known-again", await c.timeoutReverse(`smoke-${tag}-tr3`, tid, 100, "timeout")); // 2nd timeout reversal of the same transactionId: UNVERIFIED reason, record it

console.log("== S6 capture context");
try {
  const cc = await c.captureContext();
  console.log("capture context ok; clientLibrary host:", new URL(cc.clientLibrary).host, "integrity present:", !!cc.clientLibraryIntegrity, "jwt len:", cc.jwt.length);
} catch (e) {
  console.log("capture context FAILED:", (e as Error).message);
}
