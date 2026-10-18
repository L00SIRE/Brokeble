import { describe, expect, it } from "vitest";
import * as shared from "../src/index";
import {
  AgentProgress, Ballot, BallotParse, BudgetParse, Bundle, CommitResult, ConciergeInput, CreaoRun, CreateOrderRequest,
  CreateOrderResponse, DelegateInput, InboundEvent, Itinerary, OrderStatus, Preferences, PublicBundle, Ratings,
  ResearchBrief, ScoutOption, ScoutSubmission, SseEvent, TemplateId, COPY, VARS, ValidationResult, VenueEvent,
} from "../src/index";
import { PrivateConstraints } from "../src/private";

const uuid = "3f1c2b8e-6a0d-4c1f-9e2a-7b5d4c3a2f10";
const at = "2026-10-17T23:00:00Z";
const url = "https://example.com/x";

const dinner = {
  category: "dinner", name: "Noodle Bar", address: "123 Sawtelle Blvd", area: "Sawtelle", url, price_tier: "$25-50",
  est_low_pp_usd: 18, est_high_pp_usd: 28, price_evidence_url: url, dietary_fit: ["vegetarian"], pitch: "Hand-pulled noodles.",
  opens: "11:00", closes: "22:00", hours_evidence_url: url,
} as const;
const show = {
  category: "show", name: "Comedy Club", address: "456 Westwood Blvd", area: "Westwood", url, price_tier: "<$25",
  est_low_pp_usd: 10, est_high_pp_usd: 20, price_evidence_url: url, dietary_fit: [], pitch: "Stand-up showcase.",
  show_start: "20:30", show_end_est: "22:00", showtime_evidence_url: url,
} as const;
const option = (data: typeof dinner | typeof show, id: string) =>
  ({ id, run_id: "run_1", source: "cached", data, est_high_pp_cents: data.est_high_pp_usd * 100 }) as const;
const publicBundle = {
  id: "bnd_1", index: 1, title: "Dinner at Noodle Bar → Show at Comedy Club", dinner_name: "Noodle Bar", show_name: "Comedy Club",
  dinner_time: "18:30", show_start: "20:30", show_end_est: "22:00", all_in_pp_cents: 5800, dietary_fit: ["vegetarian"], pitch: "p",
} as const;
const tapReport = {
  route: "POST /checkout/ord_0123456789", tag: "agent-payer-auth",
  steps: [{ n: 1, name: "tag", ok: true, detail: "ok" }],
  business: { all_authorized: true, sum_matches: true, consent_matches: true },
  accepted: true, reason: null, signature_base: '"@method": POST',
} as const;
const share = { share_id: "shr_a", payer_ref: "a".repeat(32), amount_cents: 3700, status: "AUTHORIZED", cybs_payment_id: "pay_a", card_last4: "1111" } as const;

