// A plan T5: render/format rules, notify ledger semantics (notify.idempotency), fan-out counts + xray.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { COPY, TemplateId, VARS, type PublicBundle } from "@tab/shared";

const db = vi.hoisted(() => ({
  routes: new Map<string, { userId: string; spaceId: string; agentUserId: string }>(),
  outbound: new Map<string, string>(), // key → status
  recipients: [] as { plan_id: string; user_id: string; lane: number; stage: string; joined_at: Date; first_name: string; payer_ref: string }[],
  events: [] as unknown[],
  planState: "RESEARCHING",
}));

vi.mock("../repo/dmRoutes", () => ({
  getDmRoute: vi.fn(async (u: string) => db.routes.get(u) ?? null),
  deleteDmRoute: vi.fn(async (u: string) => void db.routes.delete(u)),
}));
vi.mock("../repo/outbound", () => ({
  claimOutbound: vi.fn(async (c: { idempotency_key: string }) => {
    const s = db.outbound.get(c.idempotency_key);
    if (s === "accepted" || s === "blocked_inbound") return false;
    db.outbound.set(c.idempotency_key, "pending");
    return true;
  }),
  markOutboundAccepted: vi.fn(async (k: string) => void db.outbound.set(k, "accepted")),
  markOutboundFailed: vi.fn(async (k: string, code: string) => void db.outbound.set(k, `failed:${code}`)),
  markOutboundBlocked: vi.fn(async (c: { idempotency_key: string }) => void db.outbound.set(c.idempotency_key, "blocked_inbound")),
}));
vi.mock("../repo/participants", () => ({ listRecipients: vi.fn(async () => db.recipients) }));
vi.mock("../repo/plans", () => ({ getPlan: vi.fn(async () => ({ state: db.planState })) }));
vi.mock("../events", () => ({ emit: vi.fn(async (e: unknown) => (db.events.push(e), db.events.length)) }));
vi.mock("../photon/errors", () => ({
  problemCode: (e: unknown) => (e as { code?: string }).code ?? "TRANSPORT",
  problemAction: (c: string) =>
    ({ SHARED_LINE_INBOUND_REQUIRED: "blocked_inbound", MESSAGE_TOO_LONG: "bug", SPACE_NOT_SENDABLE: "stale_route", SHARED_LINE_NOT_ASSIGNED: "not_assigned", RATE_LIMITED: "rate_limited" })[c] ??
    "transient",
  retryAfterMs: (e: unknown) => (e as { retryAfterMs?: number }).retryAfterMs ?? null,
}));

const { ports } = await import("../ports");
const { notify, notifyRaw, tplKey } = await import("./notify");
const { fanout } = await import("./fanout");
const { render, usd0, usd2, fmtDate, fmtDeadline, fmtClock, sanitizePitch, picksLines } = await import("./render");
const { safe, startPlanTyping, stopPlanTyping } = await import("./presence");

const P = "3f1c2b8e-6a0d-4c1f-9e2a-7b5d4c3a2f10";
const U1 = "9d8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6a";
const U2 = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const route = (u: string) => ({ userId: u, spaceId: `spc_${u.slice(0, 4)}`, agentUserId: "usr_agent" });
const sendSpy = () => vi.spyOn(ports.messaging, "sendText");

beforeEach(() => {
  vi.restoreAllMocks();
  db.routes.clear();
  db.outbound.clear();
  db.events.length = 0;
  db.recipients = [];
  db.planState = "RESEARCHING";
});

