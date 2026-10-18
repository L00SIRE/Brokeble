import { describe, expect, it } from "vitest";
import { pageState } from "../src/orders/authorize";
import type { OrderRow, ShareRow } from "../src/orders/store";

const now = new Date("2026-10-18T12:00:00Z");
const later = new Date(now.getTime() + 3_600_000);
const share = (o: Partial<ShareRow> = {}): ShareRow => ({
  id: "shr_1", order_id: "ord_1", payer_ref: "a", amount_cents: 3000, status: "PENDING", token_hash: Buffer.alloc(32),
  token_expires_at: later, token_used_at: null, cybs_payment_id: null, card_brand: null, card_last4: null, updated_at: now, ...o,
});
const order = (o: Partial<OrderRow> = {}): OrderRow => ({
  id: "ord_1", plan_ref: "x", plan_version: 1, status: "OPEN", bundle: {}, items: [], party_size: 2, total_cents: 6000, deadline_at: later, updated_at: now, ...o,
});

describe("pay page state (7 states)", () => {
  it("ready: PENDING, unused, unexpired, order OPEN", () => expect(pageState(share(), order(), now)).toBe("ready"));
  it("expired: unknown token, expired token, used token, past deadline", () => {
    expect(pageState(undefined, undefined, now)).toBe("expired");
    expect(pageState(share({ token_expires_at: new Date(now.getTime() - 1) }), order(), now)).toBe("expired");
    expect(pageState(share({ token_used_at: now }), order(), now)).toBe("expired");
    expect(pageState(share(), order({ deadline_at: new Date(now.getTime() - 1) }), now)).toBe("expired");
  });
  it("already held / booked", () => {
    expect(pageState(share({ status: "AUTHORIZED", token_used_at: now }), order(), now)).toBe("already_held");
    expect(pageState(share({ status: "CAPTURING" }), order({ status: "COMMITTING" }), now)).toBe("already_held");
    expect(pageState(share({ status: "CAPTURED" }), order({ status: "CAPTURED" }), now)).toBe("booked");
  });
  it("cancelled: order cancelling/cancelled or share void/released", () => {
    expect(pageState(share(), order({ status: "CANCELLING" }), now)).toBe("cancelled");
    expect(pageState(share({ status: "RELEASED" }), order({ status: "CANCELLED" }), now)).toBe("cancelled");
    expect(pageState(share({ status: "VOID" }), order(), now)).toBe("cancelled");
  });
  it("unconfirmed: in-flight or unknown authorization", () => {
    for (const status of ["AUTHORIZING", "AUTH_UNKNOWN", "TIMEOUT_REVERSING", "REVERSING"]) {
      expect(pageState(share({ status, token_used_at: now }), order(), now)).toBe("unconfirmed");
    }
  });
});
