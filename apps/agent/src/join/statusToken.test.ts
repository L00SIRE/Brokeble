import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

const secret = vi.hoisted(() => ({ value: "test-payer-ref-secret-0123456789" }));
vi.mock("../repo/users", () => ({ payerRefSecret: () => secret.value }));

const { issueStatusToken, STATUS_TOKEN_TTL_S, verifyStatusToken } = await import("./statusToken");

const U = "22222222-2222-4222-8222-222222222222";
const P = "11111111-1111-4111-8111-111111111111";
const NOW = Date.UTC(2026, 9, 18, 9, 0, 0);

/** Signs an arbitrary payload with the real derivation, to prove claim validation does not rely on the signature alone. */
function forge(claims: unknown): string {
  const key = createHmac("sha256", secret.value).update("status-token-v1").digest();
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${payload}.${createHmac("sha256", key).update(payload).digest("base64url")}`;
}

describe("status tokens", () => {
  it("round-trips {u, p, r, iat} with iat in seconds", () => {
    const t = issueStatusToken({ u: U, p: P, r: "guest" }, NOW);
    expect(t).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/);
    expect(verifyStatusToken(t, NOW)).toEqual({ u: U, p: P, r: "guest", iat: NOW / 1000 });
    expect(verifyStatusToken(issueStatusToken({ u: U, p: null, r: "organizer" }, NOW), NOW)).toEqual({ u: U, p: null, r: "organizer", iat: NOW / 1000 });
  });

  it("uses a key derived from PAYER_REF_SECRET with the status-token-v1 label (no raw-secret signatures)", () => {
    const t = issueStatusToken({ u: U, p: null, r: "organizer" }, NOW);
    const [payload, sig] = t.split(".") as [string, string];
    expect(sig).toBe(createHmac("sha256", createHmac("sha256", secret.value).update("status-token-v1").digest()).update(payload).digest("base64url"));
    expect(sig).not.toBe(createHmac("sha256", secret.value).update(payload).digest("base64url"));
  });

  it("expires after 7 days and rejects an iat more than a minute in the future", () => {
    const t = issueStatusToken({ u: U, p: null, r: "organizer" }, NOW);
    expect(verifyStatusToken(t, NOW + STATUS_TOKEN_TTL_S * 1000)).not.toBeNull();
    expect(verifyStatusToken(t, NOW + STATUS_TOKEN_TTL_S * 1000 + 1000)).toBeNull();
    expect(verifyStatusToken(t, NOW - 59_000)).not.toBeNull();
    expect(verifyStatusToken(t, NOW - 61_000)).toBeNull();
  });

  it("rejects tampered payloads, tampered or re-spelled signatures, and tokens signed under another secret", () => {
    const t = issueStatusToken({ u: U, p: null, r: "guest" }, NOW);
    const [payload, sig] = t.split(".") as [string, string];
    const elevated = Buffer.from(JSON.stringify({ u: U, p: null, r: "organizer", iat: NOW / 1000 })).toString("base64url");
    expect(verifyStatusToken(`${elevated}.${sig}`, NOW)).toBeNull();
    const flipped = sig.slice(0, 10) + (sig[10] === "A" ? "B" : "A") + sig.slice(11);
    expect(verifyStatusToken(`${payload}.${flipped}`, NOW)).toBeNull();
    // The 43rd character carries 2 unused bits: a different spelling of the same bytes must still be refused.
    const last = sig.at(-1)!;
    const respelled = sig.slice(0, -1) + String.fromCharCode(last.charCodeAt(0) ^ 1);
    expect(verifyStatusToken(`${payload}.${respelled}`, NOW)).toBeNull();
    expect(verifyStatusToken(`${payload}.${sig}=`, NOW)).toBeNull();

    secret.value = "a-completely-different-secret-xyz";
    expect(verifyStatusToken(t, NOW)).toBeNull();
    secret.value = "test-payer-ref-secret-0123456789";
    expect(verifyStatusToken(t, NOW)).not.toBeNull();
  });

  it("rejects malformed input without throwing", () => {
    for (const bad of [undefined, null, "", ".", "abc", "a.b.c", ".sig", `${"x".repeat(600)}.y`]) expect(verifyStatusToken(bad as string, NOW)).toBeNull();
  });

  it("rejects correctly signed payloads that are not valid claims", () => {
    const iat = NOW / 1000;
    for (const claims of [
      { u: "not-a-uuid", p: null, r: "guest", iat },
      { u: U, p: null, r: "admin", iat },
      { u: U, p: null, r: "guest", iat: "1" },
      { u: U, p: null, r: "guest", iat, extra: true },
      { u: U, r: "guest", iat },
      "just a string",
    ]) {
      expect(verifyStatusToken(forge(claims), NOW)).toBeNull();
    }
    expect(verifyStatusToken(forge({ u: U, p: null, r: "guest", iat }), NOW)).not.toBeNull();
  });
});
