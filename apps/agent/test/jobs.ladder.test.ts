import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DueJob } from "../src/dueJobs";
import type { MemberRow, PlanRow } from "../src/repo/types";

const m = vi.hoisted(() => ({
  env: { VENUE_MODE: "live" as "live" | "mock", LOG_LEVEL: "silent" },
  getPlan: vi.fn(),
  countByStage: vi.fn(),
  listMembers: vi.fn(),
  getPayLink: vi.fn(),
  getBundle: vi.fn(),
  fanout: vi.fn(async () => 1),
  notify: vi.fn(async () => "sent"),
  cancel: vi.fn(async () => {}),
  enqueue: vi.fn(async () => true),
  callVenueSweep: vi.fn(async () => ({})),
  getOrder: vi.fn(),
  commitJob: vi.fn(async () => {}),
  researchReady: vi.fn(async () => false),
  startResearch: vi.fn(async () => {}),
  listRunsForPlan: vi.fn(async () => [] as unknown[]),
  listStaleCollectingPlanIds: vi.fn(async () => [] as string[]),
  transition: vi.fn(async () => null as unknown),
}));
vi.mock("../src/env", () => ({ env: m.env }));
vi.mock("../src/repo/plans", () => ({ getPlan: m.getPlan, listStaleCollectingPlanIds: m.listStaleCollectingPlanIds }));
vi.mock("../src/plan/machine", () => ({ transition: m.transition }));
vi.mock("../src/repo/participants", () => ({ countByStage: m.countByStage, listMembers: m.listMembers }));
vi.mock("../src/repo/payLinks", () => ({ getPayLink: m.getPayLink }));
vi.mock("../src/repo/bundles", () => ({ getBundle: m.getBundle }));
vi.mock("../src/notify/fanout", () => ({ fanout: m.fanout }));
vi.mock("../src/notify/notify", () => ({ notify: m.notify, tplKey: (...a: unknown[]) => `tpl:${a.join(":")}` }));
vi.mock("../src/notify/render", () => ({ fmtDeadline: (d: Date | string) => `DL(${String(d)})` }));
vi.mock("../src/plan/decision", () => ({ bundleTitle: () => "Dinner at A → Show at B" }));
vi.mock("../src/plan/cancel", () => ({ cancel: m.cancel }));
vi.mock("../src/dueJobs", async (orig) => ({ ...(await orig<typeof import("../src/dueJobs")>()), enqueue: m.enqueue }));
vi.mock("../src/ports", () => ({ ports: { venue: { getOrder: m.getOrder } } }));
vi.mock("../src/plan/commit", () => ({ commitJob: m.commitJob }));
vi.mock("../src/creao/research", () => ({ researchReady: m.researchReady, startResearch: m.startResearch }));
vi.mock("../src/repo/researchRuns", () => ({ listRunsForPlan: m.listRunsForPlan }));

import {
  approveDeadlineJob, approveRepingJob, bootstrapStaleSweep, bootstrapVenueSweep, orgJoinStatusJob, STALE_COLLECTING_MS, staleSweepJob, stillLookingJob, venueSweepJob,
} from "../src/jobs/ladder";

const plan = (o: Partial<PlanRow> = {}): PlanRow =>
  ({ id: "p1", state: "APPROVING", version: 2, title: "Sat", organizer_id: "org", party_target: 4, chosen_bundle_id: "bnd_1",
    deadlines: { approve_at: "2026-10-17T05:40:00.000Z" }, ...o }) as PlanRow;
const job = (o: Partial<DueJob> = {}): DueJob =>
  ({ id: 1, plan_id: "p1", kind: "k", dedupe_key: "d", due_at: new Date(), payload: { version: 2 }, attempts: 1, ...o });
const member = (user_id: string, stage: MemberRow["stage"]) => ({ user_id, stage }) as MemberRow;

beforeEach(() => {
  vi.clearAllMocks();
  m.env.VENUE_MODE = "live";
  m.getPlan.mockResolvedValue(plan());
});

