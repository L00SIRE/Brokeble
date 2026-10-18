// Repo layer against real Postgres. DB-gated: runs only with TEST_DATABASE_URL (a throwaway database with
// db/migrations applied; never prod data). pay_links tests also need migration 004 and skip without it.
import { randomUUID } from "node:crypto";
import type { Bundle, ScoutOption } from "@tab/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "../db";
import * as assignments from "./assignments";
import * as ballots from "./ballots";
import * as bundles from "./bundles";
import * as dmRoutes from "./dmRoutes";
import * as holdGates from "./holdGates";
import * as inbound from "./inboundEvents";
import * as options from "./options";
import * as outbound from "./outbound";
import * as participants from "./participants";
import * as payLinks from "./payLinks";
import * as cursor from "./photonCursor";
import * as plans from "./plans";
import * as preferences from "./preferences";
import * as privateConstraints from "./privateConstraints";
import * as ratings from "./ratings";
import * as runs from "./researchRuns";
import { inTx, isUuid } from "./sql";
import type { PlanRow, UserRow } from "./types";
import * as users from "./users";

describe("isUuid", () => {
  it("accepts canonical uuids only", () => {
    expect(isUuid(randomUUID())).toBe(true);
    expect(isUuid("not-a-uuid")).toBe(false);
    expect(isUuid(`${randomUUID()}x`)).toBe(false);
  });
});

const tag = randomUUID().slice(0, 8);
const phonePrefix = String(Math.floor(Math.random() * 10_000)).padStart(4, "0");
const phone = (n: number) => `+1555${phonePrefix}${String(n).padStart(3, "0")}`;
const code = () => String(Math.floor(Math.random() * 10_000)).padStart(4, "0");

function scout(category: "dinner" | "show", name: string, usd: number): ScoutOption {
  const base = {
    name, address: `${name} 123 Main St`, area: "Westwood", url: "https://example.com/a", price_tier: "$25-50" as const,
    est_low_pp_usd: usd - 5, est_high_pp_usd: usd, price_evidence_url: "https://example.com/p", dietary_fit: [], pitch: "Good.",
  };
  return category === "dinner"
    ? { category, ...base, opens: "17:00", closes: "22:00", hours_evidence_url: "https://example.com/h" }
    : { category, ...base, show_start: "20:00", show_end_est: "21:30", showtime_evidence_url: "https://example.com/s" };
}

