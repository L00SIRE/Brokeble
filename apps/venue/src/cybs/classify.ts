// Pure auth classification (M6). `unknown` NEVER maps to a retry.
import type { AuthResp, CybsOutcome } from "./service";

export type AuthClass =
  | { next: "AUTHORIZED"; reverse: false }
  | { next: "DECLINED"; reverse: boolean } // reverse:true → reverse first; DECLINED only if the reversal succeeds, else AUTH_UNKNOWN
  | { next: "AUTH_UNKNOWN"; reverse: false };

/** Statuses that may hold funds even though they are not a clean AUTHORIZED. */
const MAY_HOLD = new Set(["PARTIAL_AUTHORIZED", "AUTHORIZED_PENDING_REVIEW", "AUTHORIZED_RISK_DECLINED", "PENDING_REVIEW"]);

export function classifyAuth(o: CybsOutcome<AuthResp>): AuthClass {
  if (o.kind === "unknown") return { next: "AUTH_UNKNOWN", reverse: false };
  if (o.kind === "rejected") return { next: "DECLINED", reverse: false };
  const { status, id } = o.data;
  if (status === "AUTHORIZED" && id) return { next: "AUTHORIZED", reverse: false };
  if (id && status && MAY_HOLD.has(status)) return { next: "DECLINED", reverse: true };
  return { next: "DECLINED", reverse: false }; // DECLINED, INVALID_REQUEST, PENDING_AUTHENTICATION, or no id
}

/** A reversal outcome that means "no hold remains". */
export function reversalDone(o: CybsOutcome<any>): boolean {
  if (o.kind === "ok") return o.data?.status === "REVERSED";
  if (o.kind === "rejected") {
    const b = o.body as { reason?: string } | null;
    // testrest: a 2nd reversal of the same auth → 400 MISSING_AUTH (verified 2026-10-17)
    return b?.reason === "AUTH_ALREADY_REVERSED" || b?.reason === "MISSING_AUTH";
  }
  return false;
}

/** A timeout-reversal outcome that means "no hold remains". Anything else (401/403/404/429, 5xx, network) must NOT release the share. */
export function timeoutReversalDone(o: CybsOutcome<any>): boolean {
  if (o.kind === "ok") return o.data?.status === "REVERSED";
  if (o.kind === "rejected" && o.http === 400) {
    const reason = (o.body as { reason?: string } | null)?.reason;
    return reason === "INVALID_DATA" /* never-sent (verified) */ || reason === "AUTH_ALREADY_REVERSED" || reason === "MISSING_AUTH";
  }
  return false;
}

/** Brand and last4 from whichever response block Cybersource populated (UNVERIFIED which; PLAN §19). */
export function cardFromAuth(d: AuthResp, transientJwt?: string): { brand: string | null; last4: string | null } {
  const c = d.paymentAccountInformation?.card ?? d.paymentInformation?.card;
  let type = c?.type ?? null;
  let last4 = c?.suffix ?? null;
  if ((!type || !last4) && transientJwt) {
    try {
      // Microform v2 (mf-2.x) transient tokens carry card data at content.paymentInformation.card.number; older ones at data.
      const p = JSON.parse(Buffer.from(transientJwt.split(".")[1]!, "base64url").toString());
      const n = p?.content?.paymentInformation?.card?.number;
      const num: string | undefined = n?.maskedValue ?? p?.data?.number;
      const t = n?.detectedCardTypes?.[0] ?? p?.data?.type;
      if (!last4 && num) last4 = num.slice(-4);
      if (!type && t) type = String(t);
    } catch {
      /* masked data unavailable */
    }
  }
  return { brand: brandName(type), last4 };
}

const BRANDS: Record<string, string> = { "001": "VISA", "002": "MASTERCARD", "003": "AMEX", "004": "DISCOVER" };
const brandName = (t: string | null) => (t ? (BRANDS[t] ?? t.toUpperCase()) : null);

/** The only fields we persist from a Cybersource response (never a token or PAN). */
export function redact(d: any): Record<string, unknown> {
  return {
    id: d?.id,
    status: d?.status,
    errorInformation: d?.errorInformation ? { reason: d.errorInformation.reason } : undefined,
    tokenInformation: d?.tokenInformation
      ? { customer: { id: d.tokenInformation.customer?.id }, paymentInstrument: { id: d.tokenInformation.paymentInstrument?.id } }
      : undefined,
  };
}