const fixtures: Array<[string, { parse: (v: unknown) => unknown }, unknown]> = [
  ["ResearchBrief", ResearchBrief, {
    category: "dinner", area: "Westwood / Sawtelle", date: "2026-10-17", time_window: { start: "18:30", end: "23:00" },
    party_size: 4, dietary_tags: ["vegetarian"], vibe: ["lively"], price_tiers: ["<$25", "$25-50", "$50+"], count_per_tier: 4,
  }],
  ["ScoutSubmission", ScoutSubmission, { plan_ref: uuid, category: "dinner", options: Array.from({ length: 6 }, () => dinner) }],
  ["Bundle", Bundle, {
    id: "bnd_1", dinner: option(dinner, "opt_d"), show: option(show, "opt_s"),
    dinner_time: "18:30", show_start: "20:30", show_end_est: "22:00", all_in_pp_cents: 5800,
  }],
  ["PublicBundle", PublicBundle, publicBundle],
  ["DelegateInput", DelegateInput, { user_first_name: "Sam", stage: "budget", message_text: "30 tops" }],
  ["BudgetParse", BudgetParse, { target_pp_cents: 3000, hard_max_pp_cents: null, confidence: "high" }],
  ["Preferences", Preferences, {
    cuisines_like: ["ramen"], cuisines_avoid: [], dietary: ["vegan"], vibe: ["quiet"], earliest_start: null, latest_end: "22:00", dealbreakers: [],
  }],
  ["BallotParse", BallotParse, {
    approvals: [2], constraints: [{ kind: "end_before", time: "22:00" }, { kind: "exclude", index: 3 }],
    none_of_these: false, intent: "ballot", confidence: "high",
  }],
  ["Ratings", Ratings, { ratings: [{ index: 1, score: 0.8 }] }],
  ["Ballot", Ballot, { plan_id: uuid, user_id: uuid, plan_version: 1, approvals: ["bnd_1"], constraints: [], source: "digits", at }],
  ["PrivateConstraints", PrivateConstraints, {
    plan_id: uuid, user_id: uuid, target_pp_cents: 3000, hard_max_pp_cents: 3300, source: "dm", confidence: "high", confirmed_at: at,
  }],
  ["CreateOrderRequest", CreateOrderRequest, {
    plan_ref: uuid, plan_version: 1, party_size: 2, payer_refs: ["a".repeat(32), "b".repeat(32)], deadline_at: at,
    bundle: {
      bundle_key: "bnd_1", date: "2026-10-17",
      dinner: { name: "D", address: "1 Main St", time: "18:30", est_high_pp_usd: 28 },
      show: { name: "S", address: "2 Main St", time: "20:30", est_high_pp_usd: 20 },
    },
  }],
  ["CreateOrderResponse", CreateOrderResponse, {
    order_id: "ord_0123456789", total_cents: 7400, currency: "USD",
    items: [{ kind: "dinner", name: "D", address: "1 Main St", time: "18:30", unit_price_pp_cents: 3600, qty: 2 }],
    shares: [{ share_id: "shr_a", payer_ref: "a".repeat(32), amount_cents: 3700, pay_url: url, expires_at: at }],
  }],
  ["OrderStatus", OrderStatus, {
    order_id: "ord_0123456789", plan_ref: uuid, plan_version: 1, status: "OPEN", total_cents: 3700, shares: [share], updated_at: at,
  }],
  ["CommitResult", CommitResult, {
    order_id: "ord_0123456789", result: "captured", tap: tapReport, captures: [{ share_id: "shr_a", status: "CAPTURED", cybs_capture_id: "cap_1" }],
  }],
  ["VenueEvent", VenueEvent, {
    event_id: "evt_1", at, order_id: "ord_0123456789", plan_ref: uuid, type: "share.authorized",
    share_id: "shr_a", payer_ref: "a".repeat(32), data: { card_last4: "1111" },
  }],
  ["InboundEvent", InboundEvent, {
    event_id: "evt_1", seq: 12, message_id: "pho_msg_1", platform: "imessage", from_handle: "+13105550100", from_user_id: "u1",
    agent_user_id: "a1", space_id: "s1", space_kind: "direct", content_type: "text", text: "JOIN 4821", parent_message_id: null, received_at: at,
  }],
  ["CreaoRun", CreaoRun, { id: "run_1", status: "completed", result: { text: "{}", artifacts: [] }, extraField: 1 }],
  ["ConciergeInput", ConciergeInput, {
    plan_ref: uuid, itinerary: {
      date: "2026-10-17", area: "Westwood", party_size: 4,
      dinner: { name: "D", address: "1 Main St", time: "18:30" }, show: { name: "S", address: "2 Main St", time: "20:30" },
    },
  }],
  ["Itinerary", Itinerary, {
    plan_ref: uuid, title: "Dinner + show", date: "2026-10-17",
    stops: [{ kind: "dinner", name: "D", address: "1 Main St", time: "18:30", notes: "" }],
    logistics: { getting_there: "Bus", parking: "Lot", doors: "20:00", dress_code: "Casual", know_before: [] },
    ics: "BEGIN:VCALENDAR\r\nEND:VCALENDAR", notion_url: null,
  }],
  ["AgentProgress", AgentProgress, { plan_ref: uuid, run_kind: "scout", category: "show", step: "Checking showtimes" }],
  ["ValidationResult", ValidationResult, { ok: false, errors: [{ path: "options.0.url", message: "Invalid URL" }] }],
];