describe.skipIf(!process.env.TEST_DATABASE_URL)("repo (postgres)", () => {
  const userIds: string[] = [];
  const planIds: string[] = [];
  let hasPayLinks = false;

  async function newUser(n: number, name = "Ana"): Promise<UserRow> {
    const u = await users.upsertUserByPhone({ phone_e164: phone(n), first_name: name });
    userIds.push(u.id);
    return u;
  }
  async function newPlan(state: "COLLECTING" | "SHOWCASE" = "COLLECTING"): Promise<PlanRow> {
    for (;;) {
      try {
        const p = await plans.insertPlan({
          code: code(), title: `t ${tag}`, area: "Westwood", event_date: "2026-10-17", time_start: "18:30", time_end: "23:00",
          party_target: 3, organizer_id: null, state,
        });
        planIds.push(p.id);
        return p;
      } catch (e) {
        if ((e as { code?: string }).code !== "23505") throw e;
      }
    }
  }

  beforeAll(async () => {
    const [r] = await sql<{ t: string | null }[]>`select to_regclass('app.pay_links')::text as t`;
    hasPayLinks = r!.t !== null;
  });

  afterAll(async () => {
    for (const id of userIds) {
      await privateConstraints.deleteForUser(id);
      await preferences.deletePreferencesForUser(id);
      await ratings.deleteRatingsForUser(id);
      await ballots.deleteBallotsForUser(id);
      await holdGates.deleteHoldGatesForUser(id);
      if (hasPayLinks) await payLinks.deletePayLinksForUser(id);
      await dmRoutes.deleteDmRoute(id);
    }
    await sql`delete from app.outbound_messages where idempotency_key like ${`t:${tag}:%`}`;
    await sql`delete from app.inbound_events where event_id like ${`${tag}%`}`;
    await sql`delete from app.options where plan_id = any(${sql.array(planIds)}::uuid[])`;
    await sql`delete from app.bundles where plan_id = any(${sql.array(planIds)}::uuid[])`;
    await sql`delete from app.research_runs where plan_id = any(${sql.array(planIds)}::uuid[])`;
    await sql`delete from app.participants where plan_id = any(${sql.array(planIds)}::uuid[])`;
    await sql`delete from app.plans where id = any(${sql.array(planIds)}::uuid[])`;
    await sql`delete from app.assignments where user_id = any(${sql.array(userIds)}::uuid[])`;
    await sql`delete from app.users where id = any(${sql.array(userIds)}::uuid[])`;
    await sql.end({ timeout: 5 });
  });

  it("users: upsert by phone keeps id and payer_ref, updates first_name; scrub", async () => {
    const a = await newUser(1, "Ana");
    expect(a.payer_ref).toMatch(/^[0-9a-f]{32}$/);
    const again = await users.upsertUserByPhone({ phone_e164: a.phone_e164, first_name: "Anita" });
    expect(again).toMatchObject({ id: a.id, payer_ref: a.payer_ref, first_name: "Anita" });
    expect(again.created_at).toBeInstanceOf(Date);
    await users.setPhotonUserId(a.id, `ph_${tag}`);
    expect((await users.findUserByPhotonId(`ph_${tag}`))?.id).toBe(a.id);
    expect((await users.findUserByPhone(a.phone_e164))?.id).toBe(a.id);
    expect((await users.findUsersByPayerRefs([a.payer_ref, "0".repeat(32)])).map((u) => u.id)).toEqual([a.id]);
    expect(await users.findUsersByPayerRefs([])).toEqual([]);
    expect(await users.getUser("nope")).toBeNull();
    await users.scrubUser(a.id);
    expect(await users.getUser(a.id)).toMatchObject({ first_name: "(removed)", phone_e164: `forgotten:${a.id}`, photon_user_id: null });
  });

  it("dm routes and assignments", async () => {
    const u = await newUser(2);
    await users.setPhotonUserId(u.id, `ph2_${tag}`);
    expect(await dmRoutes.getDmRoute(u.id)).toBeNull();
    await dmRoutes.upsertDmRoute({ user_id: u.id, space_id: "sp1", agent_user_id: "ag1", agent_number: "+15550000000" });
    await dmRoutes.upsertDmRoute({ user_id: u.id, space_id: "sp2", agent_user_id: "ag2", agent_number: null });
    expect(await dmRoutes.getDmRoute(u.id)).toEqual({ userId: u.id, spaceId: "sp2", agentUserId: "ag2" });
    expect(await dmRoutes.findAgentUserIdByPhotonUser(`ph2_${tag}`)).toBe("ag2");

    const seat = { user_id: u.id, photon_assignment_id: `as_${tag}`, assigned_number: "+15551112222" };
    const a1 = await assignments.insertAssignment(seat);
    expect((await assignments.insertAssignment(seat)).id).toBe(a1.id);
    expect((await assignments.getActiveAssignment(u.id))?.id).toBe(a1.id);
    expect((await assignments.listActiveAssignmentsExcept([])).some((a) => a.id === a1.id)).toBe(true);
    expect((await assignments.listActiveAssignmentsExcept([u.phone_e164])).some((a) => a.id === a1.id)).toBe(false);
    await assignments.markAssignmentReleased(seat.photon_assignment_id);
    await assignments.markAssignmentReleased(seat.photon_assignment_id);
    expect(await assignments.getActiveAssignment(u.id)).toBeNull();
    expect(await assignments.countReleasedAssignments(u.id)).toBe(1);
  });

  it("plans: normalized columns, code collision is 23505, deadlines merge, lookups", async () => {
    const p = await newPlan();
    expect(p).toMatchObject({ state: "COLLECTING", version: 1, event_date: "2026-10-17", time_start: "18:30", time_end: "23:00", deadlines: {} });
    expect(p.code).toMatch(/^\d{4}$/);
    expect(isUuid(p.ref)).toBe(true);
    await expect(plans.insertPlan({ code: p.code, title: "dup", area: "Westwood", event_date: "2026-10-17", time_start: "18:30", time_end: "23:00", party_target: 3, organizer_id: null })).rejects.toMatchObject({ code: "23505" });
    expect((await plans.getPlanByCode(p.code))?.id).toBe(p.id);
    expect((await plans.getPlanByRef(p.ref))?.id).toBe(p.id);
    expect(await plans.getPlanByRef("garbage")).toBeNull();

    await plans.mergeDeadlines(p.id, { vote_at: "2026-10-17T21:40:00.000Z" });
    const approveAt = new Date("2026-10-17T22:40:00.000Z");
    await plans.setVenueOrder(p.id, `ord_${tag}`, approveAt);
    await plans.setChosenBundle(p.id, "bnd_x");
    expect(await plans.getPlan(p.id)).toMatchObject({
      venue_order_id: `ord_${tag}`, chosen_bundle_id: "bnd_x",
      deadlines: { vote_at: "2026-10-17T21:40:00.000Z", approve_at: approveAt.toISOString() },
    });
    expect((await plans.latestPlanWithOrder())?.id).toBe(p.id);
    expect((await plans.listActivePlans()).some((x) => x.id === p.id)).toBe(true);

    const show = await newPlan("SHOWCASE");
    expect((await plans.listActivePlans()).some((x) => x.id === show.id)).toBe(false);
    expect((await plans.findShowcasePlan())?.state).toBe("SHOWCASE");

    let to = code();
    while (to === p.code || (await plans.getPlanByCode(to))) to = code();
    expect(await plans.renameCode(p.code, to)).toBe(true);
    expect(await plans.renameCode(p.code, to)).toBe(false);
  });

  it("participants: concurrent joins get distinct lanes; member filters; current plan", async () => {
    const p = await newPlan();
    const us = await Promise.all([3, 4, 5, 6].map((n) => newUser(n, `U${n}`)));
    const res = await Promise.all(us.map((u) => participants.upsertParticipant(p.id, u.id)));
    expect(res.every((r) => r.created)).toBe(true);
    expect(res.map((r) => r.row.lane).sort()).toEqual([1, 2, 3, 4]);
    const again = await participants.upsertParticipant(p.id, us[0]!.id);
    expect(again.created).toBe(false);
    expect(again.row.lane).toBe(res[0]!.row.lane);

    await participants.updateStage(p.id, us[0]!.id, "PREFS_DONE");
    await participants.updateStage(p.id, us[1]!.id, "CAPTURED");
    await participants.updateStage(p.id, us[2]!.id, "DECLINED");
    expect(await participants.updateStage(p.id, randomUUID(), "JOINED")).toBeNull();

    const active = await participants.listMembers(p.id);
    expect(active.map((m) => m.user_id).sort()).toEqual([us[0]!.id, us[1]!.id].sort());
    expect(active[0]).toHaveProperty("payer_ref");
    expect((await participants.listMembers(p.id, { active: false })).map((m) => m.lane)).toEqual([1, 2, 3, 4]);
    expect((await participants.listRecipients(p.id)).map((m) => m.user_id).sort()).toEqual([us[0]!.id, us[1]!.id].sort());
    expect(await participants.countByStage(p.id)).toEqual({ PREFS_DONE: 1, CAPTURED: 1, DECLINED: 1, INVITED: 1 });
    expect((await participants.memberByPayerRef(p.id, us[1]!.payer_ref))?.user_id).toBe(us[1]!.id);
    expect(await participants.capturedPlanIdsForUser(us[1]!.id)).toEqual([p.id]);
    expect((await plans.currentPlanForUser(us[0]!.id))?.id).toBe(p.id);
    // INVITED (a /join nobody confirmed by text) never becomes the current plan, even when it is the newest one.
    expect(await plans.currentPlanForUser(us[3]!.id)).toBeNull();
    const newer = await newPlan();
    await participants.upsertParticipant(newer.id, us[0]!.id);
    expect((await plans.currentPlanForUser(us[0]!.id))?.id).toBe(p.id);
    await participants.updateStage(newer.id, us[0]!.id, "JOINED");
    expect((await plans.currentPlanForUser(us[0]!.id))?.id).toBe(newer.id);
  });

  it("recentConfirmedPlan: HELD or CAPTURED lane in a CONFIRMED plan dated today or yesterday (LA)", async () => {
    const [held, captured, released] = await Promise.all([newUser(40), newUser(41), newUser(42)]);
    const laDay = async (days: number) =>
      (await sql<{ d: string }[]>`select to_char((now() at time zone 'America/Los_Angeles')::date + ${days}::int, 'YYYY-MM-DD') as d`)[0]!.d;
    // Test-only state writes (production state changes go through plan/machine.ts transition()).
    const setPlan = (id: string, state: string, date: string) => sql`update app.plans set state = ${state}, event_date = ${date}::date where id = ${id}`;
    const p = await newPlan();
    for (const u of [held, captured, released]) await participants.upsertParticipant(p.id, u.id);
    await participants.updateStage(p.id, held.id, "HELD"); // share.captured hook lost
    await participants.updateStage(p.id, captured.id, "CAPTURED");
    await participants.updateStage(p.id, released.id, "RELEASED");

    await setPlan(p.id, "COMMITTING", await laDay(0));
    expect(await plans.recentConfirmedPlan(held.id)).toBeNull(); // not CONFIRMED yet

    await setPlan(p.id, "CONFIRMED", await laDay(0));
    expect((await plans.recentConfirmedPlan(held.id))?.id).toBe(p.id);
    expect((await plans.recentConfirmedPlan(captured.id))?.id).toBe(p.id);
    expect(await plans.recentConfirmedPlan(released.id)).toBeNull();

    await setPlan(p.id, "CONFIRMED", await laDay(-1));
    expect((await plans.recentConfirmedPlan(held.id))?.id).toBe(p.id); // yesterday still counts
    await setPlan(p.id, "CONFIRMED", await laDay(-2));
    expect(await plans.recentConfirmedPlan(held.id)).toBeNull(); // outside the window
    expect(await plans.recentConfirmedPlan(captured.id)).toBeNull();

    // The newest qualifying plan wins; an older confirmed one is the fallback when the newer is not CONFIRMED.
    await setPlan(p.id, "CONFIRMED", await laDay(0));
    const newer = await newPlan();
    await participants.upsertParticipant(newer.id, captured.id);
    await participants.updateStage(newer.id, captured.id, "CAPTURED");
    await setPlan(newer.id, "CONFIRMED", await laDay(1));
    expect((await plans.recentConfirmedPlan(captured.id))?.id).toBe(newer.id);
    await setPlan(newer.id, "CANCELLED", await laDay(1));
    expect((await plans.recentConfirmedPlan(captured.id))?.id).toBe(p.id);
  });

  it("private constraints: validated upsert, ISO confirmed_at, filters", async () => {
    const p = await newPlan();
    const [a, b] = await Promise.all([newUser(7), newUser(8)]);
    await privateConstraints.upsert({ plan_id: p.id, user_id: a!.id, target_pp_cents: 6000, hard_max_pp_cents: null, source: "dm", confidence: "high" });
    const at = "2026-10-17T20:00:00.000Z";
    await privateConstraints.upsert({ plan_id: p.id, user_id: a!.id, target_pp_cents: 5000, hard_max_pp_cents: 7000, source: "tier", confidence: "high", confirmed_at: at });
    await privateConstraints.upsert({ plan_id: p.id, user_id: b!.id, target_pp_cents: 4000, hard_max_pp_cents: null, source: "form", confidence: "low" });
    expect(await privateConstraints.get(p.id, a!.id)).toEqual({
      plan_id: p.id, user_id: a!.id, target_pp_cents: 5000, hard_max_pp_cents: 7000, source: "tier", confidence: "high", confirmed_at: at,
    });
    expect(await privateConstraints.listForPlan(p.id)).toHaveLength(2);
    expect((await privateConstraints.listForPlan(p.id, [b!.id])).map((c) => c.user_id)).toEqual([b!.id]);
    await expect(privateConstraints.upsert({ plan_id: p.id, user_id: b!.id, target_pp_cents: 100, hard_max_pp_cents: null, source: "dm", confidence: "high" })).rejects.toThrow();
    await expect(privateConstraints.upsert({ plan_id: p.id, user_id: b!.id, target_pp_cents: 5000, hard_max_pp_cents: 4000, source: "dm", confidence: "high" })).rejects.toThrow();
    await privateConstraints.deleteForUser(b!.id);
    expect(await privateConstraints.get(p.id, b!.id)).toBeNull();
  });

  it("preferences round-trip and validate", async () => {
    const p = await newPlan();
    const u = await newUser(9);
    await preferences.upsertPreferences(p.id, u.id, preferences.EMPTY_PREFERENCES);
    const prefs = { ...preferences.EMPTY_PREFERENCES, cuisines_like: ["thai"], vibe: ["lively" as const], earliest_start: "18:00" };
    await preferences.upsertPreferences(p.id, u.id, prefs);
    expect(await preferences.getPreferences(p.id, u.id)).toEqual(prefs);
    expect(await preferences.listPreferences(p.id, [u.id])).toEqual([{ user_id: u.id, prefs }]);
    expect(await preferences.listPreferences(p.id, [])).toEqual([]);
    await expect(preferences.upsertPreferences(p.id, u.id, { ...prefs, vibe: ["x"] } as never)).rejects.toThrow();
  });

  it("research runs: insert-or-return, exactly-once finish, merge, active-run lookup", async () => {
    const p = await newPlan();
    const key = `scout-${p.ref}-dinner-a1`;
    const r1 = await runs.insertResearchRun({ plan_id: p.id, kind: "scout", category: "dinner", idempotency_key: key });
    const r2 = await runs.insertResearchRun({ plan_id: p.id, kind: "scout", category: "dinner", idempotency_key: key });
    expect(r2.id).toBe(r1.id);
    expect(r1).toMatchObject({ status: "pending", source: "live", attempt: 1, result: null, finished_at: null });

    expect((await runs.findActiveRun(p.ref, ["scout", "scout_live_demo"], "dinner"))?.run.id).toBe(r1.id);
    expect((await runs.findActiveRun(p.ref, ["scout"], null))?.plan.id).toBe(p.id);
    expect(await runs.findActiveRun(p.ref, ["scout"], "show")).toBeNull();
    expect(await runs.findActiveRun(p.ref, ["concierge"], null)).toBeNull();
    expect(await runs.findActiveRun("bad-ref", ["scout"], null)).toBeNull();
    expect(await runs.findActiveRun(p.ref, ["scout"], null, 0)).toBeNull();

    await runs.setCreaoRunId(r1.id, `cr_${tag}`, "th1");
    expect((await runs.findRunByCreaoRunId(`cr_${tag}`))?.thread_id).toBe("th1");
    await runs.markRunRunning(r1.id);
    await runs.mergeRunResult(r1.id, { creao: { a: 1 } });
    await runs.mergeRunResult(r1.id, { share_url: null });
    expect((await runs.listRunsForPlan(p.id, { nonTerminal: true })).map((r) => r.id)).toEqual([r1.id]);

    const wins = await Promise.all([runs.finishRun(r1.id, "completed"), runs.finishRun(r1.id, "timed_out", { source: "cached" })]);
    expect(wins.filter(Boolean)).toHaveLength(1);
    await runs.markRunRunning(r1.id); // terminal: untouched
    const done = (await runs.getResearchRun(r1.id))!;
    expect(["completed", "timed_out"]).toContain(done.status);
    expect(done.finished_at).toBeInstanceOf(Date);
    expect(done.result).toEqual({ creao: { a: 1 }, share_url: null });
    expect(await runs.listRunsForPlan(p.id, { nonTerminal: true })).toEqual([]);
    await runs.markRunCached(r1.id);
    expect((await runs.getResearchRun(r1.id))?.source).toBe("cached");

    const demo = await newPlan("SHOWCASE");
    await runs.insertResearchRun({ plan_id: demo.id, kind: "scout_live_demo", category: "dinner", idempotency_key: `demo-${tag}-a1` });
    expect((await runs.latestLiveDemoStartedAt())).toBeInstanceOf(Date);
  });

  it("options: dedupe, source from run, categories", async () => {
    const p = await newPlan();
    const run = await runs.insertResearchRun({ plan_id: p.id, kind: "scout", category: "dinner", idempotency_key: `opt-${tag}-a1`, source: "cached" });
    expect(await options.hasOptionsForRun(run.id)).toBe(false);
    const d = scout("dinner", "Sushi", 40);
    const n = await options.upsertOptions(p.id, run.id, [d, scout("dinner", "Tacos", 20), { ...d, pitch: "Newer." }]);
    expect(n).toBe(2);
    expect(await options.upsertOptions(p.id, run.id, [])).toBe(0);
    const list = await options.listOptions(p.id);
    expect(list.map((o) => o.id)).toEqual([...list.map((o) => o.id)].sort());
    const sushi = list.find((o) => o.id === options.optionId(d))!;
    expect(sushi).toMatchObject({ run_id: run.id, source: "cached", est_high_pp_cents: 4000 });
    expect(sushi.data.pitch).toBe("Newer.");
    expect(await options.hasOptionsForRun(run.id)).toBe(true);
    await options.upsertOptions(p.id, run.id, [scout("show", "Comedy", 30)]);
    expect(await options.categoriesWithOptions(p.id)).toEqual(["dinner", "show"]);
    await expect(options.upsertOptions(p.id, run.id, [{ ...d, url: "nope" }])).rejects.toThrow();
  });

  it("bundles: shortlist order, rewrite replaces the set; ratings; ballots", async () => {
    const p = await newPlan();
    const u = await newUser(10);
    const opt = (o: ScoutOption) => ({ id: options.optionId(o), run_id: randomUUID(), source: "live" as const, data: o, est_high_pp_cents: o.est_high_pp_usd * 100 });
    const mk = (id: string, cents: number): Bundle => ({
      id, dinner: opt(scout("dinner", `D${id}`, 30)), show: opt(scout("show", `S${id}`, 30)),
      dinner_time: "18:30", show_start: "20:00", show_end_est: "21:30", all_in_pp_cents: cents,
    });
    const bs = ["bnd_a", "bnd_b", "bnd_c", "bnd_d"].map((id, i) => mk(id, 5000 + i));
    await bundles.writeBundles(p.id, 1, bs, ["bnd_c", "bnd_a", "bnd_b"]);
    expect((await bundles.getShortlist(p.id, 1)).map((b) => b.id)).toEqual(["bnd_c", "bnd_a", "bnd_b"]);
    expect(await bundles.getBundle(p.id, 1, "bnd_d")).toEqual(bs[3]);
    await bundles.writeBundles(p.id, 1, bs.slice(0, 2), ["bnd_b"]);
    expect((await bundles.getShortlist(p.id, 1)).map((b) => b.id)).toEqual(["bnd_b"]);
    expect(await bundles.getBundle(p.id, 1, "bnd_d")).toBeNull();
    expect(await bundles.getShortlist(p.id, 2)).toEqual([]);
    await expect(bundles.writeBundles(p.id, 1, bs.slice(0, 1), ["bnd_z"])).rejects.toThrow();

    await ratings.upsertRatings(p.id, u.id, [{ bundle_id: "bnd_a", score: 0.25 }, { bundle_id: "bnd_b", score: 0.5 }, { bundle_id: "bnd_a", score: 0.75 }]);
    expect(await ratings.listRatings(p.id)).toEqual([{ user_id: u.id, bundle_id: "bnd_a", score: 0.75 }, { user_id: u.id, bundle_id: "bnd_b", score: 0.5 }]);
    expect(await ratings.listRatings(p.id, ["bnd_b"])).toHaveLength(1);

    const at = "2026-10-17T21:00:00.000Z";
    await ballots.upsertBallot({ plan_id: p.id, user_id: u.id, plan_version: 1, approvals: [], constraints: [], source: "digits", at });
    const at2 = "2026-10-17T21:05:00.000Z";
    const b2 = { plan_id: p.id, user_id: u.id, plan_version: 1, approvals: ["bnd_a", "bnd_b"], constraints: [{ kind: "end_before" as const, time: "23:00" }], source: "delegate" as const, at: at2 };
    await ballots.upsertBallot(b2);
    expect(await ballots.listBallots(p.id, 1)).toEqual([b2]);
    expect(await ballots.listBallots(p.id, 2)).toEqual([]);
  });

  it("hold gates answer exactly once; pay links", async () => {
    const p = await newPlan();
    const u = await newUser(11);
    expect(await holdGates.insertPendingHoldGate(p.id, u.id, 1, 6500)).toBe(true);
    expect(await holdGates.insertPendingHoldGate(p.id, u.id, 1, 9999)).toBe(false);
    expect((await holdGates.findPendingHoldGate(u.id))?.share_amount_cents).toBe(6500);
    const answers = await Promise.all([holdGates.answerHoldGate(p.id, u.id, 1, "approved"), holdGates.answerHoldGate(p.id, u.id, 1, "declined")]);
    expect(answers.filter(Boolean)).toHaveLength(1);
    expect((await holdGates.getHoldGate(p.id, u.id, 1))?.answered_at).toBeInstanceOf(Date);
    expect(await holdGates.findPendingHoldGate(u.id)).toBeNull();

    if (!hasPayLinks) return;
    const expires = new Date("2026-10-17T23:00:00.000Z");
    const link = { plan_id: p.id, user_id: u.id, plan_version: 1, share_id: "sh1", amount_cents: 6500, pay_url: "https://venue.test/pay/1", expires_at: expires };
    await payLinks.upsertPayLink(link);
    await payLinks.upsertPayLink({ ...link, share_id: "sh2", pay_url: "https://venue.test/pay/2" });
    expect(await payLinks.getPayLink(p.id, u.id, 1)).toMatchObject({ share_id: "sh2", pay_url: "https://venue.test/pay/2", expires_at: expires });
    await payLinks.deletePayLinksForUser(u.id);
    expect(await payLinks.getPayLink(p.id, u.id, 1)).toBeNull();
  });

  it("outbound claim ledger, inbound dedupe, photon cursor", async () => {
    const c = { idempotency_key: `t:${tag}:1`, user_id: null, plan_id: null, template_id: "T_HELP" as const };
    expect(await outbound.claimOutbound(c)).toBe(true);
    await outbound.markOutboundFailed(c.idempotency_key, "TRANSIENT");
    expect(await outbound.claimOutbound(c)).toBe(true); // retry after failure
    await outbound.markOutboundAccepted(c.idempotency_key, `pm_${tag}`);
    expect(await outbound.claimOutbound(c)).toBe(false);
    await outbound.markOutboundBlocked(c); // never downgrades accepted
    await outbound.markOutboundFailed(c.idempotency_key, "X");
    expect(await outbound.findOutboundByPhotonMessageId(`pm_${tag}`)).toEqual({ user_id: null, plan_id: null });
    expect(await outbound.findOutboundByPhotonMessageId("missing")).toBeNull();
    const blocked = { ...c, idempotency_key: `t:${tag}:2` };
    await outbound.markOutboundBlocked(blocked);
    expect(await outbound.claimOutbound(blocked)).toBe(false);

    expect(await inbound.seenInbound("photon", `${tag}e1`)).toBe(false);
    expect(await inbound.insertInboundEvent("creao", `${tag}e1`)).toBe(true);
    expect(await inbound.insertInboundEvent("creao", `${tag}e1`)).toBe(false);
    await inbound.markInboundSeen("photon", `${tag}e1`);
    await inbound.markInboundSeen("photon", `${tag}e1`);
    expect(await inbound.seenInbound("photon", `${tag}e1`)).toBe(true);

    const start = await cursor.loadCursor();
    await cursor.saveCursor(start + 10);
    await cursor.saveCursor(start + 5); // never backwards
    expect(await cursor.loadCursor()).toBe(start + 10);
    await expect(cursor.saveCursor(-1)).rejects.toThrow();
  });

  it("inTx joins the caller's transaction and rolls back together", async () => {
    const p = await newPlan();
    await sql
      .begin(async (tx) => {
        await inTx(tx, (t) => plans.mergeDeadlines(p.id, { vote_at: "2026-10-17T00:00:00.000Z" }, t));
        throw new Error("rollback");
      })
      .catch(() => {});
    expect((await plans.getPlan(p.id))?.deadlines).toEqual({});
  });
});