describe("stillLookingJob", () => {
  it("fans out only while RESEARCHING", async () => {
    m.getPlan.mockResolvedValue(plan({ state: "RESEARCHING" }));
    await stillLookingJob(job());
    expect(m.fanout).toHaveBeenCalledWith("p1", "T_STILL_LOOKING", expect.any(Function), { version: 2 });
    m.fanout.mockClear();
    m.getPlan.mockResolvedValue(plan({ state: "VOTING" }));
    await stillLookingJob(job());
    expect(m.fanout).not.toHaveBeenCalled();
  });

  const run = (status: string, creao_run_id: string | null) => ({ kind: "scout", status, creao_run_id });

  it("watchdog: healthy research (every Scout run has a CREAO id or finished) is left alone", async () => {
    m.getPlan.mockResolvedValue(plan({ state: "RESEARCHING" }));
    m.listRunsForPlan.mockResolvedValue([run("running", "crun_1"), run("failed", null)]);
    await stillLookingJob(job());
    expect(m.startResearch).not.toHaveBeenCalled();
    expect(m.enqueue).not.toHaveBeenCalled();
  });

  it.each([[[]], [[run("pending", null), run("running", "crun_2")]]])("watchdog: stranded research (%j) is restarted, then the fan-out still goes", async (runs) => {
    m.getPlan.mockResolvedValue(plan({ state: "RESEARCHING" }));
    m.listRunsForPlan.mockResolvedValue(runs);
    await stillLookingJob(job());
    expect(m.listRunsForPlan).toHaveBeenCalledWith("p1", { kind: "scout" });
    expect(m.startResearch).toHaveBeenCalledWith("p1");
    expect(m.fanout).toHaveBeenCalledWith("p1", "T_STILL_LOOKING", expect.any(Function), { version: 2 });
  });

  it("watchdog: options for both categories already stored → a fresh recompute (the options one may have run already)", async () => {
    m.getPlan.mockResolvedValue(plan({ state: "RESEARCHING" }));
    m.researchReady.mockResolvedValueOnce(true);
    await stillLookingJob(job());
    expect(m.enqueue).toHaveBeenCalledWith("recompute", "recompute:p1:still", expect.any(Date), {}, { planId: "p1" });
    expect(m.startResearch).not.toHaveBeenCalled();
  });

  it("watchdog failure never blocks the still-looking message", async () => {
    m.getPlan.mockResolvedValue(plan({ state: "RESEARCHING" }));
    m.listRunsForPlan.mockRejectedValueOnce(new Error("db down"));
    await stillLookingJob(job());
    expect(m.fanout).toHaveBeenCalledOnce();
  });
});

describe("orgJoinStatusJob", () => {
  beforeEach(() => m.getPlan.mockResolvedValue(plan({ state: "COLLECTING" })));

  it("tells the organizer k of n, counting joined lanes only", async () => {
    m.countByStage.mockResolvedValue({ INVITED: 2, JOINED: 1, PREFS_DONE: 1, DECLINED: 1 });
    await orgJoinStatusJob(job());
    expect(m.notify).toHaveBeenCalledWith("org", "T_ORG_JOIN_STATUS", { k: 2, n: 4 }, { key: "tpl:p1:org:T_ORG_JOIN_STATUS:2", planId: "p1" });
  });

  // { JOINED: 1 } = only the organizer (a participant since chat-first start): GO needs 2, so no "Reply GO" offer.
  it.each([[{}], [{ JOINED: 1 }], [{ INVITED: 3, PREFS_DONE: 1 }], [{ PREFS_DONE: 4 }]])("stays quiet when fewer than 2 joined or the plan is full (%j)", async (counts) => {
    m.countByStage.mockResolvedValue(counts);
    await orgJoinStatusJob(job());
    expect(m.notify).not.toHaveBeenCalled();
  });

  it("skips plans that left COLLECTING or have no organizer", async () => {
    m.countByStage.mockResolvedValue({ JOINED: 1 });
    m.getPlan.mockResolvedValue(plan({ state: "RESEARCHING" }));
    await orgJoinStatusJob(job());
    m.getPlan.mockResolvedValue(plan({ state: "COLLECTING", organizer_id: null }));
    await orgJoinStatusJob(job());
    expect(m.notify).not.toHaveBeenCalled();
  });
});

