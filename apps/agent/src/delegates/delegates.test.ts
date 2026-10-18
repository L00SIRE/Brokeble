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
  countByStage: vi.fn(async (..._a: unknown[]): Promise<Record<string, number>> => ({ PREFS_DONE: 2 })),
  getPrefs: vi.fn(async (..._a: unknown[]): Promise<Preferences | null> => null),
  listPc: vi.fn(async (..._a: unknown[]): Promise<unknown[]> => []),
  getPlan: vi.fn(async (..._a: unknown[]): Promise<unknown> => null),
  handleCommand: vi.fn(async (..._a: unknown[]) => {}),
  converse: vi.fn(async (..._a: unknown[]): Promise<unknown> => null),
  researchReady: vi.fn(async (..._a: unknown[]) => true),
  getBundle: vi.fn(async (..._a: unknown[]): Promise<unknown> => null),
  ports: { llm: {} as Record<string, unknown> },
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
vi.mock("../notify/render", () => ({ usd0: (c: number) => `$${Math.floor(c / 100)}`, fmtDate: () => "Sat, Oct 17", fmtDeadline: () => "9:05 PM" }));
vi.mock("../decide/filter", () => ({ effectiveHardMax: (c: { target_pp_cents: number; hard_max_pp_cents: number | null }) => c.hard_max_pp_cents ?? Math.round(c.target_pp_cents * 1.1) }));
vi.mock("../plan/membership", () => ({ setStage: m.setStage, onPrefsDone: m.onPrefsDone }));
vi.mock("../repo/privateConstraints", () => ({ upsert: m.upsertPc, get: m.getPc, listForPlan: m.listPc }));
vi.mock("../repo/preferences", () => ({ upsertPreferences: m.upsertPrefs, getPreferences: m.getPrefs, EMPTY_PREFERENCES: { cuisines_like: [], cuisines_avoid: [], dietary: [], vibe: [], earliest_start: null, latest_end: null, dealbreakers: [] } }));
vi.mock("../repo/participants", () => ({ listMembers: m.members, countByStage: m.countByStage }));
vi.mock("../repo/plans", () => ({ getPlan: m.getPlan }));
vi.mock("../repo/bundles", () => ({ getBundle: m.getBundle }));
vi.mock("../router/handlers", () => ({ handleCommand: m.handleCommand }));
vi.mock("../dueJobs", () => ({ enqueue: m.enqueue, jobKeys: { recomputeOptions: (p: string) => `recompute:${p}:options` } }));
vi.mock("../jobs/kinds", () => ({ A_JOB_KINDS: { recompute: "recompute" }, aJobKeys: { recompute: (p: string, t: string) => `recompute:${p}:${t}` } }));
vi.mock("../money/holdGate", () => ({ recheck: m.recheck }));
vi.mock("../plan/ballots", () => ({ recordBallot: m.recordBallot, publicShortlist: m.shortlist }));
vi.mock("../events", () => ({ emit: m.emit }));
// LLM_MODE=mock shape by default (no converse); converse tests swap in a converser.
vi.mock("../ports", () => ({ ports: m.ports }));
vi.mock("../creao/research", () => ({ researchReady: m.researchReady }));

const { acceptBudget, acceptedBudget, applyTier, confirmFormBudget, handleBudgetText, TIER_MAP } = await import("./budget");
const { handlePrefsText } = await import("./prefs");
const { handleBallotText } = await import("./ballot");
const { handleFreeText, mentionsOthersBudget, OUT_HINT } = await import("./free");
const { buildConverseInput, converseFacts, guardReply } = await import("./converse");
const { buildDelegateInput } = await import("./input");
const { clearAwaiting, getAwaiting, setAwaiting } = await import("./awaiting");
const { ballotExtra } = await import("./prompts");

