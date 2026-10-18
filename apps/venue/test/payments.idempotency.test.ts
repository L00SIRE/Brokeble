import { describe, expect, it } from "vitest";
import { cardFromAuth, classifyAuth, reversalDone, type CybsOutcome, type AuthResp } from "../src/cybs";
import { opIds } from "../src/ids";

const ok = (data: AuthResp): CybsOutcome<AuthResp> => ({ kind: "ok", http: 201, data });

describe("opIds (M6)", () => {
  it("is deterministic in code, unique in transactionId, within Cybersource limits", () => {
    const a = opIds("shr_abcdefghij", "timeout_reverse", 3);
    const b = opIds("shr_abcdefghij", "timeout_reverse", 3);
    expect(a.code).toBe(b.code);
    expect(a.code).toBe("shr_abcdefghij-timeout_reverse-3");
    expect(a.code.length).toBeLessThanOrEqual(59);
    expect(a.transactionId).toMatch(/^[0-9a-f]{30}$/);
    expect(a.transactionId).not.toBe(b.transactionId);
  });
});

describe("classifyAuth", () => {
  it("AUTHORIZED with an id → AUTHORIZED, no reversal", () => {
    expect(classifyAuth(ok({ id: "1", status: "AUTHORIZED" }))).toEqual({ next: "AUTHORIZED", reverse: false });
  });
  it("AUTHORIZED without an id is not trusted", () => {
    expect(classifyAuth(ok({ status: "AUTHORIZED" })).next).toBe("DECLINED");
  });
  it("statuses that may hold funds are reversed before being called declined", () => {
    for (const status of ["PARTIAL_AUTHORIZED", "AUTHORIZED_PENDING_REVIEW", "AUTHORIZED_RISK_DECLINED", "PENDING_REVIEW"]) {
      expect(classifyAuth(ok({ id: "1", status }))).toEqual({ next: "DECLINED", reverse: true });
    }
  });
  it("DECLINED / INVALID_REQUEST / PENDING_AUTHENTICATION never trigger a reversal", () => {
    for (const status of ["DECLINED", "INVALID_REQUEST", "PENDING_AUTHENTICATION"]) {
      expect(classifyAuth(ok({ id: "1", status }))).toEqual({ next: "DECLINED", reverse: false });
    }
    expect(classifyAuth({ kind: "rejected", http: 400, body: {} })).toEqual({ next: "DECLINED", reverse: false });
  });
  it("unknown NEVER maps to a retry", () => {
    for (const http of [null, 500, 503]) {
      const c = classifyAuth({ kind: "unknown", http });
      expect(c).toEqual({ next: "AUTH_UNKNOWN", reverse: false });
      expect(JSON.stringify(c)).not.toMatch(/retry/i);
    }
  });
});

describe("reversal + card helpers", () => {
  it("AUTH_ALREADY_REVERSED counts as released; unknown does not", () => {
    expect(reversalDone({ kind: "ok", http: 201, data: { status: "REVERSED" } })).toBe(true);
    expect(reversalDone({ kind: "rejected", http: 400, body: { reason: "AUTH_ALREADY_REVERSED" } })).toBe(true);
    expect(reversalDone({ kind: "rejected", http: 400, body: { reason: "OTHER" } })).toBe(false);
    expect(reversalDone({ kind: "unknown", http: null })).toBe(false);
  });
  it("reads brand/last4 from either response block", () => {
    expect(cardFromAuth({ paymentAccountInformation: { card: { suffix: "1111", type: "001" } } })).toEqual({ brand: "VISA", last4: "1111" });
    expect(cardFromAuth({ paymentInformation: { card: { suffix: "4444", type: "002" } } })).toEqual({ brand: "MASTERCARD", last4: "4444" });
  });
});
