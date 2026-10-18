import { createHash, generateKeyPairSync, sign, verify } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ConsentSet, OrderStatus } from "../src/index";
import {
  canonicalConsent,
  consentFromOrder,
  contentDigest,
  requiredComponents,
  routeTag,
  signatureBase,
  signatureHeader,
  signatureInputHeader,
  signatureParams,
  TAG,
} from "../src/tap";

const consent: ConsentSet = {
  total_cents: 7400,
  shares: [
    { amount_cents: 3700, cybs_payment_id: "pay_b", share_id: "shr_bbbbbbbbbb" },
    { share_id: "shr_aaaaaaaaaa", amount_cents: 3700, cybs_payment_id: "pay_a" },
  ],
  order_id: "ord_0123456789",
};

describe("canonicalConsent", () => {
  it("fixes key order, sorts shares by share_id and has no whitespace", () => {
    expect(canonicalConsent(consent)).toBe(
      '{"order_id":"ord_0123456789","total_cents":7400,"shares":[' +
        '{"share_id":"shr_aaaaaaaaaa","cybs_payment_id":"pay_a","amount_cents":3700},' +
        '{"share_id":"shr_bbbbbbbbbb","cybs_payment_id":"pay_b","amount_cents":3700}]}',
    );
  });

  it("is independent of input share order and does not mutate the input", () => {
    const reversed = { ...consent, shares: [...consent.shares].reverse() };
    const before = JSON.stringify(consent);
    expect(canonicalConsent(reversed)).toBe(canonicalConsent(consent));
    expect(JSON.stringify(consent)).toBe(before);
  });

  it("drops extra keys and stays a valid ConsentSet", () => {
    const withExtra = { ...consent, shares: consent.shares.map((s) => ({ ...s, status: "AUTHORIZED" })) };
    const body = canonicalConsent(withExtra as ConsentSet);
    expect(body).not.toContain("status");
    expect(ConsentSet.parse(JSON.parse(body))).toEqual(JSON.parse(body));
  });
});

describe("consentFromOrder", () => {
  const order = OrderStatus.parse({
    order_id: "ord_0123456789",
    plan_ref: "3f1c2b8e-6a0d-4c1f-9e2a-7b5d4c3a2f10",
    plan_version: 1,
    status: "OPEN",
    total_cents: 7400,
    updated_at: "2026-10-17T23:00:00Z",
    shares: [
      { share_id: "shr_bbbbbbbbbb", payer_ref: "b".repeat(32), amount_cents: 3700, status: "AUTHORIZED", cybs_payment_id: "pay_b", card_last4: "1111" },
      { share_id: "shr_aaaaaaaaaa", payer_ref: "a".repeat(32), amount_cents: 3700, status: "AUTHORIZED", cybs_payment_id: "pay_a", card_last4: "1111" },
    ],
  });

  it("builds the same canonical body as a hand-built consent set", () => {
    expect(canonicalConsent(consentFromOrder(order))).toBe(canonicalConsent(consent));
  });

  it("throws when a share has no payment id", () => {
    const bad = { ...order, shares: [{ ...order.shares[0]!, cybs_payment_id: null }] };
    expect(() => consentFromOrder(bad)).toThrow(/no cybs_payment_id/);
  });
});

describe("contentDigest", () => {
  it("uses RFC 9530 syntax over the exact body bytes", () => {
    const body = canonicalConsent(consent);
    const expected = createHash("sha256").update(Buffer.from(body, "utf8")).digest("base64");
    expect(contentDigest(body)).toBe(`sha-256=:${expected}:`);
    expect(contentDigest(new TextEncoder().encode(body))).toBe(contentDigest(body));
  });
});

describe("routes and components", () => {
  it("maps GET to browse and everything else to pay", () => {
    expect(routeTag("GET")).toBe(TAG.browse);
    expect(routeTag("get")).toBe("agent-browser-auth");
    expect(routeTag("POST")).toBe("agent-payer-auth");
    expect(requiredComponents("GET")).toEqual(["@method", "@authority", "@path"]);
    expect(requiredComponents("POST")).toEqual(["@method", "@authority", "@path", "content-digest"]);
  });
});

describe("signature base", () => {
  const p = { created: 1760740000, expires: 1760740120, keyid: "tab-agent-ed25519-1", nonce: "bm9uY2U=", tag: TAG.pay };

  it("matches the PLAN §8 Signature-Input format", () => {
    const params = signatureParams(requiredComponents("POST"), p);
    expect(params).toBe(
      '("@method" "@authority" "@path" "content-digest");created=1760740000;expires=1760740120;' +
        'keyid="tab-agent-ed25519-1";alg="ed25519";nonce="bm9uY2U=";tag="agent-payer-auth"',
    );
    expect(signatureInputHeader(params)).toBe(`sig2=${params}`);
  });

  it("is LF-joined with no trailing LF, uppercases method and lowercases authority", () => {
    const comps = requiredComponents("POST");
    const params = signatureParams(comps, p);
    const digest = contentDigest(canonicalConsent(consent));
    const base = signatureBase(comps, { method: "post", authority: "Venue.Example.COM", path: "/checkout/ord_0123456789", contentDigest: digest }, params);
    expect(base).toBe(
      [
        '"@method": POST',
        '"@authority": venue.example.com',
        '"@path": /checkout/ord_0123456789',
        `"content-digest": ${digest}`,
        `"@signature-params": ${params}`,
      ].join("\n"),
    );
    expect(base.endsWith("\n")).toBe(false);
  });

  it("builds a GET base without content-digest", () => {
    const comps = requiredComponents("GET");
    const params = signatureParams(comps, { ...p, tag: TAG.browse });
    const base = signatureBase(comps, { method: "GET", authority: "localhost:3001", path: "/availability/k" }, params);
    expect(base.split("\n")).toHaveLength(4);
  });

  it("refuses a content-digest component without a value", () => {
    expect(() => signatureBase(["content-digest"], { method: "POST", authority: "a", path: "/" }, "()")).toThrow();
  });

  it("round-trips an Ed25519 signature over the base with node:crypto", () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const comps = requiredComponents("POST");
    const params = signatureParams(comps, p);
    const base = signatureBase(comps, { method: "POST", authority: "venue.test", path: "/checkout/x", contentDigest: contentDigest("{}") }, params);
    const sig = sign(null, Buffer.from(base), privateKey);
    expect(verify(null, Buffer.from(base), publicKey, sig)).toBe(true);
    expect(signatureHeader(sig)).toBe(`sig2=:${sig.toString("base64")}:`);
  });
});
