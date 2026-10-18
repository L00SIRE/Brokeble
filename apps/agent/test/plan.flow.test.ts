// plan/decision.ts + plan/membership.ts: recompute branches and membership flows with every collaborator mocked.
import type { Bundle, InboundEvent, Option } from "@tab/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MemberRow, PlanRow, UserRow } from "../src/repo/types";

const m = vi.hoisted(() => {
  const tx = { tx: true };
  return {
    tx,
    holders: [] as { user_id: string }[],
    sql: Object.assign(vi.fn(async () => [] as unknown[]), { begin: vi.fn(async (cb: (t: unknown) => Promise<unknown>) => cb(tx)) }),
    emit: vi.fn(async () => 1),
    enqueue: vi.fn(async () => true),
    startResearch: vi.fn(async () => {}),
    cancelResearch: vi.fn(async () => {}),
    computeShortlist: vi.fn(),
    confirmFormBudget: vi.fn(async () => false),
    fanout: vi.fn(async () => 1),
    notify: vi.fn(async () => "sent"),
    startPlanTyping: vi.fn(),
    stopPlanTyping: vi.fn(),
    writeBundles: vi.fn(async () => {}),
    getShortlist: vi.fn(async (): Promise<Bundle[]> => []),
    getParticipant: vi.fn(),
    listMembers: vi.fn(async (): Promise<MemberRow[]> => []),
    updateStage: vi.fn(),
    getPlan: vi.fn(),
    getPlanByCode: vi.fn(),
    mergeDeadlines: vi.fn(async () => {}),
    getUser: vi.fn(async () => ({ first_name: "Ana" })),
    sendStatus: vi.fn(async () => {}),
    cancel: vi.fn(async () => {}),
    maybeCloseVote: vi.fn(async () => {}),
    transition: vi.fn(),
  };
});
vi.mock("../src/db", () => ({ sql: m.sql }));
vi.mock("../src/events", () => ({ emit: m.emit }));
vi.mock("../src/dueJobs", async (orig) => ({ ...(await orig<typeof import("../src/dueJobs")>()), enqueue: m.enqueue }));
vi.mock("../src/creao/research", () => ({ startResearch: m.startResearch, cancelResearch: m.cancelResearch }));
vi.mock("../src/decide/score", () => ({ computeShortlist: m.computeShortlist }));
vi.mock("../src/delegates/budget", () => ({ confirmFormBudget: m.confirmFormBudget }));
vi.mock("../src/notify/fanout", () => ({ fanout: m.fanout }));
vi.mock("../src/notify/notify", async (orig) => ({ ...(await orig<typeof import("../src/notify/notify")>()), notify: m.notify }));
vi.mock("../src/notify/presence", () => ({ startPlanTyping: m.startPlanTyping, stopPlanTyping: m.stopPlanTyping }));
vi.mock("../src/notify/render", () => ({
  fmtDate: () => "Sat, Oct 17",
  picksLines: (bs: { index: number }[]) => bs.map((b) => `${b.index}.`).join("\n"),
  sanitizePitch: (s: string, max = 140) => s.replace(/\s+/g, " ").trim().slice(0, max),
}));
vi.mock("../src/repo/bundles", () => ({ writeBundles: m.writeBundles, getShortlist: m.getShortlist }));
vi.mock("../src/repo/participants", () => ({ getParticipant: m.getParticipant, listMembers: m.listMembers, updateStage: m.updateStage }));
vi.mock("../src/repo/plans", () => ({ getPlan: m.getPlan, getPlanByCode: m.getPlanByCode, mergeDeadlines: m.mergeDeadlines }));
vi.mock("../src/repo/users", () => ({ getUser: m.getUser }));
vi.mock("../src/router/handlers", () => ({ sendStatus: m.sendStatus }));
vi.mock("../src/plan/cancel", () => ({ cancel: m.cancel }));
vi.mock("../src/plan/ballots", () => ({ maybeCloseVote: m.maybeCloseVote }));
vi.mock("../src/jobs/ladder", () => ({}));
vi.mock("../src/plan/commit", () => ({}));
vi.mock("../src/plan/machine", async (orig) => ({ ...(await orig<typeof import("../src/plan/machine")>()), transition: m.transition }));

import { bundleTitle, onOptionsReady, recompute, toPublicBundle } from "../src/plan/decision";
import { onGo, onJoinText, onOut, onPrefsDone, setStage, triggerResearch } from "../src/plan/membership";

