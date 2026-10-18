// Delegate handlers (A plan T6/T8), P2 input, budget acceptance, tier map, "I only know yours", awaiting flags.
// Collaborators are mocked: these tests pin what each handler sends, stores and enqueues.
import type { BallotParse, BudgetParse, InboundEvent, Preferences, PublicBundle } from "@tab/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MemberContext, MemberRow, PlanState } from "../repo/types";

const m = vi.hoisted(() => ({
  notify: vi.fn(async (..._a: unknown[]) => "sent" as string),
  setStage: vi.fn(async (..._a: unknown[]) => {}),
  onPrefsDone: vi.fn(async (..._a: unknown[]) => {}),
  upsertPc: vi.fn(async (..._a: unknown[]) => {}),
  getPc: vi.fn(async (..._a: unknown[]): Promise<unknown> => null),
  upsertPrefs: vi.fn(async (..._a: unknown[]) => {}),
  enqueue: vi.fn(async (..._a: unknown[]) => true),
  recheck: vi.fn(async (..._a: unknown[]) => {}),
  recordBallot: vi.fn(async (..._a: unknown[]) => {}),
  shortlist: vi.fn(async (..._a: unknown[]): Promise<PublicBundle[]> => []),
  members: vi.fn(async (..._a: unknown[]): Promise<MemberRow[]> => []),
  emit: vi.fn(async (..._a: unknown[]) => 1),
  llm: {
    parseBudget: vi.fn(async (..._a: unknown[]): Promise<BudgetParse> => ({ target_pp_cents: 0, hard_max_pp_cents: null, confidence: "low" })),
    parsePreferences: vi.fn(async (..._a: unknown[]): Promise<Preferences> => ({ cuisines_like: ["thai"], cuisines_avoid: [], dietary: [], vibe: [], earliest_start: null, latest_end: null, dealbreakers: [] })),
    parseBallot: vi.fn(async (..._a: unknown[]): Promise<BallotParse> => ({ approvals: [], constraints: [], none_of_these: false, intent: "other", confidence: "low" })),
  },
}));

vi.mock("../notify/notify", () => ({
  notify: m.notify,
  replyKey: (id: string, n: number) => `reply:${id}:${n}`,
  tplKey: (p: string, u: string, t: string, v: number) => `tpl:${p}:${u}:${t}:${v}`,
}));
vi.mock("../notify/render", () => ({ usd0: (c: number) => `$${Math.floor(c / 100)}` }));
vi.mock("../decide/filter", () => ({ effectiveHardMax: (c: { target_pp_cents: number; hard_max_pp_cents: number | null }) => c.hard_max_pp_cents ?? Math.round(c.target_pp_cents * 1.1) }));
vi.mock("../plan/membership", () => ({ setStage: m.setStage, onPrefsDone: m.onPrefsDone }));
vi.mock("../repo/privateConstraints", () => ({ upsert: m.upsertPc, get: m.getPc }));
vi.mock("../repo/preferences", () => ({ upsertPreferences: m.upsertPrefs, EMPTY_PREFERENCES: { cuisines_like: [], cuisines_avoid: [], dietary: [], vibe: [], earliest_start: null, latest_end: null, dealbreakers: [] } }));
vi.mock("../repo/participants", () => ({ listMembers: m.members }));
vi.mock("../dueJobs", () => ({ enqueue: m.enqueue, jobKeys: { recomputeOptions: (p: string) => `recompute:${p}:options` } }));
vi.mock("../jobs/kinds", () => ({ A_JOB_KINDS: { recompute: "recompute" }, aJobKeys: { recompute: (p: string, t: string) => `recompute:${p}:${t}` } }));
vi.mock("../money/holdGate", () => ({ recheck: m.recheck }));
vi.mock("../plan/ballots", () => ({ recordBallot: m.recordBallot, publicShortlist: m.shortlist }));
vi.mock("../events", () => ({ emit: m.emit }));
vi.mock("../ports", () => ({ ports: { llm: m.llm } }));

