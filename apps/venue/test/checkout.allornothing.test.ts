import { describe, expect, it } from "vitest";
import { canonicalConsent } from "@tab/shared/tap";
import { decideCommit, rebuildConsent, type CommitOrder, type CommitShare } from "../src/orders/commit";

const order: CommitOrder = { id: "ord_1", status: "OPEN", total_cents: 6000 };
const shares = (over: Partial<CommitShare>[] = []): CommitShare[] =>
  [0, 1].map((i) => ({ id: `shr_${i}`, status: "AUTHORIZED", amount_cents: 3000, cybs_payment_id: `pay_${i}`, ...over[i] }));
const body = (s = shares(), o = order) => Buffer.from(rebuildConsent(o, s));

describe("decideCommit (M4)", () => {
  it("accepts the exact canonical bytes when every share is authorized", () => {
    expect(decideCommit(order, shares(), body()).kind).toBe("proceed");
  });
  it("rejects when one share is still PENDING", () => {
    const s = shares([{}, { status: "PENDING", cybs_payment_id: null }]);
    const d = decideCommit(order, s, body(s));
    expect(d.kind).toBe("rejected");
    expect(d.business.all_authorized).toBe(false);
  });
  it("rejects when shares do not sum to the total", () => {
    const o = { ...order, total_cents: 6100 };
    const d = decideCommit(o, shares(), body(shares(), o));
    expect(d.kind).toBe("rejected");
    expect(d.business.sum_matches).toBe(false);
  });
  it("rejects a $1 change, re-ordered shares or re-ordered keys", () => {
    const forged = canonicalConsent({ order_id: "ord_1", total_cents: 6000, shares: [{ share_id: "shr_0", cybs_payment_id: "pay_0", amount_cents: 3100 }, { share_id: "shr_1", cybs_payment_id: "pay_1", amount_cents: 3000 }] });
    expect(decideCommit(order, shares(), Buffer.from(forged)).business.consent_matches).toBe(false);
    const unordered = JSON.stringify({ total_cents: 6000, order_id: "ord_1", shares: JSON.parse(rebuildConsent(order, shares())).shares });
    expect(decideCommit(order, shares(), Buffer.from(unordered)).business.consent_matches).toBe(false);
    const swapped = JSON.stringify({ order_id: "ord_1", total_cents: 6000, shares: JSON.parse(rebuildConsent(order, shares())).shares.reverse() });
    expect(decideCommit(order, shares(), Buffer.from(swapped)).business.consent_matches).toBe(false);
  });
  it("is idempotent on CAPTURED with a matching body, rejects other non-OPEN states", () => {
    const cap = { ...order, status: "CAPTURED" };
    const s = shares([{ status: "CAPTURED" }, { status: "CAPTURED" }]);
    expect(decideCommit(cap, s, body(s, cap)).kind).toBe("idempotent");
    expect(decideCommit({ ...order, status: "CANCELLED" }, shares(), body()).kind).toBe("not_open");
    expect(decideCommit(cap, s, Buffer.from("{}")).kind).toBe("not_open");
  });
});