const PLAN = "3f1c2b8e-6a0d-4c1f-9e2a-7b5d4c3a2f10";
const plan = (o: Partial<PlanRow> = {}): PlanRow => ({
  id: PLAN, ref: "r", code: "4821", organizer_id: "u1", state: "VOTING", version: 2, title: "Dinner + show", area: "Westwood",
  event_date: "2026-10-17", time_start: "18:30", time_end: "23:00", party_target: 3, chosen_bundle_id: null, venue_order_id: null,
  deadlines: {}, created_at: new Date(), updated_at: new Date(), ...o,
});
const member = (user_id: string, stage: MemberRow["stage"], lane = 1): MemberRow =>
  ({ plan_id: PLAN, user_id, lane, stage, joined_at: new Date(), first_name: user_id, payer_ref: "p" });
const user = (id = "u1"): UserRow => ({ id, phone_e164: "+13105550100", first_name: "Ana", photon_user_id: null, payer_ref: "p", created_at: new Date() });
const ev = { event_id: "evt_1", message_id: "pho_msg_1" } as InboundEvent;

const opt = (category: "dinner" | "show", name: string): Option => ({
  id: `opt_${name}`, run_id: "rr", source: "cached", est_high_pp_cents: 3000,
  data: (category === "dinner"
    ? { category, name, address: "a", area: "Westwood", url: "https://x.test", price_tier: "$$", est_low_pp_usd: 20, est_high_pp_usd: 30,
        price_evidence_url: "https://x.test", dietary_fit: ["vegetarian"], pitch: "Cozy\nramen.", opens: "17:00", closes: "23:00", hours_evidence_url: "https://x.test" }
    : { category, name, address: "b", area: "Westwood", url: "https://y.test", price_tier: "$$", est_low_pp_usd: 20, est_high_pp_usd: 30,
        price_evidence_url: "https://y.test", dietary_fit: [], pitch: "Live  comedy.", show_start: "20:30", show_end_est: "22:00", showtime_evidence_url: "https://y.test" }) as unknown as Option["data"],
});
const bundle = (id: string): Bundle => ({
  id, dinner: opt("dinner", `D${id}`), show: opt("show", `S${id}`), dinner_time: "18:45", show_start: "20:30", show_end_est: "22:00", all_in_pp_cents: 5400,
});
const shortlistOf = (ids: string[]) => ({ from_count: 9, survived_count: ids.length + 1, survivors: [...ids.map(bundle), bundle("extra")], top3: ids.map(bundle) });

/** transition mock that behaves like the winner and runs inTx with the fake tx. */
const win = (version: number, from_state = "VOTING") =>
  m.transition.mockImplementationOnce(async (_p, _f, _t, o?: { inTx?: (tx: unknown, t: unknown) => Promise<void> }) => {
    const t = { id: PLAN, version, from_state };
    await o?.inTx?.(m.tx, t);
    return t;
  });

beforeEach(() => {
  vi.resetAllMocks();
  m.sql.mockImplementation(async () => m.holders);
  m.holders = [];
});

describe("public bundle mapping", () => {
  it("title and PublicBundle carry public fields only, with a sanitized ≤280-char pitch", () => {
    const b = bundle("b1");
    expect(bundleTitle(b)).toBe("Dinner at Db1 → Show at Sb1");
    const p = toPublicBundle(b, 2);
    expect(p).toEqual({
      id: "b1", index: 2, title: "Dinner at Db1 → Show at Sb1", dinner_name: "Db1", show_name: "Sb1", dinner_time: "18:45",
      show_start: "20:30", show_end_est: "22:00", all_in_pp_cents: 5400, dietary_fit: ["vegetarian"], pitch: "Cozy ramen. Live comedy.",
    });
  });
});