const { acceptBudget, applyTier, confirmFormBudget, handleBudgetText, TIER_MAP } = await import("./budget");
const { handlePrefsText } = await import("./prefs");
const { handleBallotText } = await import("./ballot");
const { handleFreeText, mentionsOthersBudget } = await import("./free");
const { buildDelegateInput } = await import("./input");
const { clearAwaiting, getAwaiting, setAwaiting } = await import("./awaiting");
const { ballotExtra } = await import("./prompts");

const PLAN = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const ev = (text: string): InboundEvent => ({
  event_id: "evt_1", seq: 1, message_id: "pho_msg_1", platform: "imessage", from_handle: "+15555550100", from_user_id: "u",
  agent_user_id: "a", space_id: "s", space_kind: "direct", content_type: "text", text, parent_message_id: null, received_at: "2026-10-17T20:00:00.000Z",
});
function ctx(o: { stage?: MemberContext["participant"]["stage"]; state?: PlanState; order?: string | null } = {}): MemberContext {
  return {
    user: { id: USER, phone_e164: "+15555550100", first_name: "Sam", photon_user_id: null, payer_ref: "x", created_at: new Date() },
    plan: {
      id: PLAN, ref: PLAN, code: "1234", organizer_id: null, state: o.state ?? "COLLECTING", version: 2, title: "Fri", area: "Westwood",
      event_date: "2026-10-17", time_start: "18:00", time_end: "23:00", party_target: 3, chosen_bundle_id: null, venue_order_id: o.order ?? null,
      deadlines: {}, created_at: new Date(), updated_at: new Date(),
    },
    participant: { plan_id: PLAN, user_id: USER, lane: 2, stage: o.stage ?? "JOINED", joined_at: new Date() },
  };
}
const member = (user_id: string, first_name: string): MemberRow => ({ plan_id: PLAN, user_id, lane: 1, stage: "PREFS_DONE", joined_at: new Date(), first_name, payer_ref: "y" });
const sent = () => m.notify.mock.calls.map((c) => [c[1], c[2], (c[3] as { key: string }).key]);

beforeEach(() => {
  vi.clearAllMocks();
  clearAwaiting(USER);
});

describe("buildDelegateInput (P2)", () => {
  it("has exactly the owner's first name, stage and own text (≤2000 chars)", () => {
    const i = buildDelegateInput("Sam", "budget", "x".repeat(2500));
    expect(Object.keys(i).sort()).toEqual(["message_text", "stage", "user_first_name"]);
    expect(i).toEqual({ user_first_name: "Sam", stage: "budget", message_text: "x".repeat(2000) });
  });
});

describe("acceptBudget", () => {
  const p = (t: number, h: number | null, confidence: "high" | "low" = "high"): BudgetParse => ({ target_pp_cents: t, hard_max_pp_cents: h, confidence });
  it.each([
    [p(3000, 3000), true], [p(6000, 8000), true], [p(4500, null), true], [p(500, null), true], [p(100_000, 100_000), true],
    [p(3000, 3000, "low"), false], [p(499, null), false], [p(100_001, null), false], [p(6000, 5000), false], [p(6000, 100_001), false],
    [p(3000.5, null), false], [null, false],
  ])("%j → %s", (b, ok) => expect(acceptBudget(b)).toBe(ok));
});

