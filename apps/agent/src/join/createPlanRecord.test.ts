import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UserRow } from "../repo/types";

const TX = { tx: true };
const m = vi.hoisted(() => ({
  begin: vi.fn(),
  insertPlan: vi.fn(),
  upsertParticipant: vi.fn(),
  updateStage: vi.fn(),
  emit: vi.fn(),
  enqueue: vi.fn(),
}));
vi.mock("../db", () => ({ sql: { begin: m.begin } }));
vi.mock("../repo/plans", () => ({ insertPlan: m.insertPlan }));
vi.mock("../repo/participants", () => ({ upsertParticipant: m.upsertParticipant, updateStage: m.updateStage }));
vi.mock("../events", () => ({ emit: m.emit }));
vi.mock("../dueJobs", () => ({ jobs: { enqueue: m.enqueue } }));
// The real module drags in every job handler; the key shapes are pinned by test/skeleton.keys.test.ts.
vi.mock("../jobs/kinds", () => ({ A_JOB_KINDS: { orgJoinStatus: "org_join_status" }, aJobKeys: { orgJoinStatus: (id: string) => `orgjoin:${id}` } }));

const { createPlanRecord } = await import("./createPlanRecord");
const { env } = await import("../env");

const organizer = { id: "org-1", first_name: "", phone_e164: "+14155550100" } as UserRow;
const fields = { title: "Dinner + show", area: "Santa Monica", date: "2026-10-24", time_start: "19:00", time_end: "23:00", party_target: 4 };
const echoPlan = async (p: Record<string, unknown>) => ({ id: "plan-9", state: "COLLECTING", version: 0, ...p });
const created = { type: "plan.state", plan_id: "plan-9", from: "NEW", to: "COLLECTING", version: 0 };

beforeEach(() => {
  vi.resetAllMocks();
  m.begin.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(TX));
  m.insertPlan.mockImplementation(echoPlan);
  m.upsertParticipant.mockResolvedValue({ row: { lane: 1, stage: "INVITED" }, created: true });
  m.updateStage.mockResolvedValue({ lane: 1, stage: "JOINED" });
  m.enqueue.mockResolvedValue(true);
});

describe("createPlanRecord", () => {
  it("INVITED: inserts the plan, emits NEW→COLLECTING, seats the organizer and emits one INVITED lane, all in one transaction; schedules org_join_status", async () => {
    const { plan, join_url } = await createPlanRecord(organizer, fields, { organizerStage: "INVITED" });
    expect(plan.code).toMatch(/^\d{4}$/);
    expect(plan.code).not.toBe(env.DEMO_CODE);
    expect(join_url).toBe(`${new URL(env.WEB_ORIGIN).origin}/j/${plan.code}`);
    expect(m.insertPlan).toHaveBeenCalledWith(
      { code: plan.code, title: "Dinner + show", area: "Santa Monica", event_date: "2026-10-24", time_start: "19:00", time_end: "23:00", party_target: 4, organizer_id: "org-1" },
      TX,
    );
    expect(m.upsertParticipant).toHaveBeenCalledWith("plan-9", "org-1", TX);
    expect(m.updateStage).not.toHaveBeenCalled();
    // plan.state first: the console resets its plan-scoped panels on a new plan_id, so it must precede the lane.
    expect(m.emit.mock.calls).toEqual([
      [created, TX],
      [{ type: "lane", plan_id: "plan-9", lane: 1, first_name: "", stage: "INVITED", amount_cents: null, cybs_id_short: null }, TX],
    ]);
    expect(m.enqueue).toHaveBeenCalledWith("org_join_status", "orgjoin:plan-9", expect.any(Date), {}, { planId: "plan-9" });
  });

  it("JOINED: moves the organizer to JOINED in the same transaction and emits the JOINED lane only", async () => {
    await createPlanRecord(organizer, fields, { organizerStage: "JOINED" });
    expect(m.updateStage).toHaveBeenCalledWith("plan-9", "org-1", "JOINED", TX);
    expect(m.emit.mock.calls).toEqual([[created, TX], [expect.objectContaining({ type: "lane", stage: "JOINED", lane: 1 }), TX]]);
  });

  it("JOINED never demotes an organizer already past JOINED", async () => {
    m.upsertParticipant.mockResolvedValue({ row: { lane: 1, stage: "PREFS_DONE" }, created: false });
    await createPlanRecord(organizer, fields, { organizerStage: "JOINED" });
    expect(m.updateStage).not.toHaveBeenCalled();
    expect(m.emit).toHaveBeenCalledWith(expect.objectContaining({ stage: "PREFS_DONE" }), TX);
  });

  it("retries code collisions (23505) in a fresh transaction, then gives up after 10", async () => {
    const dup = Object.assign(new Error("dup"), { code: "23505" });
    m.insertPlan.mockRejectedValueOnce(dup).mockRejectedValueOnce(dup).mockImplementation(echoPlan);
    await createPlanRecord(organizer, fields, { organizerStage: "INVITED" });
    expect(m.begin).toHaveBeenCalledTimes(3);

    m.insertPlan.mockReset().mockRejectedValue(dup);
    await expect(createPlanRecord(organizer, fields, { organizerStage: "INVITED" })).rejects.toThrow("plan code allocation exhausted");
    expect(m.enqueue).toHaveBeenCalledTimes(1); // only the first, successful call
  });

  it("rethrows other errors without scheduling anything", async () => {
    m.upsertParticipant.mockRejectedValue(new Error("db down"));
    await expect(createPlanRecord(organizer, fields, { organizerStage: "INVITED" })).rejects.toThrow("db down");
    expect(m.enqueue).not.toHaveBeenCalled();
  });

  it("still returns the plan when the org_join_status enqueue fails", async () => {
    m.enqueue.mockRejectedValue(new Error("db down"));
    await expect(createPlanRecord(organizer, fields, { organizerStage: "INVITED" })).resolves.toMatchObject({ plan: { id: "plan-9" } });
  });
});
