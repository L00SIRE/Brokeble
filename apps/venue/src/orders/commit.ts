// Pure commit decision (M4): the consent set is rebuilt from the DB and compared byte-for-byte to the signed body.
import { canonicalConsent } from "@tab/shared/tap";
import type { TapVerifyReport } from "@tab/shared";

export type CommitOrder = { id: string; status: string; total_cents: number };
export type CommitShare = { id: string; status: string; amount_cents: number; cybs_payment_id: string | null };
type Business = NonNullable<TapVerifyReport["business"]>;

export type CommitDecision =
  | { kind: "idempotent"; business: Business }
  | { kind: "not_open"; business: Business }
  | { kind: "rejected"; business: Business }
  | { kind: "proceed"; business: Business };

export function rebuildConsent(o: CommitOrder, shares: CommitShare[]): string {
  return canonicalConsent({
    order_id: o.id,
    total_cents: o.total_cents,
    shares: shares.map((s) => ({ share_id: s.id, cybs_payment_id: s.cybs_payment_id ?? "", amount_cents: s.amount_cents })),
  });
}

export function decideCommit(o: CommitOrder, shares: CommitShare[], body: Buffer): CommitDecision {
  const consent_matches = body.equals(Buffer.from(rebuildConsent(o, shares)));
  const all_authorized = shares.length > 0 && shares.every((s) => s.status === "AUTHORIZED" && s.cybs_payment_id !== null);
  const sum_matches = shares.reduce((n, s) => n + s.amount_cents, 0) === o.total_cents;
  const business = { all_authorized, sum_matches, consent_matches };
  if (o.status === "CAPTURED" && consent_matches) return { kind: "idempotent", business };
  if (o.status !== "OPEN") return { kind: "not_open", business };
  if (!all_authorized || !sum_matches || !consent_matches) return { kind: "rejected", business };
  return { kind: "proceed", business };
}