describe("render", () => {
  it("fills every placeholder and throws on a missing one", () => {
    expect(render("T_BUDGET_CONFIRM", { target: "30", max: "40" })).toBe("Got it. Just between us: aim ~$30, never over $40. Text 'change budget' anytime.");
    expect(render("T_VOTE_TALLY", { k: 0, n: 3 })).toBe("0 of 3 have voted so far.");
    expect(() => render("T_WINNER", {} as never)).toThrow(/missing \{title\}/);
  });

  it("every template renders with no leftover braces", () => {
    for (const id of TemplateId.options) {
      const vars = Object.fromEntries(Object.keys(VARS[id].shape).map((k) => [k, "x"]));
      expect(render(id, vars as never), id).not.toMatch(/[{}]/);
    }
  });

  it("copy keeps the privacy and money rules", () => {
    const all = Object.values(COPY).join("\n");
    expect(all).not.toMatch(/\$0 instantly|visa-verified/i);
    // Before capture it is a hold; only T_CAPTURED says "charged" as a fact.
    expect(COPY.T_PAY_LINK).toMatch(/hold/);
    expect(COPY.T_HELD).toMatch(/Not charged yet/);
    expect(COPY.T_CANCELLED).toContain("Nobody was charged; your pending authorization was released.");
    expect(COPY.T_OUT_ACK).toContain("Nobody's told why");
  });
});

describe("formatting", () => {
  it("money: usd0 floors, usd2 is exact integer math", () => {
    expect(usd0(3099)).toBe("30");
    expect(usd0(0)).toBe("0");
    expect(usd2(3000)).toBe("30.00");
    expect(usd2(1005)).toBe("10.05");
    expect(usd2(7)).toBe("0.07");
    expect(() => usd2(10.5)).toThrow(RangeError);
    expect(() => usd0(-1)).toThrow(RangeError);
  });

  it("dates and times in LA", () => {
    expect(fmtDate("2026-10-17")).toBe("Sat, Oct 17");
    expect(() => fmtDate("10/17/2026")).toThrow();
    expect(fmtDeadline(new Date("2026-10-18T04:40:00Z"))).toBe("9:40 PM"); // PDT
    expect(fmtDeadline("2026-12-01T20:05:00Z")).toBe("12:05 PM"); // PST
    expect(fmtClock("18:30")).toBe("6:30");
    expect(fmtClock("00:15")).toBe("12:15");
    expect(fmtClock("12:00")).toBe("12:00");
  });

  it("sanitizePitch strips control/bidi chars, collapses space, cuts on code points", () => {
    expect(sanitizePitch("  Great\n\tramen\u202e here\u0007 ")).toBe("Great ramen here");
    const cut = sanitizePitch("a".repeat(200));
    expect(Array.from(cut)).toHaveLength(140);
    expect(cut.endsWith("…")).toBe(true);
    expect(sanitizePitch("🍜🍜🍜🍜", 3)).toBe("🍜🍜…");
  });

  it("picksLines follows the format and keeps T_PICKS under 600 chars", () => {
    const b = (index: number, pitch: string): PublicBundle => ({
      id: `bnd_${index}`, index, title: `Dinner at Place ${index} → Show at Theater ${index}`, dinner_name: "d", show_name: "s",
      dinner_time: "18:30", show_start: "20:30", show_end_est: "22:00", all_in_pp_cents: 4599, dietary_fit: [], pitch,
    });
    const short = picksLines([b(2, "Cozy."), b(1, "Loud and fun.")]);
    expect(short).toBe(
      "1. Dinner at Place 1 → Show at Theater 1 · dinner 6:30 → show 8:30 · $45 pp all-in\n   Loud and fun.\n" +
        "2. Dinner at Place 2 → Show at Theater 2 · dinner 6:30 → show 8:30 · $45 pp all-in\n   Cozy.",
    );
    const long = picksLines([1, 2, 3].map((i) => b(i, "word ".repeat(56))));
    expect(render("T_PICKS", { lines: long }).length).toBeLessThanOrEqual(600);
    expect(long.split("\n")).toHaveLength(6);
    expect(picksLines([b(1, "")])).not.toContain("\n");
  });
});

