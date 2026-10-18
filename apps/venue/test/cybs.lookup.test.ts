// The "In Cybersource" lookup: allowlist mapping, timeout/degrade, cache, and the ops-key gate on the route.
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  mode: "live" as "live" | "mock",
  ops: [] as unknown[],
  get: vi.fn(),
}));

vi.mock("../src/env", () => ({
  env: () => ({
    CYBS_MODE: h.mode,
    CYBS_MERCHANT_ID: "testrest",
    CYBS_RUN_ENV: "apitest.cybersource.com",
    VENUE_OPS_KEY: "ops-key-0123456789",
  }),
}));
vi.mock("../src/db", () => {
  const q = (strings: TemplateStringsArray) => Promise.resolve(strings.join("?").includes("from venue.orders") ? [{ id: "ord_abcdefghij" }] : h.ops);
  return { sql: () => q };
});
vi.mock("../src/cybs/index", () => ({ cybsService: () => ({ getTransaction: h.get }) }));

const { buildReport, mapTransaction, clearLookupCache, LOOKUP_TIMEOUT_MS } = await import("../src/cybs/lookup");
const { GET } = await import("../app/ops/cybs-lookup/route");

// A TSS body with every personal field present, to prove none of them survive.
const TSS = {
  id: "7423519283746501",
  submitTimeUTC: "2026-10-18T14:03:22Z",
  merchantId: "testrest",
  applicationInformation: { status: "PENDING", reasonCode: "100", applications: [{ name: "ics_auth", rMessage: "Request was processed successfully." }, { name: "ics_bill" }] },
  orderInformation: {
    amountDetails: { totalAmount: "21.00", currency: "USD" },
    billTo: { firstName: "Ada", lastName: "Lovelace", email: "ada@example.com", postalCode: "94105", address1: "1 Market St" },
  },
  paymentInformation: { card: { type: "001", suffix: "1111", expirationMonth: "12", number: "4111111111111111" }, customer: { id: "TOKEN123" } },
  processorInformation: { processor: { name: "visanet" }, approvalCode: "831000" },
  tokenInformation: { instrumentidentifier: { id: "ABC" } },
};

beforeEach(() => {
  h.mode = "live";
  h.get.mockReset();
  clearLookupCache();
  h.ops = [
    { share_id: "shr_a", op: "auth", attempt: 1, status: "ok", cybs_id: "7423519283746501" },
    { share_id: "shr_a", op: "capture", attempt: 1, status: "ok", cybs_id: "7423519283746502" },
    { share_id: "shr_b", op: "auth", attempt: 1, status: "unknown", cybs_id: null },
  ];
});

describe("mapTransaction", () => {
  it("returns only allowlisted fields and no personal data", () => {
    const t = mapTransaction(TSS, "auth");
    expect(t).toEqual({
      operation: "Authorization hold",
      status: "PENDING",
      message: "Request was processed successfully.",
      reason_code: "100",
      amount: "21.00",
      currency: "USD",
      card_type: "Visa",
      card_last4: "1111",
      submit_time: "2026-10-18T14:03:22Z",
      processor: "visanet",
      merchant_id: "testrest",
    });
    const s = JSON.stringify(t);
    for (const bad of ["Ada", "Lovelace", "ada@", "94105", "Market", "TOKEN123", "4111111111111111", "ABC", "831000"]) expect(s).not.toContain(bad);
  });
  it("names the operation from the recorded op, and keeps a bare last4 of a long suffix", () => {
    expect(mapTransaction(TSS, "capture").operation).toBe("Capture");
    expect(mapTransaction({ paymentInformation: { card: { suffix: "4111111111111111" } } }, "reverse").card_last4).toBe("1111");
  });
  it("tolerates an empty or hostile body", () => {
    expect(mapTransaction(null, "reverse")).toMatchObject({ operation: "Reversal", status: null, card_last4: null });
    expect(mapTransaction({ applicationInformation: { status: { x: 1 } } }, "auth").status).toBeNull();
  });
});

describe("buildReport", () => {
  it("looks up each recorded id live and numbers shares without exposing share ids", async () => {
    h.get.mockResolvedValue({ kind: "ok", http: 200, data: TSS });
    const r = await buildReport(null);
    expect(r.environment).toBe("apitest.cybersource.com");
    expect(r.rows.map((x) => [x.seq, x.op, x.lookup])).toEqual([[1, "auth", "live"], [1, "capture", "live"], [2, "auth", "none"]]);
    expect(h.get).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(r)).not.toMatch(/shr_|Ada|ada@|TOKEN123/);
  });
  it("degrades per row on rejection, 404 and thrown errors; never throws", async () => {
    h.get
      .mockResolvedValueOnce({ kind: "rejected", http: 404, body: null })
      .mockResolvedValueOnce({ kind: "unknown", http: 503 });
    const r = await buildReport(null);
    expect(r.rows.map((x) => x.lookup)).toEqual(["pending", "unavailable", "none"]);
    h.get.mockReset();
    h.get.mockRejectedValue(new Error("boom"));
    expect((await buildReport(null)).rows[0]!.lookup).toBe("unavailable");
  });
  it("gives up on a hung lookup after the timeout", async () => {
    vi.useFakeTimers();
    try {
      h.get.mockReturnValue(new Promise(() => {}));
      const p = buildReport(null);
      await vi.advanceTimersByTimeAsync(LOOKUP_TIMEOUT_MS + 10);
      expect((await p).rows[0]!.lookup).toBe("unavailable");
    } finally {
      vi.useRealTimers();
    }
  });
  it("caches successes for a few seconds but retries failures", async () => {
    h.get.mockResolvedValue({ kind: "ok", http: 200, data: TSS });
    await buildReport(null);
    await buildReport(null);
    expect(h.get).toHaveBeenCalledTimes(2); // 2 ids, second report served from cache
    clearLookupCache();
    h.get.mockReset();
    h.get.mockResolvedValue({ kind: "unknown", http: 500 });
    await buildReport(null);
    await buildReport(null);
    expect(h.get).toHaveBeenCalledTimes(4);
  });
  it("does not call Cybersource for simulated ids", async () => {
    h.mode = "mock";
    const r = await buildReport(null);
    expect(h.get).not.toHaveBeenCalled();
    expect(r.environment).toBeNull();
    expect(r.rows.map((x) => x.lookup)).toEqual(["simulated", "simulated", "none"]);
  });
});

describe("GET /ops/cybs-lookup", () => {
  const call = (headers: Record<string, string> = {}, qs = "") => GET(new Request(`http://v/ops/cybs-lookup${qs}`, { headers }));
  it("is 401 without the ops key and never touches Cybersource", async () => {
    expect((await call()).status).toBe(401);
    expect((await call({ authorization: "Bearer wrong-key-0123456789" })).status).toBe(401);
    expect(h.get).not.toHaveBeenCalled();
  });
  it("rejects a malformed order id", async () => {
    expect((await call({ authorization: "Bearer ops-key-0123456789" }, "?order=x'%20or%201=1")).status).toBe(400);
  });
  it("returns the report with the ops key", async () => {
    h.get.mockResolvedValue({ kind: "ok", http: 200, data: TSS });
    const res = await call({ authorization: "Bearer ops-key-0123456789" });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { rows: unknown[] }).rows).toHaveLength(3);
  });
});
