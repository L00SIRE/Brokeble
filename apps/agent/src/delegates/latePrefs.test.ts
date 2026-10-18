// Late preference updates (after the prefs answer): merge into the member's own row, recompute, truthful fixed reply.
import type { BallotParse, InboundEvent, Preferences } from "@tab/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MemberContext, PlanState } from "../repo/types";

function P(o: Partial<Preferences> = {}): Preferences {
  return { cuisines_like: [], cuisines_avoid: [], dietary: [], vibe: [], earliest_start: null, latest_end: null, dealbreakers: [], ...o };
}

const m = vi.hoisted(() => ({
  notify: vi.fn(async (..._a: unknown[]) => "sent" as string),
  enqueue: vi.fn(async (..._a: unknown[]) => true),
  upsert: vi.fn(async (..._a: unknown[]) => {}),
  getPrefs: vi.fn(async (..._a: unknown[]): Promise<Preferences | null> => null),
  researchReady: vi.fn(async (..._a: unknown[]) => true),
  converse: vi.fn(async (..._a: unknown[]): Promise<unknown> => null),
  recordBallot: vi.fn(async (..._a: unknown[]) => {}),
  ports: { llm: {} as Record<string, unknown> },
  llm: {
    parsePreferences: vi.fn(async (..._a: unknown[]): Promise<unknown> => null),
    parseBallot: vi.fn(async (..._a: unknown[]): Promise<BallotParse> => ({ approvals: [], constraints: [], none_of_these: false, intent: "other", confidence: "high" })),
  },
}));

vi.mock("../notify/notify", () => ({ notify: m.notify, replyKey: (id: string, n: number) => `reply:${id}:${n}`, tplKey: () => "tpl" }));
vi.mock("../notify/render", () => ({ usd0: () => "", fmtDate: () => "", fmtDeadline: () => "" }));
vi.mock("../dueJobs", () => ({ enqueue: m.enqueue, jobKeys: {} }));
vi.mock("../jobs/kinds", () => ({ A_JOB_KINDS: { recompute: "recompute" }, aJobKeys: { recompute: (p: string, t: string) => `recompute:${p}:${t}` } }));
vi.mock("../creao/research", () => ({ researchReady: m.researchReady }));
vi.mock("../repo/preferences", () => ({ upsertPreferences: m.upsert, getPreferences: m.getPrefs, EMPTY_PREFERENCES: P() }));
vi.mock("../repo/participants", () => ({ listMembers: vi.fn(async () => []), countByStage: vi.fn(async () => ({})) }));
vi.mock("../repo/privateConstraints", () => ({ get: vi.fn(async () => null) }));
vi.mock("../repo/bundles", () => ({ getBundle: vi.fn(async () => null) }));
vi.mock("../repo/plans", () => ({ getPlan: vi.fn(async () => null) }));
vi.mock("../router/handlers", () => ({ handleCommand: vi.fn(async () => {}) }));
vi.mock("../plan/ballots", () => ({ recordBallot: m.recordBallot, publicShortlist: vi.fn(async () => []) }));
vi.mock("../events", () => ({ emit: vi.fn(async () => 1) }));
vi.mock("../ports", () => ({ ports: m.ports }));

const { maybeUpdatePrefs, mergePreferences } = await import("./latePrefs");
const { handleFreeText } = await import("./free");
const { handleBallotText } = await import("./ballot");