const THAI: Preferences = { cuisines_like: ["thai"], cuisines_avoid: [], dietary: [], vibe: [], earliest_start: null, latest_end: null, dealbreakers: [] };
const NO_PREFS: Preferences = { cuisines_like: [], cuisines_avoid: [], dietary: [], vibe: [], earliest_start: null, latest_end: null, dealbreakers: [] };
const PLAN = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const ev = (text: string): InboundEvent => ({
  event_id: "evt_1", seq: 1, message_id: "pho_msg_1", platform: "imessage", from_handle: "+15555550100", from_user_id: "u",
  agent_user_id: "a", space_id: "s", space_kind: "direct", content_type: "text", text, parent_message_id: null, received_at: "2026-10-17T20:00:00.000Z",
});
function ctx(o: { stage?: MemberContext["participant"]["stage"]; state?: PlanState; order?: string | null; chosen?: string | null } = {}): MemberContext {
  return {
    user: { id: USER, phone_e164: "+15555550100", first_name: "Sam", photon_user_id: null, payer_ref: "x", created_at: new Date() },
    plan: {
      id: PLAN, ref: PLAN, code: "1234", organizer_id: null, state: o.state ?? "COLLECTING", version: 2, title: "Fri", area: "Westwood",
      event_date: "2026-10-17", time_start: "18:00", time_end: "23:00", party_target: 3, chosen_bundle_id: o.chosen ?? null, venue_order_id: o.order ?? null,
      deadlines: {}, created_at: new Date(), updated_at: new Date(),
    },
    participant: { plan_id: PLAN, user_id: USER, lane: 2, stage: o.stage ?? "JOINED", joined_at: new Date() },
  };
}
const member = (user_id: string, first_name: string): MemberRow => ({ plan_id: PLAN, user_id, lane: 1, stage: "PREFS_DONE", joined_at: new Date(), first_name, payer_ref: "y" });
const sent = () => m.notify.mock.calls.map((c) => [c[1], c[2], (c[3] as { key: string }).key]);