describe("recompute", () => {
  it("onOptionsReady enqueues the shared cross-owner recompute key", async () => {
    await onOptionsReady(PLAN);
    expect(m.enqueue).toHaveBeenCalledWith("recompute", `recompute:${PLAN}:options`, expect.any(Date), {}, { planId: PLAN });
  });

  it("ignores SHOWCASE and post-vote states", async () => {
    for (const state of ["SHOWCASE", "ORDERING", "CANCELLED"] as const) {
      m.getPlan.mockResolvedValueOnce(plan({ state }));
      await recompute(PLAN);
    }
    expect(m.computeShortlist).not.toHaveBeenCalled();
  });

  it("top3 < 3 → CANCELLED + T_NO_FIT, nothing written", async () => {
    m.getPlan.mockResolvedValue(plan({ state: "RESEARCHING", version: 1 }));
    m.computeShortlist.mockResolvedValue(shortlistOf(["a", "b"]));
    win(1, "RESEARCHING");
    await recompute(PLAN);
    expect(m.transition).toHaveBeenCalledWith(PLAN, ["RESEARCHING", "VOTING"], "CANCELLED", { version: 1 });
    expect(m.fanout).toHaveBeenCalledWith(PLAN, "T_NO_FIT", expect.any(Function), { version: 1 });
    expect(m.writeBundles).not.toHaveBeenCalled();
    expect(m.stopPlanTyping).toHaveBeenCalledWith(PLAN);
  });

  it("RESEARCHING → VOTING: bundles, shortlist event and vote deadline in the winning tx, then T_PICKS to active members", async () => {
    m.getPlan.mockResolvedValue(plan({ state: "RESEARCHING", version: 1 }));
    m.computeShortlist.mockResolvedValue(shortlistOf(["a", "b", "c"]));
    win(1, "RESEARCHING");
    await recompute(PLAN);

    expect(m.transition).toHaveBeenCalledWith(PLAN, "RESEARCHING", "VOTING", expect.objectContaining({ version: 1 }));
    expect(m.writeBundles).toHaveBeenCalledWith(PLAN, 1, expect.arrayContaining([expect.objectContaining({ id: "extra" })]), ["a", "b", "c"], m.tx);
    const shortlistEv = m.emit.mock.calls.map((c) => (c as unknown[])[0] as { type: string }).find((e) => e.type === "shortlist") as Record<string, unknown>;
    expect(shortlistEv).toMatchObject({ plan_id: PLAN, version: 1, from_count: 9, survived_count: 4 });
    expect((shortlistEv.bundles as { index: number }[]).map((b) => b.index)).toEqual([1, 2, 3]);
    expect(m.emit).toHaveBeenCalledWith(expect.objectContaining({ type: "shortlist" }), m.tx);
    expect(m.enqueue).toHaveBeenCalledWith("vote_deadline", `vote:${PLAN}:1`, expect.any(Date), { version: 1 }, { planId: PLAN, tx: m.tx });
    expect(m.mergeDeadlines).toHaveBeenCalledWith(PLAN, { vote_at: expect.any(String) }, m.tx);

    expect(m.fanout).toHaveBeenCalledTimes(1);
    const [, id, varsFor, o] = m.fanout.mock.calls[0]! as unknown as [string, string, () => { lines: string }, { version: number; only: (r: MemberRow) => boolean }];
    expect(id).toBe("T_PICKS");
    expect(varsFor().lines).toBe("1.\n2.\n3.");
    expect(o.version).toBe(1);
    expect(o.only(member("x", "PREFS_DONE"))).toBe(true);
    expect(o.only(member("y", "BUDGET_LOCKED"))).toBe(false);
    expect(o.only(member("z", "DECLINED"))).toBe(false);
  });

  it("lost RESEARCHING race → no fan-out", async () => {
    m.getPlan.mockResolvedValue(plan({ state: "RESEARCHING", version: 1 }));
    m.computeShortlist.mockResolvedValue(shortlistOf(["a", "b", "c"]));
    m.transition.mockResolvedValueOnce(null);
    await recompute(PLAN);
    expect(m.fanout).not.toHaveBeenCalled();
  });

  it("VOTING unchanged → T_PICKS only to newcomers, no version bump, then maybeCloseVote", async () => {
    m.getPlan.mockResolvedValue(plan({ state: "VOTING", version: 2 }));
    m.computeShortlist.mockResolvedValue(shortlistOf(["a", "b", "c"]));
    m.getShortlist.mockResolvedValue(["a", "b", "c"].map(bundle));
    m.holders = [{ user_id: "old" }];
    await recompute(PLAN);
    expect(m.transition).not.toHaveBeenCalled();
    expect(m.fanout).toHaveBeenCalledTimes(1);
    const o = (m.fanout.mock.calls[0] as unknown[])[3] as { version: number; only: (r: MemberRow) => boolean };
    expect((m.fanout.mock.calls[0] as unknown[])[1]).toBe("T_PICKS");
    expect(o.version).toBe(2);
    expect(o.only(member("old", "VOTED"))).toBe(false);
    expect(o.only(member("new", "PREFS_DONE"))).toBe(true);
    expect(m.maybeCloseVote).toHaveBeenCalledWith(PLAN, 2);
  });

  it("VOTING changed → version bump, VOTED lanes reset, REFRESH to holders and PICKS to newcomers", async () => {
    m.getPlan.mockResolvedValue(plan({ state: "VOTING", version: 2 }));
    m.computeShortlist.mockResolvedValue(shortlistOf(["a", "c", "d"]));
    m.getShortlist.mockResolvedValue(["a", "b", "c"].map(bundle));
    m.holders = [{ user_id: "old" }];
    m.listMembers.mockResolvedValue([member("old", "VOTED", 1), member("new", "PREFS_DONE", 2)]);
    m.updateStage.mockResolvedValue({ lane: 1 });
    win(3);
    await recompute(PLAN);

    expect(m.transition).toHaveBeenCalledWith(PLAN, "VOTING", "VOTING", expect.objectContaining({ version: 2, bumpVersion: true }));
    expect(m.writeBundles).toHaveBeenCalledWith(PLAN, 3, expect.any(Array), ["a", "c", "d"], m.tx);
    expect(m.enqueue).toHaveBeenCalledWith("vote_deadline", `vote:${PLAN}:3`, expect.any(Date), { version: 3 }, { planId: PLAN, tx: m.tx });
    expect(m.updateStage).toHaveBeenCalledWith(PLAN, "old", "PREFS_DONE", m.tx);
    expect(m.updateStage).toHaveBeenCalledTimes(1);
    expect(m.emit).toHaveBeenCalledWith({ type: "vote.tally", plan_id: PLAN, voted: 0, total: 2 });

    const calls = m.fanout.mock.calls.map((c) => c as unknown as [string, string, unknown, { version: number; only: (r: MemberRow) => boolean }]);
    const picks = calls.find((c) => c[1] === "T_PICKS")!;
    const refresh = calls.find((c) => c[1] === "T_PICKS_REFRESH")!;
    expect(picks[3].version).toBe(3);
    expect(refresh[3].version).toBe(3);
    expect(picks[3].only(member("new", "PREFS_DONE"))).toBe(true);
    expect(picks[3].only(member("old", "PREFS_DONE"))).toBe(false);
    expect(refresh[3].only(member("old", "PREFS_DONE"))).toBe(true);
    expect(refresh[3].only(member("new", "PREFS_DONE"))).toBe(false);
  });

  it("VOTING changed but another recompute won the bump → nothing sent", async () => {
    m.getPlan.mockResolvedValue(plan({ state: "VOTING", version: 2 }));
    m.computeShortlist.mockResolvedValue(shortlistOf(["a", "c", "d"]));
    m.getShortlist.mockResolvedValue(["a", "b", "c"].map(bundle));
    m.transition.mockResolvedValueOnce(null);
    await recompute(PLAN);
    expect(m.fanout).not.toHaveBeenCalled();
    expect(m.updateStage).not.toHaveBeenCalled();
  });
});