const PLAN = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const ev = (text: string): InboundEvent => ({
  event_id: "evt_9", seq: 1, message_id: "pho_msg_9", platform: "imessage", from_handle: "+15555550100", from_user_id: "u",
  agent_user_id: "a", space_id: "s", space_kind: "direct", content_type: "text", text, parent_message_id: null, received_at: "2026-10-17T20:00:00.000Z",
});
function ctx(state: PlanState, stage: MemberContext["participant"]["stage"] = "PREFS_DONE"): MemberContext {
  return {
    user: { id: USER, phone_e164: "+15555550100", first_name: "Sam", photon_user_id: null, payer_ref: "x", created_at: new Date() },
    plan: {
      id: PLAN, ref: PLAN, code: "1234", organizer_id: null, state, version: 2, title: "Fri", area: "Westwood", event_date: "2026-10-17",
      time_start: "18:00", time_end: "23:00", party_target: 3, chosen_bundle_id: null, venue_order_id: null, deadlines: {}, created_at: new Date(), updated_at: new Date(),
    },
    participant: { plan_id: PLAN, user_id: USER, lane: 2, stage, joined_at: new Date() },
  };
}
const sent = () => m.notify.mock.calls.map((c) => [c[1], (c[3] as { key: string }).key]);

beforeEach(() => {
  vi.clearAllMocks();
  m.ports.llm = m.llm;
  m.llm.parsePreferences.mockResolvedValue(P());
  m.llm.parseBallot.mockResolvedValue({ approvals: [], constraints: [], none_of_these: false, intent: "other", confidence: "high" });
  m.getPrefs.mockResolvedValue(null);
  m.researchReady.mockResolvedValue(true);
});

describe("mergePreferences", () => {
  it("unions lists, newest kept at the caps; a new avoid removes the same like and vice versa", () => {
    const old = P({ cuisines_like: ["beef", "thai", "a", "b", "c"], cuisines_avoid: ["pork"], dietary: ["vegan"], vibe: ["casual", "lively", "quiet"], dealbreakers: ["x", "y", "z"], earliest_start: "19:00" });
    const add = P({ cuisines_like: ["tenders"], cuisines_avoid: ["Beef"], dietary: ["halal"], vibe: ["trendy"], dealbreakers: ["w"], latest_end: "23:00" });
    const r = mergePreferences(old, add);
    expect(r.cuisines_like).toEqual(["thai", "a", "b", "c", "tenders"]);
    expect(r.cuisines_avoid).toEqual(["pork", "Beef"]);
    expect(r.dietary).toEqual(["vegan", "halal"]);
    expect(r.vibe).toEqual(["lively", "quiet", "trendy"]);
    expect(r.dealbreakers).toEqual(["y", "z", "w"]);
    expect(r.earliest_start).toBe("19:00");
    expect(r.latest_end).toBe("23:00");
    expect(mergePreferences(P({ earliest_start: "19:00" }), P({ earliest_start: "21:00" })).earliest_start).toBe("21:00");
  });
});

