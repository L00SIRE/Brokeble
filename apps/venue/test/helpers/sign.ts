// Test-only signer built from the shared tap.ts primitives (the production signer lives in apps/agent/src/tap).
import { generateKeyPairSync, createPublicKey, randomBytes, sign as cryptoSign, type JsonWebKey, type KeyObject } from "node:crypto";
import { LABEL, SIGN_TTL_S, contentDigest, requiredComponents, routeTag, signatureBase, signatureParams } from "@tab/shared/tap";
import type { NonceStore } from "../../src/tap/verify";

export const AUTHORITY = "venue.test";
export const KEYID = "test-key-1";
const kp = generateKeyPairSync("ed25519");
export const priv: KeyObject = kp.privateKey;
export const keys: Record<string, JsonWebKey> = { [KEYID]: createPublicKey(priv).export({ format: "jwk" }) };

export function memNonces(): NonceStore & { map: Map<string, number> } {
  const map = new Map<string, number>();
  return {
    map,
    async seen(n) {
      const t = map.get(n);
      return t === undefined ? null : 1;
    },
    async record(n) {
      if (map.has(n)) return false;
      map.set(n, Date.now());
      return true;
    },
  };
}

export type SignOpts = { tag?: string; created?: number; expires?: number; nonce?: string; keyid?: string; alg?: string; drop?: string };

export function signedRequest(method: "GET" | "POST", path: string, body: string | null, now: number, o: SignOpts = {}) {
  const created = o.created ?? now;
  const expires = o.expires ?? created + SIGN_TTL_S;
  const components = requiredComponents(method);
  const digest = body !== null ? contentDigest(body) : undefined;
  let params = signatureParams(components, {
    created, expires, keyid: o.keyid ?? KEYID, nonce: o.nonce ?? randomBytes(16).toString("base64"), tag: o.tag ?? routeTag(method),
  });
  if (o.alg) params = params.replace('alg="ed25519"', `alg="${o.alg}"`);
  if (o.drop) params = params.replace(new RegExp(`;${o.drop}=("[^"]*"|\\d+)`), "");
  const base = signatureBase(components, { method, authority: AUTHORITY, path, contentDigest: digest }, params);
  const sig = cryptoSign(null, Buffer.from(base), priv).toString("base64");
  const headers = new Headers({ "signature-input": `${LABEL}=${params}`, signature: `${LABEL}=:${sig}:` });
  if (digest) headers.set("content-digest", digest);
  return { method, path, headers, body: Buffer.from(body ?? "") };
}