describe("membership", () => {
  it("setStage writes the stage and emits `lane` (public fields only) in one transaction", async () => {
    m.updateStage.mockResolvedValueOnce({ lane: 2 });
    await setStage(PLAN, "u2", "GATED", { amountCents: 5400 });
    expect(m.updateStage).toHaveBeenCalledWith(PLAN, "u2", "GATED", m.tx);
    expect(m.emit).toHaveBeenCalledWith(
      { type: "lane", plan_id: PLAN, lane: 2, first_name: "Ana", stage: "GATED", amount_cents: 5400, cybs_id_short: null },
      m.tx,
    );
  });

  it("setStage on a missing participant emits nothing", async () => {
    m.updateStage.mockResolvedValueOnce(null);
    await setStage(PLAN, "u2", "VOTED");
    expect(m.emit).not.toHaveBeenCalled();
  });

  it("triggerResearch: winner enqueues still_looking in-tx, types, starts B's research", async () => {
    win(1, "COLLECTING");
    expect(await triggerResearch(PLAN)).toBe(true);
    expect(m.transition).toHaveBeenCalledWith(PLAN, "COLLECTING", "RESEARCHING", expect.any(Object));
    expect(m.enqueue).toHaveBeenCalledWith("still_looking", `still:${PLAN}`, expect.any(Date), {}, { planId: PLAN, tx: m.tx });
    expect(m.startPlanTyping).toHaveBeenCalledWith(PLAN);
    expect(m.startResearch).toHaveBeenCalledWith(PLAN);
  });

  it("triggerResearch loser does nothing", async () => {
    m.transition.mockResolvedValueOnce(null);
    expect(await triggerResearch(PLAN)).toBe(false);
    expect(m.startResearch).not.toHaveBeenCalled();
  });

  it("onPrefsDone: COLLECTING triggers at party_target; VOTING enqueues recompute keyed by trigger", async () => {
    m.getPlan.mockResolvedValueOnce(plan({ state: "COLLECTING", party_target: 3 }));
    m.listMembers.mockResolvedValueOnce([member("a", "PREFS_DONE"), member("b", "PREFS_DONE")]);
    await onPrefsDone(PLAN, "evt_9");
    expect(m.transition).not.toHaveBeenCalled();

    m.getPlan.mockResolvedValueOnce(plan({ state: "COLLECTING", party_target: 3 }));
    m.listMembers.mockResolvedValueOnce([member("a", "PREFS_DONE"), member("b", "PREFS_DONE"), member("c", "PREFS_DONE")]);
    win(1, "COLLECTING");
    await onPrefsDone(PLAN, "evt_9");
    expect(m.startResearch).toHaveBeenCalledWith(PLAN);

    m.getPlan.mockResolvedValueOnce(plan({ state: "VOTING" }));
    await onPrefsDone(PLAN, "evt_9");
    expect(m.enqueue).toHaveBeenCalledWith("recompute", `recompute:${PLAN}:evt_9`, expect.any(Date), {}, { planId: PLAN });
  });

  it("onJoinText: unknown code or non-participant → T_NOT_IN_PLAN", async () => {
    m.getPlanByCode.mockResolvedValueOnce(null);
    await onJoinText(user(), "9999", ev);
    m.getPlanByCode.mockResolvedValueOnce(plan({ state: "COLLECTING" }));
    m.getParticipant.mockResolvedValueOnce(null);
    await onJoinText(user(), "4821", ev);
    m.getPlanByCode.mockResolvedValueOnce(plan({ state: "COLLECTING" }));
    m.getParticipant.mockResolvedValueOnce(member("u1", "DECLINED"));
    await onJoinText(user(), "4821", ev);
    expect(m.notify.mock.calls.map((c) => (c as unknown[])[1])).toEqual(["T_NOT_IN_PLAN", "T_NOT_IN_PLAN", "T_NOT_IN_PLAN"]);
  });

  it("onJoinText: INVITED → JOINED, welcome, then budget ask when no form budget", async () => {
    m.getPlanByCode.mockResolvedValueOnce(plan({ state: "COLLECTING", version: 1 }));
    m.getParticipant.mockResolvedValueOnce(member("u1", "INVITED"));
    m.updateStage.mockResolvedValueOnce({ lane: 1 });
    await onJoinText(user(), "4821", ev);
    expect(m.updateStage).toHaveBeenCalledWith(PLAN, "u1", "JOINED", m.tx);
    expect(m.notify).toHaveBeenCalledWith("u1", "T_JOIN_WELCOME", { title: "Dinner + show", date: "Sat, Oct 17" },
      expect.objectContaining({ key: `tpl:${PLAN}:u1:T_JOIN_WELCOME:1` }));
    expect(m.confirmFormBudget).toHaveBeenCalled();
    expect(m.notify).toHaveBeenLastCalledWith("u1", "T_BUDGET_ASK", {}, expect.objectContaining({ key: "reply:pho_msg_1:2" }));
  });

  it("onJoinText: a form budget skips the ask; past JOINED gets status", async () => {
    m.getPlanByCode.mockResolvedValueOnce(plan({ state: "COLLECTING" }));
    m.getParticipant.mockResolvedValueOnce(member("u1", "JOINED"));
    m.confirmFormBudget.mockResolvedValueOnce(true);
    await onJoinText(user(), "4821", ev);
    expect(m.notify.mock.calls.map((c) => (c as unknown[])[1])).toEqual(["T_JOIN_WELCOME"]);

    m.getPlanByCode.mockResolvedValueOnce(plan({ state: "VOTING" }));
    m.getParticipant.mockResolvedValueOnce(member("u1", "PREFS_DONE"));
    await onJoinText(user(), "4821", ev);
    expect(m.sendStatus).toHaveBeenCalledTimes(1);
  });

  it("onGo: organizer only; <2 ready → status; 2 ready → small-group warning once, then GO proceeds", async () => {
    const p = plan({ state: "COLLECTING", id: "a2b8c1d0-0000-4000-8000-000000000001" });
    const ctx = { user: user("u2"), plan: p, participant: member("u2", "PREFS_DONE") };
    await onGo(ctx, ev);
    expect(m.notify).toHaveBeenLastCalledWith("u2", "T_ORGANIZER_ONLY", {}, expect.any(Object));

    const org = { ...ctx, user: user("u1") };
    m.getPlan.mockResolvedValue(p);
    m.listMembers.mockResolvedValue([member("a", "PREFS_DONE")]);
    await onGo(org, ev);
    expect(m.sendStatus).toHaveBeenCalledTimes(1);

    m.listMembers.mockResolvedValue([member("a", "PREFS_DONE"), member("b", "PREFS_DONE")]);
    await onGo(org, ev);
    expect(m.notify).toHaveBeenLastCalledWith("u1", "T_SMALL_GROUP", {}, expect.any(Object));
    expect(m.transition).not.toHaveBeenCalled();

    win(1, "COLLECTING");
    await onGo(org, ev);
    expect(m.startResearch).toHaveBeenCalledWith(p.id);
  });

  it("onOut in VOTING: DECLINED + ack, then recompute; <2 left → CANCELLED fan-out instead", async () => {
    const ctx = { user: user("u3"), plan: plan(), participant: member("u3", "VOTED") };
    m.getPlan.mockResolvedValue(plan());
    m.getParticipant.mockResolvedValue(member("u3", "VOTED"));
    m.updateStage.mockResolvedValue({ lane: 3 });
    m.listMembers.mockResolvedValueOnce([member("a", "VOTED"), member("b", "PREFS_DONE")]);
    await onOut(ctx, ev, "member_out");
    expect(m.updateStage).toHaveBeenCalledWith(PLAN, "u3", "DECLINED", m.tx);
    expect(m.notify).toHaveBeenCalledWith("u3", "T_OUT_ACK", { title: "Dinner + show" }, expect.objectContaining({ key: `tpl:${PLAN}:u3:T_OUT_ACK:2` }));
    expect(m.enqueue).toHaveBeenCalledWith("recompute", `recompute:${PLAN}:evt_1`, expect.any(Date), {}, { planId: PLAN });

    vi.clearAllMocks();
    m.listMembers.mockResolvedValueOnce([member("a", "VOTED")]);
    win(3);
    await onOut(ctx, ev, "member_out");
    expect(m.transition).toHaveBeenCalledWith(PLAN, ["RESEARCHING", "VOTING"], "CANCELLED");
    expect(m.fanout).toHaveBeenCalledWith(PLAN, "T_CANCELLED", expect.any(Function), { version: 3 });
    expect(m.cancelResearch).toHaveBeenCalledWith(PLAN);
    expect(m.enqueue).not.toHaveBeenCalled();
  });

  it("onOut in APPROVING → cancel(reason); after commit → status only", async () => {
    const ctx = { user: user("u3"), plan: plan(), participant: member("u3", "GATED") };
    m.getPlan.mockResolvedValueOnce(plan({ state: "APPROVING" }));
    m.getParticipant.mockResolvedValueOnce(member("u3", "GATED"));
    m.updateStage.mockResolvedValue({ lane: 3 });
    await onOut(ctx, null, "holdgate_no");
    expect(m.cancel).toHaveBeenCalledWith(PLAN, "holdgate_no");

    m.getPlan.mockResolvedValueOnce(plan({ state: "CONFIRMED" }));
    m.getParticipant.mockResolvedValueOnce(member("u3", "CAPTURED"));
    await onOut(ctx, ev, "member_out");
    expect(m.sendStatus).toHaveBeenCalledTimes(1);
    expect(m.cancel).toHaveBeenCalledTimes(1);
  });
});
