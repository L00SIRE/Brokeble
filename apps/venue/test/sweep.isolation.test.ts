// The sweep isolates every step and every row: one throwing query or one bad order never blocks the rest,
// above all (g) outbox redelivery. Pure unit test: db, outbox and order helpers are mocked.
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  queries: [] as string[],
  throwOn: [] as RegExp[],
  rows: [] as [RegExp, unknown[]][],
  deliver: vi.fn(async (ids: number[]) => ids.length),
  finishCancel: vi.fn(async (_id: string, _r: string) => {}),
  cancelOrder: vi.fn(async (_id: string, _r: string) => null),
  reverseShare: vi.fn(async (_id: string) => "pending" as const),
}));

vi.mock("../src/db", () => {
  const q = (strings: TemplateStringsArray) => {
    const text = strings.join("?").replace(/\s+/g, " ");
    h.queries.push(text);
    const bad = h.throwOn.find((re) => re.test(text));
    if (bad) return Promise.reject(Object.assign(new Error("boom: secret-looking detail"), { code: "XX000" }));
    return Promise.resolve(h.rows.find(([re]) => re.test(text))?.[1] ?? []);
  };
  return { sql: () => Object.assign(q, { begin: async (f: (tx: typeof q) => unknown) => f(q), json: (v: unknown) => v }) };
});
vi.mock("../src/outbox", () => ({ deliver: h.deliver, enqueue: vi.fn(async () => 99) }));
vi.mock("../src/orders/cancel", () => ({
  MAX_REJECTED_REVERSALS: 5,
  finishCancel: h.finishCancel,
  cancelOrder: h.cancelOrder,
  reverseShare: h.reverseShare,
}));
vi.mock("../src/orders/store", () => ({ payUrl: () => "", rotateToken: async () => ({}) }));
vi.mock("../src/payments", () => ({ runOp: vi.fn() }));
vi.mock("../src/cybs", () => ({ cybsService: () => ({}), timeoutReversalDone: () => false }));

const { sweep } = await import("../src/sweep");

describe("sweep isolation", () => {
  beforeEach(() => {
    h.queries.length = 0;
    h.throwOn = [];
    h.rows = [];
    vi.clearAllMocks();
  });

  it("all steps ok → ok:true, failed:[]", async () => {
    const r = await sweep();
    expect(r).toMatchObject({ ok: true, failed: [], codes: {} });
  });

  it("outbox redelivery runs first and still runs when every other step throws", async () => {
    h.rows = [[/from venue\.outbox/, [{ id: "7" }, { id: "8" }]]];
    h.throwOn = [/AUTHORIZING/, /AUTH_UNKNOWN/, /status = 'OPEN'/, /status = 'CANCELLING'/, /REVERSING/, /COMMITTING/, /tap_nonces/];
    const errs = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await sweep();
    expect(h.queries[0]).toMatch(/from venue\.outbox/);
    expect(h.deliver).toHaveBeenCalledWith([7, 8]);
    expect(r.outbox_delivered).toBe(2);
    expect(r.ok).toBe(false);
    expect(r.failed).toEqual(["a_stale", "b_timeout_reverse", "c_deadline", "d_cancelling", "e_stuck_reversals", "e2_reversal_cap", "f_committing", "h_nonces"]);
    // logs and the response carry the step and the error code only, never the message
    expect(errs).toHaveBeenCalledWith("venue sweep step failed", "a_stale", "XX000");
    expect(JSON.stringify(errs.mock.calls)).not.toContain("secret-looking");
    expect(r.codes).toEqual(Object.fromEntries(r.failed.map((s) => [s, "XX000"])));
    expect(JSON.stringify(r)).not.toContain("secret-looking");
    errs.mockRestore();
  });

  it("one bad order does not stop the others in the same step", async () => {
    h.rows = [[/where status = 'CANCELLING'$/, [{ id: "ord_a" }, { id: "ord_b" }, { id: "ord_c" }]]];
    h.finishCancel.mockImplementation(async (id: string) => {
      if (id === "ord_a") throw Object.assign(new Error("x"), { code: "23505" });
    });
    const errs = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await sweep();
    expect(h.finishCancel.mock.calls.map((c) => c[0])).toEqual(["ord_a", "ord_b", "ord_c"]);
    expect(r.failed).toEqual(["d_cancelling"]);
    expect(r.codes).toEqual({ d_cancelling: "23505" }); // the first code per step
    expect(h.queries.some((q) => /tap_nonces/.test(q))).toBe(true); // later steps still ran
    errs.mockRestore();
  });
});