describe("notify", () => {
  it("sends once per key; a duplicate key never re-sends", async () => {
    db.routes.set(U1, route(U1));
    const spy = sendSpy();
    const key = tplKey(P, U1, "T_WINNER", 1);
    expect(await notify(U1, "T_WINNER", { title: "Ramen + Comedy" }, { key, planId: P })).toBe("sent");
    expect(await notify(U1, "T_WINNER", { title: "Ramen + Comedy" }, { key, planId: P })).toBe("duplicate");
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![2]).toEqual({ idempotencyKey: key });
    expect(db.outbound.get(key)).toBe("accepted");
  });

  it("no dm_route → blocked_inbound, nothing sent", async () => {
    const spy = sendSpy();
    expect(await notify(U1, "T_PREFS_ASK", {}, { key: "reply:m1:1" })).toBe("blocked_inbound");
    expect(spy).not.toHaveBeenCalled();
    expect(db.outbound.get("reply:m1:1")).toBe("blocked_inbound");
  });

  it("a failed send is retried with the same key", async () => {
    db.routes.set(U1, route(U1));
    const spy = sendSpy().mockRejectedValueOnce(Object.assign(new Error("boom"), { code: "HTTP_503" }));
    expect(await notify(U1, "T_CANCELLED", {}, { key: "k1" })).toBe("failed");
    expect(db.outbound.get("k1")).toBe("failed:HTTP_503");
    expect(await notify(U1, "T_CANCELLED", {}, { key: "k1", replyTo: "pho_msg_9" })).toBe("sent");
    expect(spy.mock.calls.map((c) => c[2].idempotencyKey)).toEqual(["k1", "k1"]);
    expect(spy.mock.calls[1]![2].replyTo).toBe("pho_msg_9");
  });

  it("maps Photon problems: inbound-required blocks, stale route is KEPT (console warn), not-assigned raises a system event", async () => {
    db.routes.set(U1, route(U1));
    sendSpy()
      .mockRejectedValueOnce({ code: "SHARED_LINE_INBOUND_REQUIRED" })
      .mockRejectedValueOnce({ code: "SHARED_LINE_NOT_ASSIGNED" })
      .mockRejectedValueOnce({ code: "SPACE_NOT_SENDABLE" });
    expect(await notify(U1, "T_HELP", {}, { key: "a" })).toBe("blocked_inbound");
    expect(db.outbound.get("a")).toBe("blocked_inbound");
    expect(await notify(U1, "T_HELP", {}, { key: "b" })).toBe("failed");
    expect(db.events).toEqual([expect.objectContaining({ type: "system", level: "error" })]);
    expect(await notify(U1, "T_HELP", {}, { key: "c" })).toBe("failed");
    // One bad request (e.g. a threaded reply → 409 SPACE_NOT_SENDABLE) must not silence every later message.
    expect(db.routes.has(U1)).toBe(true);
    expect(db.events[1]).toEqual({ type: "system", level: "warn", msg: "Message not delivered (SPACE_NOT_SENDABLE)" });
  });

  it("a 429 the SDK gave up on is retried once with the SAME key; a second 429 is a failure", async () => {
    db.routes.set(U1, route(U1));
    const spy = sendSpy()
      .mockRejectedValueOnce({ code: "RATE_LIMITED", retryAfterMs: 0 })
      .mockResolvedValueOnce({ messageId: "pho_msg_ok" } as never);
    expect(await notify(U1, "T_WINNER", { title: "t" }, { key: "r1" })).toBe("sent");
    expect(spy.mock.calls.map((c) => c[2].idempotencyKey)).toEqual(["r1", "r1"]);
    expect(db.outbound.get("r1")).toBe("accepted");
    spy.mockReset();
    spy.mockRejectedValueOnce({ code: "RATE_LIMITED", retryAfterMs: 0 }).mockRejectedValueOnce({ code: "RATE_LIMITED", retryAfterMs: 0 });
    expect(await notify(U1, "T_WINNER", { title: "t" }, { key: "r2" })).toBe("failed");
    expect(spy).toHaveBeenCalledTimes(2);
    // Transport errors are not retried here (the SDK already did; another round could outlast the handler timeout).
    spy.mockReset();
    spy.mockRejectedValueOnce({ code: "TRANSPORT" });
    expect(await notify(U1, "T_WINNER", { title: "t" }, { key: "r3" })).toBe("failed");
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("a member with no dm_route is flagged on the console once per plan (template id only)", async () => {
    const plan = "7e57ab1e-0000-4000-8000-000000000001";
    expect(await notify(U2, "T_PICKS", { lines: "1. x" }, { key: "w1", planId: plan })).toBe("blocked_inbound");
    expect(await notify(U2, "T_WINNER", { title: "t" }, { key: "w2", planId: plan })).toBe("blocked_inbound");
    expect(db.events).toEqual([{ type: "system", level: "warn", msg: "A member hasn't texted SquadTab yet; T_PICKS is held" }]);
  });

  it("invalid vars throw before any send, without echoing the value", async () => {
    db.routes.set(U1, route(U1));
    const spy = sendSpy();
    await expect(notify(U1, "T_PAY_LINK", { title: "t", amount: "30.00", deadline: "9 PM", url: "secret-not-a-url" }, { key: "x" })).rejects.toThrow(
      /invalid vars at url$/,
    );
    await expect(notify(U1, "T_PAY_LINK", { title: "t", amount: "30.00", deadline: "9 PM", url: "secret-not-a-url" }, { key: "x" })).rejects.not.toThrow(/secret/);
    expect(spy).not.toHaveBeenCalled();
  });

  it("notifyRaw replies to the inbound address with no user/plan", async () => {
    const spy = sendSpy();
    expect(await notifyRaw(route("unknown"), "T_NOT_IN_PLAN", {}, "reply:m2:1")).toBe("sent");
    expect(spy.mock.calls[0]![1]).toBe(COPY.T_NOT_IN_PLAN);
  });
});

describe("fanout", () => {
  const member = (user_id: string, lane: number, stage = "PREFS_DONE") => ({ plan_id: P, user_id, lane, stage, joined_at: new Date(), first_name: "x", payer_ref: "r" });

  it("sends to every recipient with per-user keys, counts sent, previews the lowest lane on the X-ray", async () => {
    db.recipients = [member(U2, 2), member(U1, 1)];
    db.routes.set(U1, route(U1));
    db.routes.set(U2, route(U2));
    const spy = sendSpy();
    expect(await fanout(P, "T_VOTE_TALLY", () => ({ k: 1, n: 2 }), { version: 3, suffix: 1 })).toBe(2);
    expect(spy.mock.calls.map((c) => c[2].idempotencyKey).sort()).toEqual([tplKey(P, U1, "T_VOTE_TALLY", 3, 1), tplKey(P, U2, "T_VOTE_TALLY", 3, 1)].sort());
    expect(db.events).toEqual([{ type: "xray", contexts: [{ name: "fanout", locked: false, preview: "1 of 2 have voted so far." }] }]);
    // Re-running is safe: keyed, so nothing is re-sent.
    expect(await fanout(P, "T_VOTE_TALLY", () => ({ k: 1, n: 2 }), { version: 3, suffix: 1 })).toBe(0);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("personal templates never reach the X-ray; `only` narrows; one failure does not stop the rest", async () => {
    db.recipients = [member(U1, 1), member(U2, 2)];
    db.routes.set(U2, route(U2)); // U1 has no route
    expect(await fanout(P, "T_REPING", () => ({ title: "t", deadline: "9:40 PM", url: "https://pay.example/x" }), { version: 1, suffix: 1 })).toBe(1);
    expect(db.events.filter((e) => (e as { type: string }).type === "xray")).toEqual([]);
    const spy = sendSpy();
    expect(await fanout(P, "T_WINNER", () => ({ title: "t" }), { version: 1, only: (r) => r.lane === 2 })).toBe(1);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe("presence", () => {
  it("safe swallows sync throws and rejections", async () => {
    safe("x", () => {
      throw new Error("sync");
    });
    safe("y", () => Promise.reject(new Error("async")));
    await new Promise((r) => setTimeout(r, 0));
  });

  it("plan typing types for routed recipients and stops when the plan leaves RESEARCHING", async () => {
    db.recipients = [member0(U1), member0(U2)];
    db.routes.set(U1, route(U1));
    const spy = vi.spyOn(ports.messaging, "setTyping");
    startPlanTyping(P);
    startPlanTyping(P); // idempotent
    await vi.waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    expect(spy).toHaveBeenCalledWith(route(U1), true);
    stopPlanTyping(P);
    stopPlanTyping(P);
  });
});

function member0(user_id: string) {
  return { plan_id: P, user_id, lane: 1, stage: "PREFS_DONE", joined_at: new Date(), first_name: "x", payer_ref: "r" };
}
