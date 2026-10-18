// Agent-side TAP signer (Visa Trusted Agent Protocol, RFC 9421 + RFC 9530). Ed25519; covers @method, @authority, @path and,
// on POSTs, content-digest. The private key never leaves this process.
import { createPrivateKey, randomBytes, sign as cryptoSign, type KeyObject } from "node:crypto";
import {
  SIGN_TTL_S,
  contentDigest,
  requiredComponents,
  routeTag,
  signatureBase,
  signatureHeader,
  signatureInputHeader,
  signatureParams,
} from "@tab/shared/tap";

export type SignOpts = { tag?: string; created?: number; expires?: number };
export type SignedHeaders = Record<string, string> & { "Signature-Input": string; Signature: string };

export type Signer = {
  keyId: string;
  sign(method: "GET" | "POST", url: URL, body: Uint8Array | null, o?: SignOpts): SignedHeaders;
};

export function createSigner(cfg: { keyId: string; privateKeyPemB64: string }): Signer {
  const priv: KeyObject = createPrivateKey(Buffer.from(cfg.privateKeyPemB64, "base64").toString("utf8"));
  return {
    keyId: cfg.keyId,
    sign(method, url, body, o = {}) {
      const now = Math.floor(Date.now() / 1000);
      const created = o.created ?? now;
      const expires = o.expires ?? created + SIGN_TTL_S;
      const components = requiredComponents(method);
      const digest = body ? contentDigest(body) : undefined;
      const params = signatureParams(components, {
        created, expires, keyid: cfg.keyId, nonce: randomBytes(32).toString("base64"), tag: o.tag ?? routeTag(method),
      });
      const base = signatureBase(components, { method, authority: url.host, path: url.pathname, contentDigest: digest }, params);
      const sig = cryptoSign(null, Buffer.from(base), priv);
      return {
        "Signature-Input": signatureInputHeader(params),
        Signature: signatureHeader(sig),
        ...(digest ? { "Content-Digest": digest } : {}),
      };
    },
  };
}

let cached: Signer | undefined;
/** Default signer from env (VENUE_MODE=live guarantees both vars). */
export async function signer(): Promise<Signer> {
  if (cached) return cached;
  const { env } = await import("../env");
  return (cached = createSigner({ keyId: env.TAP_KEY_ID!, privateKeyPemB64: env.TAP_PRIVATE_KEY_PEM_B64! }));
}
