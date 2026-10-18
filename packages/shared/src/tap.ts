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

// ---------- header parsers (C) ----------
export type ParsedSignatureInput = {
  label: string;
  /** Exact bytes after `label=`; this is the `@signature-params` value in the base. */
  raw: string;
  components: string[];
  params: Record<string, string | number>;
};

const SIG_INPUT = /^([A-Za-z][A-Za-z0-9_-]*)=(\(((?:"[^"]*"(?: "[^"]*")*)?)\)((?:;[a-z][a-z0-9_-]*=(?:-?\d+|"[^"]*"))*))$/;

/** Strict: exactly one `label=(components);k=int;k="string"` member, nothing else. Null on any deviation. */
export function parseSignatureInput(h: string): ParsedSignatureInput | null {
  const m = SIG_INPUT.exec(h.trim());
  if (!m) return null;
  const [, label, raw, inner, tail] = m;
  const components = inner ? [...inner.matchAll(/"([^"]*)"/g)].map((x) => x[1]!) : [];
  const params: Record<string, string | number> = {};
  for (const p of (tail ?? "").matchAll(/;([a-z][a-z0-9_-]*)=(-?\d+|"[^"]*")/g)) {
    const key = p[1]!;
    if (key in params) return null; // duplicate parameter
    const v = p[2]!;
    params[key] = v.startsWith('"') ? v.slice(1, -1) : Number(v);
  }
  return { label: label!, raw: raw!, components, params };
}

/** `label=:<base64>:` → raw signature bytes, or null. */
export function parseSignature(h: string, label: string): Buffer | null {
  const m = /^([A-Za-z][A-Za-z0-9_-]*)=:([A-Za-z0-9+/]+={0,2}):$/.exec(h.trim());
  if (!m || m[1] !== label) return null;
  return Buffer.from(m[2]!, "base64");
}
