// Venue-side TAP verifier: the spec's six checks, stopping at the first failure. Pure core; nonce store injected.
import { createPublicKey, verify as cryptoVerify, type JsonWebKey } from "node:crypto";
import type { TapStep, TapVerifyReport } from "@tab/shared";
import {
  LABEL,
  MAX_WINDOW_S,
  TAG,
  contentDigest,
  parseSignature,
  parseSignatureInput,
  requiredComponents,
  routeTag,
  signatureBase,
  type TapComponent,
} from "@tab/shared/tap";

export type NonceStore = {
  /** Seconds since the nonce was recorded, or null if unseen within the 8-minute window. */
  seen(nonce: string): Promise<number | null>;
  /** True if this call recorded it; false if another request won the race. */
  record(nonce: string): Promise<boolean>;
};

export type TapDeps = {
  now: () => number; // unix seconds
  authority: string; // VENUE_PUBLIC_HOST, never the Host header
  keys: Record<string, JsonWebKey>;
  nonces: NonceStore;
};

const SKEW_S = 5;
const NAMES: TapStep["name"][] = ["tag", "params", "timestamps", "nonce", "key", "signature"];

export async function verifyTap(
  req: { method: string; path: string; headers: Headers; body: Uint8Array },
  d: TapDeps,
): Promise<TapVerifyReport> {
  const method = req.method.toUpperCase();
  const route = `${method} ${req.path}`;
  const steps: TapStep[] = [];
  let tag: string | null = null;
  let base = "";

  const fail = (n: number, detail: string): TapVerifyReport => {
    steps.push({ n, name: NAMES[n - 1]!, ok: false, detail });
    return { route, tag, steps, business: null, accepted: false, reason: detail, signature_base: base };
  };
  const pass = (n: number, detail: string) => steps.push({ n, name: NAMES[n - 1]!, ok: true, detail });

  const sigInputHeader = req.headers.get("signature-input");
  const sigHeader = req.headers.get("signature");
  const parsed = sigInputHeader ? parseSignatureInput(sigInputHeader) : null;
  if (parsed && typeof parsed.params.tag === "string") tag = parsed.params.tag;

  // 1. tag
  const wantTag = routeTag(method);
  if (!parsed) return fail(1, sigInputHeader ? "malformed Signature-Input" : "missing Signature-Input");
  if (tag !== TAG.browse && tag !== TAG.pay) return fail(1, `unknown tag ${tag ?? "(none)"}`);
  if (tag !== wantTag) return fail(1, `tag ${tag} not allowed on ${route}`);
  pass(1, `${tag} on ${method}`);

  // 2. params
  const p = parsed.params;
  for (const k of ["created", "expires", "keyid", "alg", "nonce", "tag"]) if (!(k in p)) return fail(2, `missing ${k}`);
  if (typeof p.created !== "number" || typeof p.expires !== "number") return fail(2, "created/expires must be integers");
  if (typeof p.keyid !== "string" || typeof p.nonce !== "string" || typeof p.alg !== "string") return fail(2, "keyid/alg/nonce must be strings");
  if (p.alg.toLowerCase() !== "ed25519") return fail(2, `unsupported alg ${p.alg}`);
  if (parsed.label !== LABEL) return fail(2, `unexpected signature label ${parsed.label}`);
  for (const c of requiredComponents(method)) if (!parsed.components.includes(c)) return fail(2, `missing ${c}`);
  const unsupported = parsed.components.find((c) => !(["@method", "@authority", "@path", "content-digest"] as string[]).includes(c));
  if (unsupported) return fail(2, `unsupported component ${unsupported}`);
  pass(2, "created, expires, keyid, alg, nonce, tag present");

  // 3. timestamps
  const now = d.now();
  if (p.created > now + SKEW_S) return fail(3, `created ${p.created - now}s in the future`);
  if (p.expires <= now) return fail(3, `expired ${now - p.expires}s ago`);
  if (p.expires - p.created > MAX_WINDOW_S) return fail(3, `window ${p.expires - p.created}s exceeds ${MAX_WINDOW_S}s`);
  pass(3, `valid for ${p.expires - now}s more`);

  // 4. nonce
  const seenAgo = await d.nonces.seen(p.nonce);
  if (seenAgo !== null) return fail(4, `nonce replayed (seen ${seenAgo}s ago)`);
  pass(4, "nonce unseen");

  // 5. key
  const jwk = d.keys[p.keyid];
  if (!jwk) return fail(5, `unknown keyid ${p.keyid}`);
  let pub;
  try {
    pub = createPublicKey({ key: jwk, format: "jwk" });
  } catch {
    return fail(5, `key ${p.keyid} unusable`);
  }
  pass(5, `key ${p.keyid} resolved (mock directory)`);

  // 6. signature
  const comps = parsed.components as TapComponent[];
  let digest: string | undefined;
  if (comps.includes("content-digest")) {
    digest = req.headers.get("content-digest") ?? undefined;
    if (!digest) return fail(6, "content-digest header missing");
    if (digest !== contentDigest(req.body)) return fail(6, "content-digest mismatch: body changed after signing");
  }
  base = signatureBase(comps, { method, authority: d.authority, path: req.path, contentDigest: digest }, parsed.raw);
  const sig = sigHeader ? parseSignature(sigHeader, parsed.label) : null;
  if (!sig) return fail(6, "malformed Signature");
  if (!cryptoVerify(null, Buffer.from(base), pub, sig)) return fail(6, "signature does not verify");
  if (!(await d.nonces.record(p.nonce))) return fail(6, "nonce replayed (lost race)");
  pass(6, "Ed25519 signature verified");

  return { route, tag, steps, business: null, accepted: true, reason: null, signature_base: base };
}
