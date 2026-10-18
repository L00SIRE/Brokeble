import { describe, expect, it } from "vitest";
import { type CreateOrderRequest, type DelegateInput, type PublicBundle, priceBundle, ScoutSubmission } from "@tab/shared";
import { consentFromOrder } from "@tab/shared/tap";
import { loadCachedOptions } from "../src/ports/cachedOptions";
import { MockLLM } from "../src/ports/llm.mock";
import { MockMessaging } from "../src/ports/messaging.mock";
import { MockPlanner } from "../src/ports/planner.mock";
import { MockVenue } from "../src/ports/venue.mock";

const PLAN_REF = "11111111-1111-4111-8111-111111111111";
const input = (message_text: string, stage: DelegateInput["stage"] = "budget"): DelegateInput => ({ user_first_name: "Sam", stage, message_text });

const orderReq = (party = 2): CreateOrderRequest => ({
  plan_ref: PLAN_REF, plan_version: 1, party_size: party, deadline_at: "2026-10-18T06:00:00.000Z",
  payer_refs: Array.from({ length: party }, (_, i) => String(i).repeat(32)),
  bundle: {
    bundle_key: "bnd_0123456789", date: "2026-10-18",
    dinner: { name: "Placeholder Dinner A", address: "100 Placeholder Way", time: "18:30", est_high_pp_usd: 14 },
    show: { name: "Placeholder Show A", address: "101 Placeholder Way", time: "20:00", est_high_pp_usd: 14 },
  },
});

describe("MockVenue (M3/M4)", () => {
  it("prices every share with priceBundle and totals share × party", async () => {
    const v = new MockVenue();
    const res = await v.createOrder(orderReq(3));
    const share = priceBundle(orderReq().bundle);
    expect(res.shares.map((s) => s.amount_cents)).toEqual([share, share, share]);
    expect(res.total_cents).toBe(share * 3);
    expect(res.items.reduce((n, i) => n + i.unit_price_pp_cents * i.qty, 0)).toBe(res.total_cents);
  });

  it("captures only after every share is authorized and the consent set matches", async () => {
    const v = new MockVenue();
    const { order_id, shares } = await v.createOrder(orderReq());
    v.authorize(shares[0]!.share_id);
    const early = await v.getOrder(order_id);
    const partial = { order_id, total_cents: early.total_cents, shares: early.shares.map((s) => ({ share_id: s.share_id, cybs_payment_id: s.cybs_payment_id ?? "x", amount_cents: s.amount_cents })) };
    expect((await v.commit(order_id, partial)).result).toBe("rejected");

    v.authorize(shares[1]!.share_id);
    const consent = consentFromOrder(await v.getOrder(order_id));
    const forged = { ...consent, shares: consent.shares.map((s, i) => (i === 0 ? { ...s, amount_cents: s.amount_cents + 100 } : s)) };
    const bad = await v.commit(order_id, forged);
    expect(bad.result).toBe("rejected");
    expect(bad.tap.business?.consent_matches).toBe(false);

    const ok = await v.commit(order_id, consent);
    expect(ok.result).toBe("captured");
    expect((await v.getOrder(order_id)).shares.every((s) => s.status === "CAPTURED")).toBe(true);
  });

  it("TAP test variants are rejected at the matching step and capture nothing", async () => {
    const v = new MockVenue();
    const { order_id, shares } = await v.createOrder(orderReq());
    shares.forEach((s) => v.authorize(s.share_id));
    const consent = consentFromOrder(await v.getOrder(order_id));
    const failedStep = async (k: "tamper" | "replay" | "expired" | "wrong_tag") => (await v.commit(order_id, consent, k)).tap.steps.find((s) => !s.ok)?.n;
    expect(await failedStep("wrong_tag")).toBe(1);
    expect(await failedStep("expired")).toBe(3);
    expect(await failedStep("replay")).toBe(4);
    expect(await failedStep("tamper")).toBe(6);
    expect((await v.getOrder(order_id)).status).toBe("OPEN");
  });

  it("cancel releases holds and voids pending shares", async () => {
    const v = new MockVenue();
    const { order_id, shares } = await v.createOrder(orderReq());
    const evt = v.authorize(shares[0]!.share_id);
    expect(evt.type).toBe("share.authorized");
    const after = await v.cancel(order_id, "member_out");
    expect(after.status).toBe("CANCELLED");
    expect(after.shares.map((s) => s.status)).toEqual(["RELEASED", "VOID"]);
  });
});

