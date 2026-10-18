// End-to-end money flow against a real Postgres (set TEST_DATABASE_URL; skipped otherwise). CYBS_MODE=mock.
import { createHmac, randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TapVerifyReport, VenueEvent } from "@tab/shared";
import { consentFromOrder, canonicalConsent } from "@tab/shared/tap";

const DB = process.env.TEST_DATABASE_URL;
const events: { ev: VenueEvent; ts: string; sig: string; raw: string }[] = [];
let hook: Server;

const tap: TapVerifyReport = { route: "POST /checkout/x", tag: "agent-payer-auth", steps: [], business: null, accepted: true, reason: null, signature_base: "" };
const ref = () => randomBytes(16).toString("hex");
const tokenOf = (url: string) => url.split("/pay/")[1]!;
const bundle = {
  bundle_key: "bnd_0123456789", date: "2026-10-18",
  dinner: { name: "Test Dinner", address: "1 Main St, Los Angeles", time: "18:00", est_high_pp_usd: 22 },
  show: { name: "Test Show", address: "2 Main St, Los Angeles", time: "20:00", est_high_pp_usd: 8 },
};
const deadline = () => new Date(Date.now() + 3_600_000).toISOString();

describe.skipIf(!DB)("venue money flow", () => {
  let M: {
    createOrder: typeof import("../src/orders/create").createOrder;
    authorize: typeof import("../src/orders/authorize").authorize;
    checkout: typeof import("../src/orders/checkout").checkout;
    cancelOrder: typeof import("../src/orders/cancel").cancelOrder;
    loadOrderView: typeof import("../src/orders/store").loadOrderView;
    sweep: typeof import("../src/sweep").sweep;
    sql: typeof import("../src/db").sql;
  };

  beforeAll(async () => {
    hook = createServer((req, res) => {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        events.push({ ev: JSON.parse(raw), ts: String(req.headers["x-tab-timestamp"]), sig: String(req.headers["x-tab-signature"]), raw });
        res.end("ok");
      });
    }).listen(0);
    const port = (hook.address() as AddressInfo).port;
    Object.assign(process.env, {
      DATABASE_URL: DB, VENUE_PUBLIC_URL: "http://localhost:3001", VENUE_PUBLIC_HOST: "localhost:3001", CYBS_MODE: "mock",
      TAP_KEY_DIRECTORY_JSON: "{}", AGENT_HOOK_URL: `http://127.0.0.1:${port}/hook`,
      VENUE_HOOK_SECRET: "h".repeat(32), VENUE_OPS_KEY: "o".repeat(32), PAY_LINK_TTL_MIN: "30",
    });
    M = {
      ...(await import("../src/orders/create")), ...(await import("../src/orders/authorize")), ...(await import("../src/orders/checkout")),
      ...(await import("../src/orders/cancel")), ...(await import("../src/orders/store")), ...(await import("../src/sweep")), ...(await import("../src/db")),
    } as never;
  });
  afterAll(async () => {
    hook.close();
    await M.sql().end();
  });

  const bill = (first_name: string) => ({ first_name, last_name: "T", postal_code: "90024" });
  async function newOrder(n = 2, refs?: string[]) {
    const r = await M.createOrder({ plan_ref: crypto.randomUUID(), plan_version: 1, bundle, party_size: n, payer_refs: refs ?? Array.from({ length: n }, ref), deadline_at: deadline() });
    expect(r.status).toBe(201);
    return r.body as import("@tab/shared").CreateOrderResponse;
  }
  const hold = async (url: string, first = "Alex") =>
    (await M.authorize(tokenOf(url), { save_card: false, sandbox_test_card: false, bill_to: bill(first) })) as { state: string; retry_url?: string };
  const wait = () => new Promise((r) => setTimeout(r, 150));

  it("prices from the bundle, rejects body amounts", async () => {
    const o = await newOrder();
    expect(o.total_cents).toBe(o.shares[0]!.amount_cents * 2);
    expect(o.items.reduce((n, i) => n + i.unit_price_pp_cents * i.qty, 0)).toBe(o.total_cents);
    await expect(M.createOrder({ plan_ref: crypto.randomUUID(), plan_version: 1, bundle, party_size: 2, payer_refs: [ref(), ref()], deadline_at: deadline(), total_cents: 1 })).rejects.toThrow();
  });

  it("decline → retry link; all held → capture-all; second commit is idempotent", async () => {
    const o = await newOrder();
    const [a, b] = o.shares as [typeof o.shares[number], typeof o.shares[number]];
    expect((await hold(a.pay_url)).state).toBe("held");
    const d = (await hold(b.pay_url, "decline")) as { state: string; retry_url: string };
    expect(d.state).toBe("declined");
    expect((await hold(b.pay_url)).state).toBe("expired"); // old token is dead

    // not every share authorized → nothing captured
    const view1 = (await M.loadOrderView(M.sql(), o.order_id))!;
    const bad = await M.checkout(o.order_id, Buffer.from("{}"), tap);
    expect(bad.result.result).toBe("rejected");
    expect(view1.shares.some((s) => s.status === "CAPTURED")).toBe(false);

    expect((await hold(d.retry_url)).state).toBe("held");
    const view = (await M.loadOrderView(M.sql(), o.order_id))!;
    const body = Buffer.from(canonicalConsent(consentFromOrder(view)));
    const r1 = await M.checkout(o.order_id, body, tap);
    expect(r1.result.result).toBe("captured");
    expect(r1.result.tap.business).toEqual({ all_authorized: true, sum_matches: true, consent_matches: true });
    const r2 = await M.checkout(o.order_id, body, tap);
    expect(r2.status).toBe(200);
    const [{ n }] = await M.sql()<{ n: number }[]>`select count(*)::int n from venue.payment_ops p join venue.shares s on s.id=p.share_id where s.order_id=${o.order_id} and p.op='capture'`;
    expect(n).toBe(2);
    await wait();
    expect(events.map((e) => e.ev.type)).toContain("order.captured");
  });

  it("tamper: a $1 change captures nothing; cancel releases every hold", async () => {
    const o = await newOrder(3);
    for (const s of o.shares) expect((await hold(s.pay_url)).state).toBe("held");
    const view = (await M.loadOrderView(M.sql(), o.order_id))!;
    const c = consentFromOrder(view);
    const forged = { ...c, shares: [{ ...c.shares[0]!, amount_cents: c.shares[0]!.amount_cents + 100 }, ...c.shares.slice(1)] };
    const r = await M.checkout(o.order_id, Buffer.from(canonicalConsent(forged)), tap);
    expect(r.result.result).toBe("rejected");
    expect(r.result.tap.business?.consent_matches).toBe(false);
    const after = (await M.loadOrderView(M.sql(), o.order_id))!;
    expect(after.status).toBe("OPEN");
    expect(after.shares.every((s) => s.status === "AUTHORIZED")).toBe(true);

    const cancelled = (await M.cancelOrder(o.order_id, "someone is out"))!;
    expect(cancelled.status).toBe("CANCELLED");
    expect(cancelled.shares.every((s) => s.status === "RELEASED")).toBe(true);
    expect(await M.cancelOrder(o.order_id, "again")).toMatchObject({ status: "CANCELLED" }); // idempotent
  });

  it("timeout → AUTH_UNKNOWN → sweep timeout-reverses and issues a fresh link", async () => {
    const o = await newOrder();
    const s = o.shares[0]!;
    expect((await hold(s.pay_url, "timeout")).state).toBe("unconfirmed");
    const [row] = await M.sql()<{ status: string }[]>`select status from venue.shares where id=${s.share_id}`;
    expect(row!.status).toBe("AUTH_UNKNOWN");
    await M.sql()`update venue.shares set updated_at = now() - interval '5 minutes' where id=${s.share_id}`;
    const out = await M.sweep();
    expect(out.timeout_reversed).toBeGreaterThanOrEqual(1);
    await wait();
    const rel = events.filter((e) => e.ev.type === "share.released" && e.ev.share_id === s.share_id).at(-1)!;
    expect(rel.ev.data.retry).toBe(true);
    expect(String(rel.ev.data.pay_url)).toContain("/pay/");
    expect((await hold(String(rel.ev.data.pay_url))).state).toBe("held"); // the fresh link works
  });

  it("two concurrent commits capture each share exactly once", async () => {
    const o = await newOrder();
    for (const s of o.shares) await hold(s.pay_url);
    const body = Buffer.from(canonicalConsent(consentFromOrder((await M.loadOrderView(M.sql(), o.order_id))!)));
    const [x, y] = await Promise.all([M.checkout(o.order_id, body, tap), M.checkout(o.order_id, body, tap)]);
    expect([x.result.result, y.result.result].filter((r) => r === "captured").length).toBeGreaterThanOrEqual(1);
    const rows = await M.sql()<{ share_id: string; n: number }[]>`select share_id, count(*)::int n from venue.payment_ops where op='capture' and share_id = any(${o.shares.map((s) => s.share_id)}) group by share_id`;
    expect(rows.every((r) => r.n === 1)).toBe(true);
  });

  it("past-deadline orders are cancelled by the sweep and holds released", async () => {
    const o = await newOrder();
    await hold(o.shares[0]!.pay_url);
    await M.sql()`update venue.orders set deadline_at = now() - interval '1 minute' where id=${o.order_id}`;
    await M.sweep();
    const v = (await M.loadOrderView(M.sql(), o.order_id))!;
    expect(v.status).toBe("CANCELLED");
    expect(v.shares.map((s) => s.status).sort()).toEqual(["RELEASED", "VOID"]);
  });

  it("save card, then a later plan is a one-tap hold with no card entry", async () => {
    const payer = ref();
    const first = await newOrder(2, [payer, ref()]);
    const r1 = (await M.authorize(tokenOf(first.shares[0]!.pay_url), { save_card: true, sandbox_test_card: false, bill_to: bill("Alex") })) as { state: string };
    expect(r1.state).toBe("held");
    const [cust] = await M.sql()<{ cybs_customer_id: string }[]>`select cybs_customer_id from venue.customers where payer_ref = ${payer}`;
    expect(cust).toBeDefined();
    expect(JSON.stringify(cust)).not.toMatch(/4111|number/);

    const second = await newOrder(2, [payer, ref()]);
    const share = second.shares.find((s) => s.payer_ref === payer)!;
    const r2 = (await M.authorize(tokenOf(share.pay_url), { save_card: false, sandbox_test_card: false, bill_to: bill("Alex") })) as { state: string; card: { last4: string } };
    expect(r2.state).toBe("held");
    expect(r2.card.last4).toBe("1111");
    const view = (await M.loadOrderView(M.sql(), second.order_id))!;
    expect(view.shares.find((s) => s.payer_ref === payer)!.status).toBe("AUTHORIZED");
  });

  it("a different payer never sees another payer's saved card", async () => {
    const o = await newOrder();
    const [c] = await M.sql()<{ n: number }[]>`select count(*)::int n from venue.customers where payer_ref = ${o.shares[0]!.payer_ref}`;
    expect(c!.n).toBe(0);
  });

  it("hook events carry a valid HMAC and never a pay token for authorized shares", async () => {
    await wait();
    expect(events.length).toBeGreaterThan(0);
    for (const e of events) {
      const want = createHmac("sha256", "h".repeat(32)).update(`${e.ts}.${e.raw}`).digest("hex");
      expect(e.sig).toBe(`sha256=${want}`);
      expect(e.ev.event_id).toMatch(/^evt_[a-z2-7]{16}$/);
      if (e.ev.type === "share.authorized") expect(JSON.stringify(e.ev)).not.toContain("/pay/");
    }
  });
});
