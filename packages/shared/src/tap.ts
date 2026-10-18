// Shared pure TAP helpers (PLAN §8 "TAP header and consent-digest format"), used by the agent signer AND the venue verifier.
// Import via "@tab/shared/tap" only: node:crypto must never reach the apps/web bundle.
// C owns the signer, the verifier and the header parsers; this file holds only the byte-exact formats both sides must agree on.
import { createHash } from "node:crypto";
import type { ConsentSet, OrderStatus } from "./index";

export const TAG = { browse: "agent-browser-auth", pay: "agent-payer-auth" } as const;
export type TapTag = (typeof TAG)[keyof typeof TAG];
export const LABEL = "sig2";
export const MAX_WINDOW_S = 480; // spec: created/expires at most 8 min apart; nonces kept 8 min
export const SIGN_TTL_S = 120; // we sign expires = created + 120

export type TapComponent = "@method" | "@authority" | "@path" | "content-digest";

/** Exact request body bytes for POST /checkout/{orderId}: keys order_id, total_cents, shares; shares sorted by share_id; no whitespace. */
export function canonicalConsent(c: ConsentSet): string {
  const shares = [...c.shares]
    .sort((a, b) => (a.share_id < b.share_id ? -1 : a.share_id > b.share_id ? 1 : 0))
    .map((s) => ({ share_id: s.share_id, cybs_payment_id: s.cybs_payment_id, amount_cents: s.amount_cents }));
  return JSON.stringify({ order_id: c.order_id, total_cents: c.total_cents, shares });
}

/** Agent side: the consent set for an order whose shares are all authorized. Throws if any share has no payment id. */
export function consentFromOrder(o: OrderStatus): ConsentSet {
  return {
    order_id: o.order_id,
    total_cents: o.total_cents,
    shares: o.shares.map((s) => {
      if (s.cybs_payment_id === null) throw new Error(`share ${s.share_id} has no cybs_payment_id`);
      return { share_id: s.share_id, cybs_payment_id: s.cybs_payment_id, amount_cents: s.amount_cents };
    }),
  };
}

/** RFC 9530 Content-Digest value: `sha-256=:<base64>:`. */
export function contentDigest(body: Uint8Array | string): string {
  return `sha-256=:${createHash("sha256").update(body).digest("base64")}:`;
}

export const routeTag = (method: string): TapTag => (method.toUpperCase() === "GET" ? TAG.browse : TAG.pay);

export const requiredComponents = (method: string): TapComponent[] =>
  method.toUpperCase() === "GET"
    ? ["@method", "@authority", "@path"]
    : ["@method", "@authority", "@path", "content-digest"];

export type SignatureParamsInput = { created: number; expires: number; keyid: string; nonce: string; tag: string };

/** The exact bytes after `sig2=` in Signature-Input; also the `@signature-params` value in the base. */
export function signatureParams(components: readonly TapComponent[], p: SignatureParamsInput): string {
  const list = components.map((c) => `"${c}"`).join(" ");
  return `(${list});created=${p.created};expires=${p.expires};keyid="${p.keyid}";alg="ed25519";nonce="${p.nonce}";tag="${p.tag}"`;
}

export type SignatureBaseValues = { method: string; authority: string; path: string; contentDigest?: string };

/** RFC 9421 signature base: one line per component, then @signature-params; LF-joined, no trailing LF. */
export function signatureBase(components: readonly TapComponent[], v: SignatureBaseValues, params: string): string {
  const line = (c: TapComponent): string => {
    switch (c) {
      case "@method":
        return `"@method": ${v.method.toUpperCase()}`;
      case "@authority":
        return `"@authority": ${v.authority.toLowerCase()}`; // verifier passes VENUE_PUBLIC_HOST, never the Host header
      case "@path":
        return `"@path": ${v.path}`;
      case "content-digest":
        if (!v.contentDigest) throw new Error("content-digest component requires a contentDigest value");
        return `"content-digest": ${v.contentDigest}`;
    }
  };
  return [...components.map(line), `"@signature-params": ${params}`].join("\n");
}

export const signatureInputHeader = (params: string): string => `${LABEL}=${params}`;
export const signatureHeader = (signature: Uint8Array): string => `${LABEL}=:${Buffer.from(signature).toString("base64")}:`;