beforeEach(() => {
  vi.clearAllMocks();
  m.ports.llm = m.llm;
  m.llm.parsePreferences.mockResolvedValue(THAI);
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

describe("acceptedBudget (low-confidence safety net)", () => {
  const p = (t: number, h: number | null, confidence: "high" | "low" = "low"): BudgetParse => ({ target_pp_cents: t, hard_max_pp_cents: h, confidence });
  it.each([
    // A single number stated as a ceiling, matching the parse: accepted, and the cap word makes it the hard max.
    [p(1500, 1500), "my max is 15 now", { target_pp_cents: 1500, hard_max_pp_cents: 1500 }],
    [p(2000, null), "20 tops", { target_pp_cents: 2000, hard_max_pp_cents: 2000 }],
    [p(4000, 4000), "$40 is my limit", { target_pp_cents: 4000, hard_max_pp_cents: 4000 }],
    [p(1250, 1250), "12.50 max", { target_pp_cents: 1250, hard_max_pp_cents: 1250 }],
    // A high-confidence parse is taken as is.
    [p(6000, 8000, "high"), "60ish, could stretch to 80", { target_pp_cents: 6000, hard_max_pp_cents: 8000 }],
    // Everything else stays unclear.
    [p(1500, 1500), "15", null], // no cap word
    [p(1500, 2000), "15 max, 20 tops", null], // two numbers
    [p(1500, 2000), "my max is 15 now", null], // parse disagrees on the max
    [p(2500, 2500), "my max is 15 now", null], // parse disagrees on the number
    [p(1500, 1500), "is 15 max ok?", null], // a question
    [p(1500, 1500), "not 15 max", null], // a negation
    [p(400, 400), "4 max", null], // out of range (< $5)
    [p(0, null), "my max is 15 now", null], // LLM failure (LOW_BUDGET) never accepts
    [null, "my max is 15 now", null],
  ] as const)("%j + %j → %j", (b, text, out) => expect(acceptedBudget(b as BudgetParse | null, text)).toEqual(out));
});

describe("budget delegate", () => {
  it("'my max is 15 now' parsed with low confidence still locks $15/$15 (no tiers menu)", async () => {
    m.llm.parseBudget.mockResolvedValueOnce({ target_pp_cents: 1500, hard_max_pp_cents: 1500, confidence: "low" });
    setAwaiting(USER, "budget");
    await handleBudgetText(ctx(), ev("my max is 15 now"));
    expect(m.upsertPc).toHaveBeenCalledWith(expect.objectContaining({ target_pp_cents: 1500, hard_max_pp_cents: 1500, source: "dm", confidence: "high" }));
    expect(sent()[0]).toEqual(["T_BUDGET_CONFIRM", { target: "$15", max: "$15" }, "reply:pho_msg_1:1"]);
    expect(getAwaiting(USER)).toBeNull();
  });

  it("unclear with an `unclear` handler that replies: no tiers menu, awaiting flag untouched", async () => {
    setAwaiting(USER, "tiers");
    const unclear = vi.fn(async () => true);
    await handleBudgetText(ctx(), ev("wait what does that mean"), unclear);
    expect(unclear).toHaveBeenCalledOnce();
    expect(sent()).toEqual([]);
    expect(getAwaiting(USER)).toBe("tiers");
    expect(m.upsertPc).not.toHaveBeenCalled();
  });

  it("unclear with an `unclear` handler that can't reply: tiers menu as before", async () => {
    const unclear = vi.fn(async () => false);
    await handleBudgetText(ctx(), ev("huh?"), unclear);
    expect(sent()).toEqual([["T_BUDGET_TIERS", {}, "reply:pho_msg_1:1"]]);
    expect(getAwaiting(USER)).toBe("tiers");
  });

  it("an accepted budget never consults the `unclear` handler", async () => {
    m.llm.parseBudget.mockResolvedValueOnce({ target_pp_cents: 4000, hard_max_pp_cents: null, confidence: "high" });
    const unclear = vi.fn(async () => true);
    await handleBudgetText(ctx(), ev("can it be like forty?"), unclear);
    expect(unclear).not.toHaveBeenCalled();
    expect(sent()[0]![0]).toBe("T_BUDGET_CONFIRM");
  });

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
    expect(sent()).toEqual([["T_BUDGET_CONFIRM", { target: "$40", max: "$50" }, "reply:pho_msg_1:1"]]);
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
    // No converser (mock LLM): a plain acknowledgement plus the code-written next step, never silence.
    expect(sent()).toEqual([["T_DELEGATE_REPLY", { text: "Got it, noted! Waiting on 1 more friend to finish up, then I'll start looking for dinner and a show." }, "reply:pho_msg_1:1"]]);
  });

  it("an invalid parse stores empty prefs", async () => {
    m.llm.parsePreferences.mockResolvedValueOnce({ cuisines_like: [], cuisines_avoid: [], dietary: [], vibe: [], earliest_start: "10pm", latest_end: null, dealbreakers: [] });
    await handlePrefsText(ctx({ stage: "BUDGET_LOCKED" }), ev("x"));
    expect(m.upsertPrefs).toHaveBeenCalledWith(PLAN, USER, expect.objectContaining({ earliest_start: null, cuisines_like: [] }));
  });
});