const sseEvents: unknown[] = [
  { type: "plan.state", plan_id: uuid, from: "APPROVING", to: "COMMITTING", version: 1 },
  { type: "lane", plan_id: uuid, lane: 2, first_name: "Sam", stage: "HELD", amount_cents: 3700, cybs_id_short: "…1234" },
  { type: "creao.run", run_id: "run_1", kind: "scout", category: "dinner", status: "running", elapsed_ms: 1200, source: "live", share_url: null },
  { type: "creao.progress", run_id: null, kind: "scout", category: null, step: "Searching" },
  { type: "shortlist", plan_id: uuid, version: 2, from_count: 9, survived_count: 4, bundles: [publicBundle] },
  { type: "vote.tally", plan_id: uuid, voted: 3, total: 4 },
  { type: "tap.signed", order_id: "ord_1", method: "POST", path: "/checkout/ord_1", signature_input: "sig2=()", signature_short: "abc…" },
  { type: "tap.verify", order_id: "ord_1", report: tapReport },
  { type: "ledger", order_id: "ord_1", lane: 1, status: "CAPTURED", amount_cents: 3700, cybs_id_short: null },
  { type: "counters", groups_converted: 3, fronted_by_individual_cents: 0, holds_released: 2 },
  { type: "xray", contexts: [{ name: "delegate:lane-2", locked: true, preview: null }] },
  { type: "delivery", lane: null, message_id_short: "msg…", status: "delivered" },
  { type: "system", level: "info", msg: "ready" },
];

describe("contract round-trip", () => {
  it.each(fixtures)("%s parses and survives JSON round-trip unchanged", (_name, schema, value) => {
    const parsed = schema.parse(value);
    expect(parsed).toEqual(value);
    expect(schema.parse(JSON.parse(JSON.stringify(parsed)))).toEqual(parsed);
  });

  it.each(sseEvents.map((e) => [(e as { type: string }).type, e]))("SseEvent %s round-trips", (_t, e) => {
    expect(SseEvent.parse(JSON.parse(JSON.stringify(e)))).toEqual(e);
  });

  it("covers every SseEvent variant", () => {
    expect(new Set(sseEvents.map((e) => (e as { type: string }).type)).size).toBe(SseEvent.options.length);
  });
});

describe("strictness (privacy)", () => {
  it("P6: ResearchBrief rejects any extra key such as a name or budget", () => {
    const brief = fixtures[0]![2] as Record<string, unknown>;
    expect(ResearchBrief.safeParse({ ...brief, names: ["Sam"] }).success).toBe(false);
    expect(ResearchBrief.safeParse({ ...brief, budget_cents: 3000 }).success).toBe(false);
  });

  it("P8: SseEvent rejects budget-like fields", () => {
    expect(SseEvent.safeParse({ ...(sseEvents[1] as object), target_pp_cents: 3117 }).success).toBe(false);
    expect(SseEvent.safeParse({ type: "counters", groups_converted: 1, fronted_by_individual_cents: 5, holds_released: 0 }).success).toBe(false);
  });

  it("P1: PrivateConstraints is not exported from the public entry", () => {
    expect("PrivateConstraints" in shared).toBe(false);
  });

  it("ScoutOption enforces est_high >= est_low and the category discriminator", () => {
    expect(ScoutOption.safeParse({ ...dinner, est_high_pp_usd: 10 }).success).toBe(false);
    expect(ScoutOption.safeParse({ ...dinner, show_start: "20:00" }).success).toBe(false);
  });

  it("HHMM rejects invalid times", () => {
    expect(shared.HHMM.safeParse("24:00").success).toBe(false);
    expect(shared.HHMM.safeParse("9:30").success).toBe(false);
    expect(shared.HHMM.safeParse("23:59").success).toBe(true);
  });
});

describe("templates", () => {
  it("every TemplateId has copy and a vars schema whose keys equal the copy placeholders", () => {
    for (const id of TemplateId.options) {
      const placeholders = [...new Set([...COPY[id].matchAll(/\{(\w+)\}/g)].map((m) => m[1]))].sort();
      expect(Object.keys(VARS[id].shape).sort(), id).toEqual(placeholders);
    }
  });

  it("uses the mandated release wording (M9)", () => {
    expect(COPY.T_CANCELLED).toContain("Nobody was charged; your pending authorization was released.");
    const all = Object.values(COPY).join("\n").toLowerCase();
    expect(all).not.toContain("$0 instantly");
    expect(all).not.toContain("visa-verified");
  });
});