describe("approveRepingJob", () => {
  const future = new Date(Date.now() + 3_600_000);
  beforeEach(() => {
    m.listMembers.mockResolvedValue([member("a", "HELD"), member("b", "LINK_SENT"), member("c", "GATED"), member("d", "LINK_SENT"), member("e", "CAPTURED")]);
    m.getPayLink.mockImplementation(async (_p: string, u: string) =>
      u === "d" ? { pay_url: "https://pay/d", expires_at: new Date(Date.now() - 60_000) } : { pay_url: `https://pay/${u}`, expires_at: future });
    m.getBundle.mockResolvedValue({ id: "bnd_1" });
  });

  it("re-pings only unheld, ungated members with a live link", async () => {
    await approveRepingJob(job());
    expect(m.fanout).toHaveBeenCalledTimes(1);
    const [planId, id, varsFor, opts] = m.fanout.mock.calls[0] as unknown as [
      string, string, (r: MemberRow) => unknown, { only: (r: MemberRow) => boolean; suffix: number; version: number },
    ];
    expect([planId, id, opts.suffix, opts.version]).toEqual(["p1", "T_REPING", 1, 2]);
    expect(["a", "b", "c", "d", "e"].filter((u) => opts.only(member(u, "LINK_SENT")))).toEqual(["b"]);
    expect(varsFor(member("b", "LINK_SENT"))).toEqual({ title: "Dinner at A → Show at B", deadline: "DL(2026-10-17T05:40:00.000Z)", url: "https://pay/b" });
  });

  it("does nothing once the plan left APPROVING, moved to a newer version, or everyone held", async () => {
    m.getPlan.mockResolvedValue(plan({ state: "COMMITTING" }));
    await approveRepingJob(job());
    m.getPlan.mockResolvedValue(plan({ version: 3 }));
    await approveRepingJob(job());
    m.getPlan.mockResolvedValue(plan());
    m.listMembers.mockResolvedValue([member("a", "HELD")]);
    await approveRepingJob(job());
    expect(m.fanout).not.toHaveBeenCalled();
  });
});

describe("approveDeadlineJob", () => {
  it("cancels with reason deadline only while APPROVING at the job's version", async () => {
    await approveDeadlineJob(job());
    expect(m.cancel).toHaveBeenCalledWith("p1", "deadline");
    m.cancel.mockClear();
    for (const p of [plan({ state: "COMMITTING" }), plan({ state: "CONFIRMED" }), plan({ version: 3 }), null]) {
      m.getPlan.mockResolvedValue(p);
      await approveDeadlineJob(job());
    }
    expect(m.cancel).not.toHaveBeenCalled();
  });

  const order = (status: string, shares: string[]) => ({ order_id: "ord_1", status, shares: shares.map((st, i) => ({ share_id: `s${i}`, status: st })) });

  it("every share already AUTHORIZED at the deadline → commit instead of cancelling (late hold or lost hook)", async () => {
    m.getPlan.mockResolvedValue(plan({ venue_order_id: "ord_1" }));
    m.getOrder.mockResolvedValue(order("OPEN", ["AUTHORIZED", "AUTHORIZED"]));
    await approveDeadlineJob(job());
    expect(m.commitJob).toHaveBeenCalledWith(expect.objectContaining({ plan_id: "p1", kind: "commit", payload: { version: 2, share_id: "deadline" } }));
    expect(m.cancel).not.toHaveBeenCalled();
  });

  it.each([
    ["a share still pending", () => m.getOrder.mockResolvedValue(order("OPEN", ["AUTHORIZED", "PENDING"]))],
    ["no shares", () => m.getOrder.mockResolvedValue(order("OPEN", []))],
    ["the venue unreachable", () => m.getOrder.mockRejectedValue(new Error("fetch failed"))],
  ])("cancels when %s", async (_why, arrange) => {
    m.getPlan.mockResolvedValue(plan({ venue_order_id: "ord_1" }));
    arrange();
    await approveDeadlineJob(job());
    expect(m.cancel).toHaveBeenCalledWith("p1", "deadline");
    expect(m.commitJob).not.toHaveBeenCalled();
  });

  it("a retry that finds COMMITTING re-runs the commit (idempotent at the venue); a first attempt does not", async () => {
    m.getPlan.mockResolvedValue(plan({ state: "COMMITTING", venue_order_id: "ord_1" }));
    await approveDeadlineJob(job({ attempts: 1 }));
    expect(m.commitJob).not.toHaveBeenCalled();
    await approveDeadlineJob(job({ attempts: 2 }));
    expect(m.commitJob).toHaveBeenCalledWith(expect.objectContaining({ attempts: 2, kind: "commit" }));
    expect(m.cancel).not.toHaveBeenCalled();
  });
});

