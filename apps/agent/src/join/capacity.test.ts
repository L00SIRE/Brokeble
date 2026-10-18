// Party-size cap: only phone-confirmed lanes count, and the JOIN text is where a 9th lane is refused.
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ countByStage: vi.fn(), getParticipant: vi.fn(), getPlanByCode: vi.fn() }));
vi.mock("../repo/participants", () => ({ countByStage: m.countByStage, getParticipant: m.getParticipant }));
vi.mock("../repo/plans", () => ({ getPlanByCode: m.getPlanByCode }));

const { confirmedMembers, joinWouldOverfill, MAX_PARTY } = await import("./capacity");
const user = { id: "u9" } as never;

beforeEach(() => {
  for (const f of Object.values(m)) f.mockReset();
  m.getPlanByCode.mockResolvedValue({ id: "p1", state: "COLLECTING" });
  m.getParticipant.mockResolvedValue({ stage: "INVITED" });
});

describe("confirmedMembers", () => {
  it("skips INVITED, DECLINED and RELEASED", async () => {
    m.countByStage.mockResolvedValue({ INVITED: 20, DECLINED: 2, RELEASED: 1, JOINED: 1, BUDGET_LOCKED: 1, PREFS_DONE: 2, VOTED: 1, GATED: 1, LINK_SENT: 1, HELD: 1 });
    expect(await confirmedMembers("p1")).toBe(8);
  });
});

describe("joinWouldOverfill", () => {
  it("refuses an INVITED lane once MAX_PARTY lanes are confirmed", async () => {
    m.countByStage.mockResolvedValue({ PREFS_DONE: MAX_PARTY, INVITED: 3 });
    expect(await joinWouldOverfill(user, "4821")).toBe(true);
  });

  it("allows it below the cap, however many form-only rows exist", async () => {
    m.countByStage.mockResolvedValue({ PREFS_DONE: MAX_PARTY - 1, INVITED: 30 });
    expect(await joinWouldOverfill(user, "4821")).toBe(false);
  });

  it.each([
    ["unknown code", () => m.getPlanByCode.mockResolvedValue(null)],
    ["plan past VOTING", () => m.getPlanByCode.mockResolvedValue({ id: "p1", state: "ORDERING" })],
    ["no lane", () => m.getParticipant.mockResolvedValue(null)],
    ["already joined (a repeat JOIN)", () => m.getParticipant.mockResolvedValue({ stage: "JOINED" })],
  ])("leaves %s to membership.onJoinText", async (_label, setup) => {
    setup();
    m.countByStage.mockResolvedValue({ PREFS_DONE: MAX_PARTY });
    expect(await joinWouldOverfill(user, "4821")).toBe(false);
  });
});