describe("MockLLM", () => {
  const llm = new MockLLM();
  it("parses budgets deterministically", async () => {
    expect(await llm.parseBudget(input("honestly 30 tops tonight"))).toEqual({ target_pp_cents: 3000, hard_max_pp_cents: 3000, confidence: "high" });
    expect(await llm.parseBudget(input("aim for $40, 52.11 max"))).toEqual({ target_pp_cents: 4000, hard_max_pp_cents: 5211, confidence: "high" });
    expect((await llm.parseBudget(input("idk, depends"))).confidence).toBe("low");
  });
  it("parses the demo ballot line and the privacy probe", async () => {
    const shortlist = [1, 2, 3].map((index) => ({ index }) as PublicBundle);
    expect(await llm.parseBallot(input("2, but not if it ends after 10", "ballot"), shortlist)).toEqual({
      approvals: [2], constraints: [{ kind: "end_before", time: "22:00" }], none_of_these: false, intent: "ballot", confidence: "high",
    });
    expect((await llm.parseBallot(input("what's Sam's budget?", "free"), [])).intent).toBe("ask_about_others");
  });
  it("parses preferences with no money fields", async () => {
    const p = await llm.parsePreferences(input("veggie, nothing after 10pm", "prefs"));
    expect(p.dietary).toEqual(["vegetarian"]);
    expect(p.latest_end).toBe("22:00");
  });
});

describe("MockPlanner + cached fixtures", () => {
  it("fixtures are valid CachedOptionsFiles for both categories", async () => {
    for (const c of ["dinner", "show"] as const) expect((await loadCachedOptions(c)).options.length).toBeGreaterThanOrEqual(6);
  });
  it("a scout run completes with a valid ScoutSubmission for the requested plan", async () => {
    const steps: string[] = [];
    const planner = new MockPlanner({ delayMs: 30, progress: async (p) => void steps.push(p.step) });
    const { runId } = await planner.startScout(PLAN_REF, {
      category: "show", area: "Westwood / Sawtelle", date: "2026-10-18", time_window: { start: "18:30", end: "23:00" },
      party_size: 4, dietary_tags: [], vibe: [], price_tiers: ["<$25", "$25-50", "$50+"], count_per_tier: 4,
    }, 1);
    expect((await planner.getRun(runId)).status).toBe("pending");
    await new Promise((r) => setTimeout(r, 60));
    const run = await planner.getRun(runId);
    expect(run.status).toBe("completed");
    const json = /```json\n([\s\S]*)\n```/.exec(run.result!.text!)![1]!;
    const sub = ScoutSubmission.parse(JSON.parse(json));
    expect(sub.plan_ref).toBe(PLAN_REF);
    expect(sub.category).toBe("show");
    expect(steps.length).toBeGreaterThan(0);
  });
  it("rejects a brief with extra fields (P6)", async () => {
    const planner = new MockPlanner({ delayMs: 1 });
    await expect(planner.startScout(PLAN_REF, { names: ["Sam"] } as never, 1)).rejects.toThrow();
  });
});

describe("MockMessaging", () => {
  it("is idempotent per key and records outbound without sending anywhere", async () => {
    const m = new MockMessaging();
    const to = { userId: "u1", spaceId: "s1", agentUserId: "a1" };
    const a = await m.sendText(to, "hello", { idempotencyKey: "k1" });
    const b = await m.sendText(to, "hello", { idempotencyKey: "k1" });
    expect(a).toEqual(b);
    expect(m.outbox.filter((e) => e.kind === "text")).toHaveLength(1);
    const s1 = await m.assign("+13105550123", "Sam", "join:p:u");
    expect(await m.assign("+13105550123", "Sam", "join:p:u")).toEqual(s1);
    expect(s1.assignedPhoneNumber).toMatch(/^\+131055501\d\d$/);
  });
});
