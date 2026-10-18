import { describe, expect, it } from "vitest";
import { canonicalConsent } from "@tab/shared/tap";
import { verifyTap } from "../src/tap/verify";
import { AUTHORITY, keys, memNonces, signedRequest } from "./helpers/sign";

const NOW = 1_800_000_000;
const deps = (nonces = memNonces(), now = NOW) => ({ now: () => now, authority: AUTHORITY, keys, nonces });
const failedStep = (r: Awaited<ReturnType<typeof verifyTap>>) => r.steps.find((s) => !s.ok)?.n;

describe("TAP verifier (M8)", () => {
  it("accepts a valid GET (browse)", async () => {
    const r = await verifyTap(signedRequest("GET", "/orders/ord_x", null, NOW), deps());
    expect(r.accepted).toBe(true);
    expect(r.steps.map((s) => s.n)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(r.signature_base).toContain('"@authority": venue.test');
  });
  it("accepts a valid POST (pay)", async () => {
    const r = await verifyTap(signedRequest("POST", "/checkout/ord_x", '{"a":1}', NOW), deps());
    expect(r.accepted).toBe(true);
    expect(r.tag).toBe("agent-payer-auth");
  });
  it("rejects a tampered body at step 6 (digest)", async () => {
    const req = signedRequest("POST", "/checkout/ord_x", '{"a":1}', NOW);
    const r = await verifyTap({ ...req, body: Buffer.from('{"a":2}') }, deps());
    expect(r.accepted).toBe(false);
    expect(failedStep(r)).toBe(6);
    expect(r.reason).toMatch(/digest mismatch/);
  });
  it("rejects a replay at step 4", async () => {
    const nonces = memNonces();
    const req = signedRequest("POST", "/checkout/ord_x", "{}", NOW);
    expect((await verifyTap(req, deps(nonces))).accepted).toBe(true);
    const r = await verifyTap(req, deps(nonces));
    expect(failedStep(r)).toBe(4);
  });
  it("rejects an expired signature at step 3", async () => {
    const r = await verifyTap(signedRequest("POST", "/checkout/x", "{}", NOW, { created: NOW - 600, expires: NOW - 480 }), deps());
    expect(failedStep(r)).toBe(3);
    expect(r.reason).toMatch(/expired 480s ago/);
  });
  it("rejects a window over 8 minutes at step 3", async () => {
    const r = await verifyTap(signedRequest("POST", "/checkout/x", "{}", NOW, { created: NOW, expires: NOW + 481 }), deps());
    expect(failedStep(r)).toBe(3);
  });
  it("rejects the wrong tag on POST at step 1", async () => {
    const r = await verifyTap(signedRequest("POST", "/checkout/x", "{}", NOW, { tag: "agent-browser-auth" }), deps());
    expect(failedStep(r)).toBe(1);
    expect(r.steps).toHaveLength(1);
  });
  it("rejects a missing nonce at step 2", async () => {
    const r = await verifyTap(signedRequest("GET", "/orders/x", null, NOW, { drop: "nonce" }), deps());
    expect(failedStep(r)).toBe(2);
    expect(r.reason).toBe("missing nonce");
  });
  it("rejects an unknown keyid at step 5", async () => {
    const r = await verifyTap(signedRequest("GET", "/orders/x", null, NOW, { keyid: "tab-agent-x" }), deps());
    expect(failedStep(r)).toBe(5);
  });
  it("rejects bad signature bytes at step 6 and does not burn the nonce", async () => {
    const nonces = memNonces();
    const req = signedRequest("GET", "/orders/x", null, NOW);
    req.headers.set("signature", `sig2=:${Buffer.alloc(64).toString("base64")}:`);
    const r = await verifyTap(req, deps(nonces));
    expect(failedStep(r)).toBe(6);
    expect(nonces.map.size).toBe(0);
  });
  it("rejects a signature over a different path", async () => {
    const req = signedRequest("GET", "/orders/a", null, NOW);
    const r = await verifyTap({ ...req, path: "/orders/b" }, deps());
    expect(failedStep(r)).toBe(6);
  });
  it("rejects expires <= created at step 3, even inside the clock skew", async () => {
    const r = await verifyTap(signedRequest("POST", "/checkout/x", "{}", NOW, { created: NOW + 4, expires: NOW + 2 }), deps());
    expect(failedStep(r)).toBe(3);
    expect(r.reason).toBe("expires must be after created");
  });
  it("rejects a repeated component identifier at step 2", async () => {
    const req = signedRequest("GET", "/orders/x", null, NOW);
    req.headers.set("signature-input", req.headers.get("signature-input")!.replace('"@path")', '"@path" "@path")'));
    const r = await verifyTap(req, deps());
    expect(failedStep(r)).toBe(2);
    expect(r.reason).toBe("duplicate component");
  });
  it('accepts alg="Ed25519" (case-insensitive)', async () => {
    const r = await verifyTap(signedRequest("GET", "/orders/x", null, NOW, { alg: "Ed25519" }), deps());
    expect(r.accepted).toBe(true);
  });
});

describe("canonicalConsent", () => {
  it("sorts shares and is byte-exact", () => {
    const s = canonicalConsent({
      order_id: "ord_1",
      total_cents: 6000,
      shares: [
        { share_id: "shr_b", cybs_payment_id: "p2", amount_cents: 3000 },
        { share_id: "shr_a", cybs_payment_id: "p1", amount_cents: 3000 },
      ],
    });
    expect(s).toBe(
      '{"order_id":"ord_1","total_cents":6000,"shares":[{"share_id":"shr_a","cybs_payment_id":"p1","amount_cents":3000},{"share_id":"shr_b","cybs_payment_id":"p2","amount_cents":3000}]}',
    );
  });
});