describe("budget delegate", () => {
  it("accepted DM budget: private store → own confirmation → BUDGET_LOCKED + prefs ask", async () => {
    m.llm.parseBudget.mockResolvedValueOnce({ target_pp_cents: 6000, hard_max_pp_cents: 8000, confidence: "high" });
    setAwaiting(USER, "budget");
    await handleBudgetText(ctx(), ev("60ish, could stretch to 80"));
    expect(m.llm.parseBudget).toHaveBeenCalledWith({ user_first_name: "Sam", stage: "budget", message_text: "60ish, could stretch to 80" });
    expect(m.upsertPc).toHaveBeenCalledWith(expect.objectContaining({ plan_id: PLAN, user_id: USER, target_pp_cents: 6000, hard_max_pp_cents: 8000, source: "dm", confidence: "high" }));
    expect(sent()).toEqual([
      ["T_BUDGET_CONFIRM", { target: "$60", max: "$80" }, "reply:pho_msg_1:1"],
      ["T_PREFS_ASK", {}, "reply:pho_msg_1:2"],
    ]);
    expect(m.setStage).toHaveBeenCalledWith(PLAN, USER, "BUDGET_LOCKED");
    expect(getAwaiting(USER)).toBeNull();
    expect(m.emit).toHaveBeenCalledWith({ type: "xray", contexts: [{ name: "delegate:lane-2", locked: true, preview: null }] });
    expect(m.enqueue).not.toHaveBeenCalled();
    expect(m.recheck).not.toHaveBeenCalled();
  });

  it("no ceiling → slack max in the confirmation", async () => {
    m.llm.parseBudget.mockResolvedValueOnce({ target_pp_cents: 4500, hard_max_pp_cents: null, confidence: "high" });
    await handleBudgetText(ctx(), ev("around 45"));
    expect(sent()[0]).toEqual(["T_BUDGET_CONFIRM", { target: "$45", max: "$49" }, "reply:pho_msg_1:1"]);
  });

  it("unclear → tiers prompt + awaiting 'tiers', nothing stored", async () => {
    await handleBudgetText(ctx(), ev("idk whatever"));
    expect(sent()).toEqual([["T_BUDGET_TIERS", {}, "reply:pho_msg_1:1"]]);
    expect(getAwaiting(USER)).toBe("tiers");
    expect(m.upsertPc).not.toHaveBeenCalled();
  });

  it("tier 4 = no cap; tier writes use source 'tier'", async () => {
    await applyTier(ctx(), 4, ev("4"));
    expect(m.upsertPc).toHaveBeenCalledWith(expect.objectContaining({ ...TIER_MAP[4], source: "tier", confidence: "high" }));
    expect(sent()[0]).toEqual(["T_BUDGET_CONFIRM_NOCAP", {}, "reply:pho_msg_1:1"]);
  });

  it("change budget mid-vote keeps the stage, enqueues recompute and re-runs the hold gate when an order exists", async () => {
    const c = ctx({ stage: "LINK_SENT", state: "VOTING", order: "ord_1" });
    await applyTier(c, 1, ev("1"));
    expect(m.setStage).not.toHaveBeenCalled();
    expect(sent()).toEqual([["T_BUDGET_CONFIRM", { target: "$20", max: "$25" }, "reply:pho_msg_1:1"]]);
    expect(m.enqueue).toHaveBeenCalledWith("recompute", `recompute:${PLAN}:evt_1`, expect.any(Date), {}, { planId: PLAN });
    expect(m.recheck).toHaveBeenCalledWith(c);
  });

  it("confirmFormBudget: no stored budget → false and silent", async () => {
    expect(await confirmFormBudget(ctx(), ev("JOIN 1234"))).toBe(false);
    expect(m.notify).not.toHaveBeenCalled();
  });

  it("confirmFormBudget: stored budget → confirm (n=2) + BUDGET_LOCKED + prefs ask (n=3)", async () => {
    m.getPc.mockResolvedValueOnce({ plan_id: PLAN, user_id: USER, target_pp_cents: 3000, hard_max_pp_cents: null, source: "form", confidence: "high", confirmed_at: null });
    expect(await confirmFormBudget(ctx({ stage: "INVITED" }), ev("JOIN 1234"))).toBe(true);
    expect(sent()).toEqual([
      ["T_BUDGET_CONFIRM", { target: "$30", max: "$33" }, "reply:pho_msg_1:2"],
      ["T_PREFS_ASK", {}, "reply:pho_msg_1:3"],
    ]);
    expect(m.setStage).toHaveBeenCalledWith(PLAN, USER, "BUDGET_LOCKED");
  });
});

