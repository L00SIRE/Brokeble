import { describe, expect, it } from "vitest";
import {
  contentDigest, parseSignature, parseSignatureInput, requiredComponents, routeTag, signatureBase, signatureParams,
} from "../src/tap";

describe("tap.ts parsers", () => {
  const params = signatureParams(["@method", "@authority", "@path", "content-digest"], { created: 100, expires: 220, keyid: "k1", nonce: "a+b/c==", tag: "agent-payer-auth" });
  it("round-trips Signature-Input", () => {
    const p = parseSignatureInput(`sig2=${params}`)!;
    expect(p.label).toBe("sig2");
    expect(p.raw).toBe(params);
    expect(p.components).toEqual(["@method", "@authority", "@path", "content-digest"]);
    expect(p.params).toMatchObject({ created: 100, expires: 220, keyid: "k1", alg: "ed25519", nonce: "a+b/c==", tag: "agent-payer-auth" });
  });
  it("is strict", () => {
    expect(parseSignatureInput("garbage")).toBeNull();
    expect(parseSignatureInput(`sig2=${params}, sig1=${params}`)).toBeNull();
    expect(parseSignatureInput(`sig2=${params};created=5`)).toBeNull(); // duplicate parameter
  });
  it("parses Signature", () => {
    expect(parseSignature("sig2=:AAEC:", "sig2")).toEqual(Buffer.from([0, 1, 2]));
    expect(parseSignature("sig1=:AAEC:", "sig2")).toBeNull();
    expect(parseSignature("sig2=AAEC", "sig2")).toBeNull();
  });
  it("builds an LF-joined base with no trailing LF", () => {
    const comps = requiredComponents("GET");
    const base = signatureBase(comps, { method: "get", authority: "Venue.Test", path: "/orders/x" }, "(P)");
    expect(base).toBe('"@method": GET\n"@authority": venue.test\n"@path": /orders/x\n"@signature-params": (P)');
  });
  it("routes tags and digests per RFC 9530", () => {
    expect(routeTag("GET")).toBe("agent-browser-auth");
    expect(routeTag("POST")).toBe("agent-payer-auth");
    expect(contentDigest("")).toBe("sha-256=:47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=:");
  });
});