describe("venue sweep", () => {
  it("is a no-op in mock mode and does not reschedule", async () => {
    m.env.VENUE_MODE = "mock";
    await venueSweepJob(job(), m.callVenueSweep);
    expect(m.callVenueSweep).not.toHaveBeenCalled();
    expect(m.enqueue).not.toHaveBeenCalled();
  });

  it("sweeps, then enqueues the next 30 s bucket", async () => {
    vi.useFakeTimers({ now: 100_000 });
    try {
      await venueSweepJob(job(), m.callVenueSweep);
      expect(m.callVenueSweep).toHaveBeenCalledOnce();
      expect(m.enqueue).toHaveBeenCalledWith("venue_sweep", "sweep:4", new Date(120_000));
    } finally {
      vi.useRealTimers();
    }
  });

  it("still reschedules when the sweep throws, and does not rethrow", async () => {
    m.callVenueSweep.mockRejectedValueOnce(new Error("venue down"));
    await expect(venueSweepJob(job(), m.callVenueSweep)).resolves.toBeUndefined();
    expect(m.enqueue).toHaveBeenCalledOnce();
  });

  it("gives up on a hung sweep after 10 s and still reschedules", async () => {
    vi.useFakeTimers();
    try {
      m.callVenueSweep.mockReturnValueOnce(new Promise(() => {}));
      const p = venueSweepJob(job(), m.callVenueSweep);
      await vi.advanceTimersByTimeAsync(10_001);
      await p;
      expect(m.enqueue).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("bootstrap inserts the current bucket, due now", async () => {
    const enqueue = vi.fn(async () => true);
    vi.useFakeTimers({ now: 100_000 });
    try {
      await bootstrapVenueSweep({ register: vi.fn(), enqueue });
      expect(enqueue).toHaveBeenCalledWith("venue_sweep", "sweep:3", new Date(100_000));
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("staleSweepJob", () => {
  it("is 3 hours outside demo timers", () => expect(STALE_COLLECTING_MS).toBe(3 * 60 * 60 * 1000));

  it("quietly cancels each stale COLLECTING plan (COLLECTING→CANCELLED guard), no DM, then enqueues the next 5-min bucket", async () => {
    const now = Date.now();
    m.listStaleCollectingPlanIds.mockResolvedValue(["p1", "p2"]);
    m.transition.mockResolvedValueOnce({ id: "p1", version: 3, from_state: "COLLECTING" }).mockResolvedValueOnce(null); // p2 moved on
    await staleSweepJob(job());
    const [cutoff] = m.listStaleCollectingPlanIds.mock.calls[0] as unknown as [Date];
    expect(Math.abs(now - STALE_COLLECTING_MS - cutoff.getTime())).toBeLessThan(5_000);
    expect(m.transition).toHaveBeenCalledWith("p1", "COLLECTING", "CANCELLED");
    expect(m.transition).toHaveBeenCalledWith("p2", "COLLECTING", "CANCELLED");
    expect(m.fanout).not.toHaveBeenCalled();
    expect(m.notify).not.toHaveBeenCalled();
    expect(m.cancel).not.toHaveBeenCalled(); // never the venue/hold path: nothing is held in COLLECTING
    const [kind, key, at] = m.enqueue.mock.calls[0] as unknown as [string, string, Date];
    expect(kind).toBe("stale_sweep");
    expect(at.getTime() % 300_000).toBe(0);
    expect(at.getTime()).toBeGreaterThan(now - 1);
    expect(key).toBe(`stale:${Math.floor(at.getTime() / 300_000)}`);
  });

  it("a failed query is logged, not thrown, and the chain continues", async () => {
    m.listStaleCollectingPlanIds.mockRejectedValue(new Error("db down"));
    await expect(staleSweepJob(job())).resolves.toBeUndefined();
    expect(m.enqueue).toHaveBeenCalledWith("stale_sweep", expect.stringMatching(/^stale:\d+$/), expect.any(Date));
  });

  it("bootstrap enqueues the current bucket", async () => {
    const enqueue = vi.fn(async () => true);
    await bootstrapStaleSweep({ register: vi.fn(), enqueue });
    expect(enqueue).toHaveBeenCalledWith("stale_sweep", expect.stringMatching(/^stale:\d+$/), expect.any(Date));
  });
});