describe("prefs delegate", () => {
  it("stores parsed prefs, sets PREFS_DONE, then onPrefsDone(plan, event)", async () => {
    await handlePrefsText(ctx({ stage: "BUDGET_LOCKED" }), ev("thai please"));
    expect(m.llm.parsePreferences).toHaveBeenCalledWith({ user_first_name: "Sam", stage: "prefs", message_text: "thai please" });
    expect(m.upsertPrefs).toHaveBeenCalledWith(PLAN, USER, expect.objectContaining({ cuisines_like: ["thai"] }));
    expect(m.setStage).toHaveBeenCalledWith(PLAN, USER, "PREFS_DONE");
    expect(m.onPrefsDone).toHaveBeenCalledWith(PLAN, "evt_1");
  });

  it("an invalid parse stores empty prefs", async () => {
    m.llm.parsePreferences.mockResolvedValueOnce({ cuisines_like: [], cuisines_avoid: [], dietary: [], vibe: [], earliest_start: "10pm", latest_end: null, dealbreakers: [] });
    await handlePrefsText(ctx({ stage: "BUDGET_LOCKED" }), ev("x"));
    expect(m.upsertPrefs).toHaveBeenCalledWith(PLAN, USER, expect.objectContaining({ earliest_start: null, cuisines_like: [] }));
  });
});

describe("I only know yours", () => {
  it("mentionsOthersBudget: money word AND another member's name (word match) or a group word", () => {
    expect(mentionsOthersBudget("what's Alex's budget?", ["Alex"])).toBe(true);
    expect(mentionsOthersBudget("can ALEX afford it", ["alex"])).toBe(true);
    expect(mentionsOthersBudget("what can everyone spend", [])).toBe(true);
    expect(mentionsOthersBudget("Alexandra's max?", ["Alex"])).toBe(false);
    expect(mentionsOthersBudget("is Alex coming?", ["Alex"])).toBe(false);
    expect(mentionsOthersBudget("my budget is fine", ["Alex"])).toBe(false);
    expect(mentionsOthersBudget("budget of J.D.?", ["J.D."])).toBe(true);
    // A friend named Max is not a money word.
    expect(mentionsOthersBudget("is Max coming?", ["Max"])).toBe(false);
    expect(mentionsOthersBudget("is max coming tonight", ["Max", "Sam"])).toBe(false);
    expect(mentionsOthersBudget("what's Max's budget?", ["Max"])).toBe(true);
    expect(mentionsOthersBudget("can Max afford it", ["Max"])).toBe(true);
    expect(mentionsOthersBudget("does everyone like Max", ["Max"])).toBe(false);
  });

  it("free text about another member's budget → T_ONLY_YOURS threaded, no LLM call", async () => {
    m.members.mockResolvedValueOnce([member(USER, "Sam"), member("33333333-3333-4333-8333-333333333333", "Alex")]);
    await handleFreeText(ctx().user, ctx({ stage: "PREFS_DONE" }), ev("what's Alex's budget"));
    expect(m.notify).toHaveBeenCalledWith(USER, "T_ONLY_YOURS", {}, { key: "reply:pho_msg_1:1", planId: PLAN, replyTo: "pho_msg_1" });
    expect(m.llm.parseBallot).not.toHaveBeenCalled();
  });

  it("free text: LLM intent ask_about_others → T_ONLY_YOURS; otherwise T_HELP (works with no plan)", async () => {
    m.llm.parseBallot.mockResolvedValueOnce({ approvals: [], constraints: [], none_of_these: false, intent: "ask_about_others", confidence: "high" });
    await handleFreeText(ctx().user, null, ev("why is this so cheap, who's broke?"));
    expect(m.llm.parseBallot).toHaveBeenCalledWith({ user_first_name: "Sam", stage: "free", message_text: "why is this so cheap, who's broke?" }, []);
    await handleFreeText(ctx().user, null, ev("hello"));
    expect(sent().map((s) => s[0])).toEqual(["T_ONLY_YOURS", "T_HELP"]);
  });
});