describe("conversational delegate", () => {
  const ALEX = "33333333-3333-4333-8333-333333333333";
  const said = (reply: string, intent = "chat", confidence = "high") => m.converse.mockResolvedValueOnce({ reply, intent, confidence });
  const pc = (user_id: string, target: number, max: number | null) => ({ plan_id: PLAN, user_id, target_pp_cents: target, hard_max_pp_cents: max, source: "dm", confidence: "high", confirmed_at: null });
  beforeEach(() => {
    m.ports.llm = { ...m.llm, converse: m.converse };
    m.llm.parsePreferences.mockResolvedValue(NO_PREFS); // free text here states no preference (late-prefs tests: latePrefs.test.ts)
  });

  it("free text gets the delegate's own words as T_DELEGATE_REPLY, from own-data-only context", async () => {
    m.members.mockResolvedValueOnce([member(USER, "Sam"), member(ALEX, "Alex")]);
    m.getPrefs.mockResolvedValueOnce({ cuisines_like: ["sushi"], cuisines_avoid: [], dietary: [], vibe: [], earliest_start: null, latest_end: null, dealbreakers: [] });
    m.getPc.mockResolvedValueOnce(pc(USER, 3117, 4000));
    m.listPc.mockResolvedValueOnce([pc(USER, 3117, 4000), pc(ALEX, 4729, 5211)]);
    said("Haha all good! Waiting on one more friend, then I'll start hunting for dinner and a show 🍣");
    await handleFreeText(ctx().user, ctx({ stage: "PREFS_DONE" }), ev("ok what's next lol"));
    expect(sent()).toEqual([["T_DELEGATE_REPLY", { text: "Haha all good! Waiting on one more friend, then I'll start hunting for dinner and a show 🍣" }, "reply:pho_msg_1:1"]]);
    expect(m.llm.parseBallot).not.toHaveBeenCalled();
    const input = m.converse.mock.calls[0]![0] as Record<string, unknown>;
    expect(input).toMatchObject({
      user_first_name: "Sam", mode: "chat", message_text: "ok what's next lol", my_budget_set: true, is_organizer: false,
      plan: { title: "Fri", date: "Sat, Oct 17", start_time: "6:00 PM", area: "Westwood" },
      where_things_stand: "Waiting on 1 more friend to finish up, then I'll start looking for dinner and a show.",
    });
    // P2/P7: no other member's name, id or any budget value (own included) is in the delegate's context, in either
    // the structured input or the plain-sentence form the model reads.
    const wire = JSON.stringify(input);
    for (const json of [JSON.stringify({ ...input }), wire]) {
      for (const leak of ["Alex", ALEX, "3117", "31.17", "4000", "4729", "5211", "47"]) expect(json).not.toContain(leak);
    }
    // The model reads facts as sentences plus their message: no field names or labels it could echo back.
    const read = JSON.parse(wire) as { facts: string[]; message: string };
    expect(Object.keys(read).sort()).toEqual(["facts", "message"]);
    expect(read.message).toBe("ok what's next lol");
    expect(read.facts).toEqual([
      "You're texting Sam.",
      "Their plan: Fri on Sat, Oct 17, starting around 6:00 PM, in Westwood.",
      "A friend invited them; they're one of the group.",
      "What's happening now: Waiting on 1 more friend to finish up, then I'll start looking for dinner and a show.",
      "What they're in the mood for: they'd like sushi.",
      "They've set their own private budget (you never see the amount).",
      'Words they can text: "status", "I\'m out", "change budget", "receipts", "forget me", "help".',
    ]);
  });

  // Every key and enum label of ConverseInput the model used to see as JSON ("Mode is chat, so...").
  const INTERNAL_LABELS = /_|\b(?:mode|stage|chat|prefs_ack|picks|commands|booked|true|false|null)\b\s*[:=]|\bmode\b|\bJSON\b/;

  it("the model's view states facts as plain sentences at every stage, including no plan yet", async () => {
    const prefs = { cuisines_like: [], cuisines_avoid: ["seafood"], dietary: ["gluten_free"], vibe: ["late_night"], earliest_start: null, latest_end: "22:00", dealbreakers: [] } as Preferences;
    m.getPrefs.mockResolvedValueOnce(prefs);
    const ack = converseFacts(await buildConverseInput(ctx().user, ctx({ stage: "PREFS_DONE" }), "gf, no seafood, late night", "prefs_ack"));
    expect(ack).toContain("What they're in the mood for: they'd rather skip seafood; they eat gluten free; they want a late night vibe; done by 10:00 PM.");
    expect(ack).toContain("They just answered your question about what they're in the mood for tonight, and you saved it.");

    const noPlan = await buildConverseInput({ ...ctx().user, first_name: "" }, null, "vegetarian!", "chat");
    expect(converseFacts(noPlan)).toEqual([
      "You're texting someone whose name you don't know yet.",
      "They aren't in a plan yet and want to start one. To set it up you still need where they want to go (a neighborhood or city) and how many people are coming, counting them.",
      'Words they can text: "help", "forget me".',
    ]);

    m.getBundle.mockResolvedValueOnce({
      id: "bnd_1", all_in_pp_cents: 4599, dinner_time: "19:30", show_start: "21:00", show_end_est: "22:30",
      dinner: { data: { name: "Sushi Go", address: "1100 Glendon Ave" } }, show: { data: { name: "Laugh Lab", address: "2200 Sawtelle Blvd" } },
    });
    const organizer = ctx({ stage: "HELD", state: "APPROVING", chosen: "bnd_1" });
    organizer.plan.organizer_id = USER;
    const held = converseFacts(await buildConverseInput(organizer.user, organizer, "where is dinner", "chat"));
    expect(held).toContain("They organized it and invited their friends.");
    expect(held).toContain("The group picked dinner at Sushi Go (1100 Glendon Ave) at 7:30 PM, then Laugh Lab (2200 Sawtelle Blvd) from 9:00 PM to about 10:30 PM. It isn't booked yet.");
    expect(held.at(-1)).toBe('Words they can text: "status", "I\'m out", "change budget", "receipts", "forget me", "help", "go" (start with whoever\'s ready), "wait", "cancel plan".');

    for (const facts of [ack, converseFacts(noPlan), held]) for (const f of facts) expect(f).not.toMatch(INTERNAL_LABELS);
  });

  it("a question at the first budget ask: the model is told the re-ask follows, and 'change budget' is not offered", async () => {
    const facts = converseFacts(await buildConverseInput(ctx().user, ctx({ stage: "JOINED" }), "wait, why do you need my budget?", "budget_question"));
    expect(facts).toContain(
      "You just asked for their private budget and they answered with a question. Your next text asks for the budget again, so only answer the question: don't ask for the budget yourself, don't say there's no rush, and don't tell them to text anything to set it.",
    );
    expect(facts.at(-1)).toBe('Words they can text: "status", "I\'m out", "receipts", "forget me", "help".');
    for (const f of facts) expect(f).not.toMatch(INTERNAL_LABELS);
  });

  it("guardReply blocks replies that echo internal field names or labels (the reply falls back to a template)", async () => {
    const input = await buildConverseInput(ctx().user, ctx({ stage: "PREFS_DONE" }), "vegetarian! my handle is sam_k", "chat");
    for (const leak of [
      "Got it, vegetarian noted. Mode is chat, so I'll hold that for when we pick a spot.",
      "You're at PREFS_DONE, so hang tight!",
      "where_things_stand says we're waiting on 1 more friend.",
      "Your stage is voting, so send your picks.",
      "VOTING is open, reply with your picks.",
      "Per the JSON you're all set.",
      "my_budget_set is true, so you're good!",
      "According to my notes you're all set.",
    ]) expect([leak, guardReply(leak, input)]).toEqual([leak, "internal"]);
    for (const fine of [
      "Got it, vegetarian noted! I'll text you once there's something to vote on.",
      "Voting is open, reply with the numbers you like.",
      "The comedians are on the main stage tonight, should be fun.",
      "Love it, sam_k it is.", // their own text, echoed back
    ]) expect([fine, guardReply(fine, input)]).toEqual([fine, "ok"]);
  });

  it("ask_about_others → fixed T_ONLY_YOURS; the generated text is discarded", async () => {
    said("I think Alex is around 50", "ask_about_others");
    await handleFreeText(ctx().user, ctx({ stage: "PREFS_DONE" }), ev("is alex broke or what"));
    expect(sent()).toEqual([["T_ONLY_YOURS", {}, "reply:pho_msg_1:1"]]);
  });

  it("wants_change_budget and wants_status route to the existing command handlers", async () => {
    const c = ctx({ stage: "PREFS_DONE" });
    said("Sure!", "wants_change_budget");
    await handleFreeText(c.user, c, ev("can i bump my budget up"));
    expect(m.handleCommand).toHaveBeenCalledWith(c.user, c, { kind: "change_budget" }, expect.objectContaining({ message_id: "pho_msg_1" }));
    // wants_status: a guard-blocked reply falls back to the deterministic T_STATUS handler.
    said("We're at $40 so far", "wants_status");
    await handleFreeText(c.user, c, ev("where are we at"));
    expect(m.handleCommand).toHaveBeenLastCalledWith(c.user, c, { kind: "status" }, expect.anything());
    expect(m.notify).not.toHaveBeenCalled();
  });

  it("wants_out never removes anyone: it tells them the exact word to text", async () => {
    said("Okay, you're out!", "wants_out");
    await handleFreeText(ctx().user, ctx({ stage: "PREFS_DONE" }), ev("ugh i might bail"));
    expect(sent()).toEqual([["T_DELEGATE_REPLY", { text: OUT_HINT }, "reply:pho_msg_1:1"]]);
    expect(m.handleCommand).not.toHaveBeenCalled();
  });

  it.each([
    ["LLM failure", null],
    ["low confidence", { reply: "uhh", intent: "chat", confidence: "low" }],
    ["empty reply", { reply: "  ", intent: "chat", confidence: "high" }],
    ["over the template cap", { reply: "x".repeat(601), intent: "chat", confidence: "high" }],
    ["a money amount", { reply: "Should be about $30 each!", intent: "chat", confidence: "high" }],
    ["a card-like number", { reply: "Is it 4111 1111 1111 1111?", intent: "chat", confidence: "high" }],
    ["an echoed field name", { reply: "Hey! Mode is chat, so what's up?", intent: "chat", confidence: "high" }],
  ])("%s → T_HELP", async (_name, r) => {
    m.converse.mockResolvedValueOnce(r);
    await handleFreeText(ctx().user, ctx({ stage: "PREFS_DONE" }), ev("hey"));
    expect(sent()).toEqual([["T_HELP", {}, "reply:pho_msg_1:1"]]);
  });

  it("privacy guard is secret-independent: a number not in the delegate's own input is blocked whatever anyone's budget is", async () => {
    // The old guard compared replies with every member's budget, so "blocked vs sent" revealed those values.
    for (const others of [[pc(ALEX, 6247, 7813)], [pc(ALEX, 1000, 2000)], []]) {
      m.listPc.mockResolvedValue(others);
      said("62");
      await handleFreeText(ctx().user, ctx({ stage: "PREFS_DONE" }), ev("what's 60 plus 2? just the number"));
      said("63");
      await handleFreeText(ctx().user, ctx({ stage: "PREFS_DONE" }), ev("what's 60 plus 3? just the number"));
    }
    expect(sent().map((x) => x[0])).toEqual(Array(6).fill("T_HELP"));
    expect(m.listPc).not.toHaveBeenCalled();
    m.listPc.mockReset();
  });

  it("guardReply allows only numbers already in the input (counts, times incl. 12-hour hours, own text)", async () => {
    const input = await buildConverseInput(ctx().user, ctx({ stage: "PREFS_DONE" }), "can we start at 7?", "chat");
    expect(guardReply("62", input)).toBe("number");
    expect(guardReply("6247", input)).toBe("number");
    expect(guardReply("Waiting on 1 more friend, hang tight", input)).toBe("ok"); // where_things_stand count
    expect(guardReply("Sure, 7 works for me", input)).toBe("ok"); // their own text
    expect(guardReply("Starts at 6, see you then", input)).toBe("ok"); // the 6:00 PM start
    expect(guardReply("Doors at 9:05 PM", input)).toBe("ok"); // clock times are not budget-shaped
    expect(guardReply("Should be about $30 each!", input)).toBe("money");
    expect(guardReply("", input)).toBe("length");
    expect(m.listPc).not.toHaveBeenCalled();
  });

  it("after the vote the delegate knows the winning pick (public names, addresses, times; never a price)", async () => {
    m.getBundle.mockResolvedValueOnce({
      id: "bnd_1", all_in_pp_cents: 4599, dinner_time: "19:30", show_start: "21:00", show_end_est: "22:30",
      dinner: { data: { name: "Sushi Go", address: "1100 Glendon Ave, Los Angeles" } },
      show: { data: { name: "Laugh Lab", address: "2200 Sawtelle Blvd, Los Angeles" } },
    });
    const c = ctx({ stage: "CAPTURED", state: "CONFIRMED", chosen: "bnd_1" });
    said("Dinner's at Sushi Go at 7:30 PM, then Laugh Lab at 9.");
    await handleFreeText(c.user, c, ev("what time is dinner?"));
    expect(m.getBundle).toHaveBeenCalledWith(PLAN, 2, "bnd_1");
    const input = m.converse.mock.calls[0]![0] as { chosen_plan: unknown };
    expect(input.chosen_plan).toEqual({
      booked: true, title: "Dinner at Sushi Go → Show at Laugh Lab", dinner_name: "Sushi Go", dinner_address: "1100 Glendon Ave, Los Angeles",
      dinner_time: "7:30 PM", show_name: "Laugh Lab", show_address: "2200 Sawtelle Blvd, Los Angeles", show_start: "9:00 PM", show_end: "10:30 PM",
    });
    expect(JSON.stringify(input)).not.toMatch(/45/);
    expect(sent()).toEqual([["T_DELEGATE_REPLY", { text: "Dinner's at Sushi Go at 7:30 PM, then Laugh Lab at 9." }, "reply:pho_msg_1:1"]]);
  });

  it("once booked, their earlier wishes are marked as not actionable (no 'I'll keep Italian in mind' after booking ramen)", async () => {
    m.getBundle.mockResolvedValueOnce({
      id: "bnd_1", all_in_pp_cents: 4599, dinner_time: "19:30", show_start: "21:00", show_end_est: "22:30",
      dinner: { data: { name: "Sushi Go", address: "1100 Glendon Ave" } }, show: { data: { name: "Laugh Lab", address: "2200 Sawtelle Blvd" } },
    });
    m.getPrefs.mockResolvedValueOnce({ cuisines_like: ["italian"], cuisines_avoid: [], dietary: [], vibe: ["lively"], earliest_start: null, latest_end: null, dealbreakers: [] } as Preferences);
    const facts = converseFacts(await buildConverseInput(ctx().user, ctx({ stage: "CAPTURED", state: "CONFIRMED", chosen: "bnd_1" }), "what's the plan?", "chat"));
    expect(facts).toContain("What they're in the mood for: they'd like italian; they want a lively vibe. The night is already booked, so only bring that up if they ask.");
  });

  it("no chosen_plan before the vote is decided", async () => {
    const input = await buildConverseInput(ctx().user, ctx({ state: "VOTING", stage: "PREFS_DONE", chosen: "bnd_1" }), "hi", "chat");
    expect(input.chosen_plan).toBeNull();
    expect(m.getBundle).not.toHaveBeenCalled();
  });

  it("ask_about_others without money ('who else is coming?') gets the guarded reply, not the budget template", async () => {
    said("I can't share who's in, but I'll text you the picks soon!", "ask_about_others");
    await handleFreeText(ctx().user, ctx({ stage: "PREFS_DONE" }), ev("wait, who else is coming tonight?"));
    expect(sent()).toEqual([["T_DELEGATE_REPLY", { text: "I can't share who's in, but I'll text you the picks soon!" }, "reply:pho_msg_1:1"]]);
  });

  it("'change my budget to 300 max' parses this same message instead of re-asking", async () => {
    m.llm.parseBudget.mockResolvedValueOnce({ target_pp_cents: 30000, hard_max_pp_cents: 30000, confidence: "high" });
    said("Sure!", "wants_change_budget");
    const c = ctx({ stage: "VOTED", state: "VOTING" });
    await handleFreeText(c.user, c, ev("actually can I change my budget to 300 max?"));
    expect(m.handleCommand).not.toHaveBeenCalled();
    expect(m.upsertPc).toHaveBeenCalledWith(expect.objectContaining({ target_pp_cents: 30000, hard_max_pp_cents: 30000, source: "dm" }));
    expect(sent()[0]).toEqual(["T_BUDGET_CONFIRM", { target: "$300", max: "$300" }, "reply:pho_msg_1:1"]);
  });

  it("a question at the prefs step is answered and re-asked; nothing is stored and the lane stays put", async () => {
    m.llm.parsePreferences.mockResolvedValueOnce({ cuisines_like: [], cuisines_avoid: [], dietary: [], vibe: [], earliest_start: null, latest_end: null, dealbreakers: [] });
    said("Just your crew from the join link! Anything you're craving?");
    await handlePrefsText(ctx({ stage: "BUDGET_LOCKED" }), ev("wait, who else is coming tonight?"));
    expect(m.upsertPrefs).not.toHaveBeenCalled();
    expect(m.setStage).not.toHaveBeenCalled();
    expect(m.onPrefsDone).not.toHaveBeenCalled();
    expect(sent()).toEqual([
      ["T_DELEGATE_REPLY", { text: "Just your crew from the join link! Anything you're craving?" }, "reply:pho_msg_1:1"],
      ["T_PREFS_ASK", {}, "reply:pho_msg_1:2"],
    ]);
  });

  it("voting: a question that picks nothing gets a natural reply even when the parser labels it a ballot", async () => {
    m.shortlist.mockResolvedValue([]);
    m.llm.parseBallot.mockResolvedValue({ approvals: [], constraints: [], none_of_these: false, intent: "ballot", confidence: "high" });
    // "10" is not in the delegate's input, so the guard blocks it and the ballot clarification follows.
    said("Yep, about a 10 minute walk from campus.");
    await handleBallotText(ctx({ stage: "PREFS_DONE", state: "VOTING" }), ev("is option 1 walkable from campus?"));
    said("Yep, it's an easy walk from campus.");
    await handleBallotText(ctx({ stage: "PREFS_DONE", state: "VOTING" }), ev("is option 1 walkable from campus?"));
    expect(sent().map((x) => x[0])).toEqual(["T_BALLOT_CLARIFY", "T_DELEGATE_REPLY"]);
    expect(m.recordBallot).not.toHaveBeenCalled();
    m.llm.parseBallot.mockReset();
    m.shortlist.mockReset();
  });

  it("prefs answer → natural, specific acknowledgement from the delegate (prefs extraction unchanged)", async () => {
    m.getPrefs.mockResolvedValueOnce({ cuisines_like: ["sushi"], cuisines_avoid: [], dietary: [], vibe: [], earliest_start: null, latest_end: null, dealbreakers: ["too spicy"] });
    said("Sushi and nothing too spicy, got it. I'll find you something good once everyone's in.");
    await handlePrefsText(ctx({ stage: "BUDGET_LOCKED" }), ev("sushi! nothing too spicy"));
    expect(m.llm.parsePreferences).toHaveBeenCalledOnce();
    expect(m.onPrefsDone).toHaveBeenCalledWith(PLAN, "evt_1");
    expect(m.converse.mock.calls[0]![0]).toMatchObject({ mode: "prefs_ack", my_preferences: { cuisines_like: ["sushi"], dealbreakers: ["too spicy"] } });
    expect(sent()).toEqual([["T_DELEGATE_REPLY", { text: "Sushi and nothing too spicy, got it. I'll find you something good once everyone's in." }, "reply:pho_msg_1:1"]]);
  });

  it("voting: a non-vote message reaches the delegate (with public picks, no prices); a vote is still recorded", async () => {
    const sl: PublicBundle[] = [{ id: "bnd_1", index: 1, title: "Dinner at A → Show at B", dinner_name: "A", show_name: "B", dinner_time: "18:30", show_start: "20:00", show_end_est: "22:15", all_in_pp_cents: 4599, dietary_fit: [], pitch: "p" }];
    m.shortlist.mockResolvedValue(sl);
    said("Anytime! Voting closes at 9:05 PM.");
    await handleBallotText(ctx({ stage: "VOTED", state: "VOTING" }), ev("thanks!!"));
    expect(sent()).toEqual([["T_DELEGATE_REPLY", { text: "Anytime! Voting closes at 9:05 PM." }, "reply:pho_msg_1:1"]]);
    const input = m.converse.mock.calls[0]![0] as { picks: string[] };
    expect(input.picks).toEqual(["1. Dinner at A → Show at B (dinner 6:30 PM, show 8:00 PM to 10:15 PM)"]);
    expect(JSON.stringify(input)).toContain("The picks up for a vote: 1. Dinner at A → Show at B (dinner 6:30 PM, show 8:00 PM to 10:15 PM).");
    for (const json of [JSON.stringify({ ...input }), JSON.stringify(input)]) expect(json).not.toMatch(/45/);
    m.llm.parseBallot.mockResolvedValueOnce({ approvals: [1], constraints: [], none_of_these: false, intent: "ballot", confidence: "high" });
    await handleBallotText(ctx({ stage: "PREFS_DONE", state: "VOTING" }), ev("the first one"));
    expect(m.recordBallot).toHaveBeenCalledOnce();
    expect(m.converse).toHaveBeenCalledOnce();
    m.shortlist.mockReset();
  });
});

describe("I only know yours", () => {
  beforeEach(() => {
    m.llm.parsePreferences.mockResolvedValue(NO_PREFS);
  });

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
  beforeEach(() => {
    m.llm.parsePreferences.mockResolvedValue(NO_PREFS);
  });

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
