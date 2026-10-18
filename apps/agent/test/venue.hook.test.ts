import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyVenueHook } from "../src/venueClient/hook";
import { runTapTest } from "../src/venueClient/tapTest";
import { failedSteps } from "../src/venueClient/sweep";
import { MockVenue } from "../src/ports/venue.mock";

const secret = "s".repeat(32);
const ev = {
  event_id: "evt_abcdefghijklmnop", at: new Date().toISOString(), order_id: "ord_x", plan_ref: crypto.randomUUID(),
  type: "share.authorized", share_id: "shr_x", payer_ref: "0".repeat(32), data: { amount_cents: 3000 },
};
const sign = (raw: string, ts: number) => `sha256=${createHmac("sha256", secret).update(`${ts}.${raw}`).digest("hex")}`;
const hdrs = (raw: string, ts = 1000, sig = sign(raw, ts)) => new Headers({ "x-tab-timestamp": String(ts), "x-tab-signature": sig });

describe("verifyVenueHook", () => {
  const raw = JSON.stringify(ev);
  it("accepts a valid signature over the raw bytes", () => {
    expect(verifyVenueHook(raw, hdrs(raw), secret, () => 1000)?.event_id).toBe(ev.event_id);
  });
  it("rejects stale timestamps, bad signatures and re-serialized bodies", () => {
    expect(verifyVenueHook(raw, hdrs(raw), secret, () => 1000 + 301)).toBeNull();
    expect(verifyVenueHook(raw, hdrs(raw, 1000, "sha256=" + "0".repeat(64)), secret, () => 1000)).toBeNull();
    const pretty = JSON.stringify(ev, null, 1);
    expect(verifyVenueHook(pretty, hdrs(raw), secret, () => 1000)).toBeNull();
    expect(verifyVenueHook(raw, new Headers(), secret, () => 1000)).toBeNull();
  });
  it("rejects a valid HMAC over a malformed event", () => {
    const bad = JSON.stringify({ ...ev, type: "nope" });
    expect(verifyVenueHook(bad, hdrs(bad), secret, () => 1000)).toBeNull();
  });
});

describe("failedSteps (venue sweep 500 body)", () => {
  it("keeps step names only", () => {
    expect(failedSteps({ ok: false, failed: ["g_outbox", "d_cancelling"] })).toEqual(["g_outbox", "d_cancelling"]);
    expect(failedSteps({ failed: ["ok", "postgres://user:pw@host/db", 7, "x".repeat(41)] })).toEqual(["ok"]);
    expect(failedSteps(null)).toEqual([]);
    expect(failedSteps("<html>")).toEqual([]);
  });
  it("appends each step's error code when it is a plain code token", () => {
    expect(failedSteps({ failed: ["a_stale", "h_nonces", "init"], codes: { a_stale: "XX000", h_nonces: "CONNECT_TIMEOUT", init: "ZodError" } }))
      .toEqual(["a_stale=XX000", "h_nonces=CONNECT_TIMEOUT", "init=ZodError"]);
    expect(failedSteps({ failed: ["a_stale", "b_x", "c_y"], codes: { a_stale: "password=hunter2", b_x: 42, toString: "X" } }))
      .toEqual(["a_stale", "b_x", "c_y"]);
    expect(failedSteps({ failed: ["toString"], codes: {} })).toEqual([]); // not a step name ([a-z0-9_] only)
    expect(failedSteps({ failed: ["a_stale"], codes: "XX000" })).toEqual(["a_stale"]);
  });
});

describe("runTapTest", () => {
  it("refuses replay while the first leg would capture", async () => {
    const venue = new MockVenue();
    const o = await venue.createOrder({
      plan_ref: crypto.randomUUID(), plan_version: 1, party_size: 2, payer_refs: ["a".repeat(32), "b".repeat(32)], deadline_at: new Date(Date.now() + 3.6e6).toISOString(),
      bundle: { bundle_key: "bnd_0123456789", date: "2026-10-18", dinner: { name: "D", address: "addr 1", time: "18:00", est_high_pp_usd: 20 }, show: { name: "S", address: "addr 2", time: "20:00", est_high_pp_usd: 10 } },
    });
    for (const s of o.shares) venue.authorize(s.share_id);
    await expect(runTapTest("replay", o.order_id, venue)).rejects.toThrow(/refused/);
    expect((await runTapTest("tamper", o.order_id, venue)).expected_step).toBe(6);
  });

  it("runs when a share has no payment id yet (APPROVING with someone unpaid, after a cancel or release)", async () => {
    const order = {
      order_id: "ord_x", plan_ref: crypto.randomUUID(), plan_version: 1, status: "OPEN" as const, total_cents: 6000, updated_at: new Date().toISOString(),
      shares: [
        { share_id: "shr_a", payer_ref: "a".repeat(32), amount_cents: 3000, status: "AUTHORIZED" as const, cybs_payment_id: "7000000000000000000001", card_last4: "1111" },
        { share_id: "shr_b", payer_ref: "b".repeat(32), amount_cents: 3000, status: "PENDING" as const, cybs_payment_id: null, card_last4: null },
      ],
    };
    const sent: unknown[] = [];
    const venue = {
      getOrder: async () => order,
      commit: async (_id: string, consent: unknown, kind: unknown) => (sent.push({ consent, kind }), { order_id: "ord_x", result: "rejected" as const, tap: null as never, captures: [] }),
    } as unknown as MockVenue;
    for (const kind of ["tamper", "wrong_tag", "expired", "replay"] as const) {
      await expect(runTapTest(kind, "ord_x", venue)).resolves.toMatchObject({ result: "rejected" });
    }
    expect(sent[0]).toEqual({
      kind: "tamper",
      consent: { order_id: "ord_x", total_cents: 6000, shares: [
        { share_id: "shr_a", cybs_payment_id: "7000000000000000000001", amount_cents: 3000 },
        { share_id: "shr_b", cybs_payment_id: "", amount_cents: 3000 },
      ] },
    });
  });
});