describe("ballot delegate", () => {
  const sl: PublicBundle[] = [1, 2, 3].map((i) => ({
    id: `bnd_${i}`, index: i, title: `T${i}`, dinner_name: "d", show_name: "s", dinner_time: "18:30", show_start: "20:00",
    show_end_est: "22:00", all_in_pp_cents: 4599, dietary_fit: [], pitch: "p",
  }));

  it("records a delegate ballot against the public shortlist", async () => {
    m.shortlist.mockResolvedValueOnce(sl);
    const parse: BallotParse = { approvals: [1, 3], constraints: [{ kind: "end_before", time: "22:30" }], none_of_these: false, intent: "ballot", confidence: "high" };
    m.llm.parseBallot.mockResolvedValueOnce(parse);
    const c = ctx({ stage: "PREFS_DONE", state: "VOTING" });
    await handleBallotText(c, ev("1 or 3 if it ends before 10:30"));
    expect(m.shortlist).toHaveBeenCalledWith(PLAN, 2);
    expect(m.llm.parseBallot).toHaveBeenCalledWith({ user_first_name: "Sam", stage: "ballot", message_text: "1 or 3 if it ends before 10:30" }, sl);
    expect(m.recordBallot).toHaveBeenCalledWith(c, parse, "delegate", expect.objectContaining({ event_id: "evt_1" }));
  });

  it("none of these → empty approvals", async () => {
    m.llm.parseBallot.mockResolvedValueOnce({ approvals: [2], constraints: [], none_of_these: true, intent: "ballot", confidence: "high" });
    await handleBallotText(ctx({ state: "VOTING" }), ev("none of these"));
    expect((m.recordBallot.mock.calls[0]![1] as BallotParse).approvals).toEqual([]);
  });

  it("unclear → T_BALLOT_CLARIFY once per version, then T_HELP", async () => {
    await handleBallotText(ctx({ state: "VOTING" }), ev("hmm"));
    m.notify.mockResolvedValueOnce("duplicate");
    await handleBallotText(ctx({ state: "VOTING" }), ev("hmm?"));
    expect(sent()).toEqual([
      ["T_BALLOT_CLARIFY", {}, `tpl:${PLAN}:${USER}:T_BALLOT_CLARIFY:2`],
      ["T_BALLOT_CLARIFY", {}, `tpl:${PLAN}:${USER}:T_BALLOT_CLARIFY:2`],
      ["T_HELP", {}, "reply:pho_msg_1:1"],
    ]);
    expect(m.recordBallot).not.toHaveBeenCalled();
  });

  it("asking about another member mid-vote → T_ONLY_YOURS, no ballot", async () => {
    m.llm.parseBallot.mockResolvedValueOnce({ approvals: [], constraints: [], none_of_these: false, intent: "ask_about_others", confidence: "high" });
    await handleBallotText(ctx({ state: "VOTING" }), ev("why did 2 get cut, was it someone's money?"));
    expect(sent()).toEqual([["T_ONLY_YOURS", {}, "reply:pho_msg_1:1"]]);
    expect(m.recordBallot).not.toHaveBeenCalled();
  });
});

describe("prompts and awaiting", () => {
  it("ballotExtra lists only public fields", () => {
    const b: PublicBundle = { id: "bnd_1", index: 1, title: "Dinner at A → Show at B", dinner_name: "A", show_name: "B", dinner_time: "18:30", show_start: "20:00", show_end_est: "22:15", all_in_pp_cents: 4599, dietary_fit: [], pitch: "p" };
    expect(ballotExtra([b])).toBe("Plans:\n1. Dinner at A → Show at B · dinner 18:30 → show 20:00–22:15 · $45 pp all-in");
    expect(ballotExtra([])).toBe("Plans: none yet.");
  });

  it("awaiting flags set/replace/clear per user", () => {
    expect(getAwaiting(USER)).toBeNull();
    setAwaiting(USER, "budget");
    setAwaiting(USER, "holdgate");
    expect(getAwaiting(USER)).toBe("holdgate");
    clearAwaiting(USER);
    expect(getAwaiting(USER)).toBeNull();
  });
});