describe("maybeUpdatePrefs", () => {
  it("RESEARCHING, options ready: 'no beef' merges into own prefs, queues a recompute, confirms with the fixed template", async () => {
    m.getPrefs.mockResolvedValue(P({ cuisines_like: ["burgers"] }));
    m.llm.parsePreferences.mockResolvedValue(P({ cuisines_avoid: ["beef"] }));
    expect(await maybeUpdatePrefs(ctx("RESEARCHING"), ev("actually no beef"))).toBe(true);
    expect(m.llm.parsePreferences).toHaveBeenCalledWith({ user_first_name: "Sam", stage: "prefs", message_text: "actually no beef" });
    expect(m.upsert).toHaveBeenCalledWith(PLAN, USER, expect.objectContaining({ cuisines_like: ["burgers"], cuisines_avoid: ["beef"] }));
    expect(m.enqueue).toHaveBeenCalledWith("recompute", `recompute:${PLAN}:evt_9`, expect.any(Date), {}, { planId: PLAN });
    expect(sent()).toEqual([["T_PREFS_UPDATED", "reply:pho_msg_9:1"]]);
  });

  it("RESEARCHING with options still arriving: stored, no early recompute (it would find no bundles)", async () => {
    m.researchReady.mockResolvedValue(false);
    m.llm.parsePreferences.mockResolvedValue(P({ cuisines_like: ["chicken tenders"] }));
    expect(await maybeUpdatePrefs(ctx("RESEARCHING"), ev("I want chicken tenders"))).toBe(true);
    expect(m.upsert).toHaveBeenCalled();
    expect(m.enqueue).not.toHaveBeenCalled();
  });

  it("COLLECTING: stored without a recompute; VOTING: stored and recomputed", async () => {
    m.llm.parsePreferences.mockResolvedValue(P({ cuisines_avoid: ["pork"] }));
    await maybeUpdatePrefs(ctx("COLLECTING"), ev("no pork"));
    expect(m.upsert).toHaveBeenCalledTimes(1);
    expect(m.enqueue).not.toHaveBeenCalled();
    await maybeUpdatePrefs(ctx("VOTING", "VOTED"), ev("no pork"));
    expect(m.enqueue).toHaveBeenCalledTimes(1);
  });

  it("no change for: empty parse, a question, a member before PREFS_DONE, or a plan past voting", async () => {
    expect(await maybeUpdatePrefs(ctx("VOTING"), ev("thanks!"))).toBe(false);
    m.llm.parsePreferences.mockResolvedValue(P({ cuisines_avoid: ["beef"] }));
    expect(await maybeUpdatePrefs(ctx("VOTING"), ev("is there beef?"))).toBe(false);
    expect(await maybeUpdatePrefs(ctx("VOTING", "BUDGET_LOCKED"), ev("no beef"))).toBe(false);
    for (const s of ["ORDERING", "APPROVING", "COMMITTING", "CONFIRMED"] as const) expect(await maybeUpdatePrefs(ctx(s, "HELD"), ev("no beef"))).toBe(false);
    expect(m.upsert).not.toHaveBeenCalled();
    expect(m.enqueue).not.toHaveBeenCalled();
    expect(m.notify).not.toHaveBeenCalled();
  });
});

describe("routing into the update", () => {
  it("free text from a PREFS_DONE member updates prefs instead of the delegate's blind 'got it'", async () => {
    m.llm.parsePreferences.mockResolvedValue(P({ cuisines_avoid: ["beef"] }));
    m.ports.llm = { ...m.llm, converse: m.converse };
    await handleFreeText(ctx("RESEARCHING").user, ctx("RESEARCHING"), ev("no beef please"));
    expect(sent()).toEqual([["T_PREFS_UPDATED", "reply:pho_msg_9:1"]]);
    expect(m.converse).not.toHaveBeenCalled();
  });

  it("a parse with no preference falls through to the normal reply", async () => {
    await handleFreeText(ctx("RESEARCHING").user, ctx("RESEARCHING"), ev("ok cool"));
    expect(sent()).toEqual([["T_HELP", "reply:pho_msg_9:1"]]);
    expect(m.upsert).not.toHaveBeenCalled();
  });

  it("VOTING: a real delegate ballot is recorded and never read as a preference", async () => {
    m.llm.parsePreferences.mockResolvedValue(P({ cuisines_avoid: ["beef"] }));
    m.llm.parseBallot.mockResolvedValue({ approvals: [1, 3], constraints: [], none_of_these: false, intent: "ballot", confidence: "high" });
    await handleBallotText(ctx("VOTING"), ev("1 and 3, no beef"));
    expect(m.recordBallot).toHaveBeenCalledTimes(1);
    expect(m.upsert).not.toHaveBeenCalled();
  });

  it("VOTING: 'actually no beef' (not a vote) updates prefs and recomputes", async () => {
    m.llm.parsePreferences.mockResolvedValue(P({ cuisines_avoid: ["beef"] }));
    await handleBallotText(ctx("VOTING"), ev("actually no beef"));
    expect(m.recordBallot).not.toHaveBeenCalled();
    expect(m.upsert).toHaveBeenCalledTimes(1);
    expect(m.enqueue).toHaveBeenCalledTimes(1);
    expect(sent()).toEqual([["T_PREFS_UPDATED", "reply:pho_msg_9:1"]]);
  });
});
