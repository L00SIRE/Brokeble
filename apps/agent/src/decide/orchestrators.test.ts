// computeShortlist / computeWinner wiring with the repo and LLM port mocked: they compute and write only app.ratings.
import type { Preferences, RateCandidate } from "@tab/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

const repo = vi.hoisted(() => ({
  getPlan: vi.fn(),
  listMembers: vi.fn(),
  listOptions: vi.fn(),
  listPreferences: vi.fn(),
  listForPlan: vi.fn(),
  upsertRatings: vi.fn(),
  listRatings: vi.fn(),
  getShortlist: vi.fn(),
  listBallots: vi.fn(),
  rateBundles: vi.fn(),
}));
vi.mock("../repo/plans", () => ({ getPlan: repo.getPlan }));
vi.mock("../repo/participants", () => ({ listMembers: repo.listMembers }));
vi.mock("../repo/options", async (orig) => ({ ...(await orig<object>()), listOptions: repo.listOptions }));
vi.mock("../repo/preferences", async (orig) => ({ ...(await orig<object>()), listPreferences: repo.listPreferences }));
vi.mock("../repo/privateConstraints", () => ({ listForPlan: repo.listForPlan }));
vi.mock("../repo/ratings", () => ({ upsertRatings: repo.upsertRatings, listRatings: repo.listRatings }));
vi.mock("../repo/bundles", () => ({ getShortlist: repo.getShortlist }));
vi.mock("../repo/ballots", () => ({ listBallots: repo.listBallots }));
vi.mock("../ports", () => ({ ports: { llm: { rateBundles: repo.rateBundles } } }));

const { computeShortlist, computeWinner } = await import("./score");
const { compose } = await import("./compose");
const { ballot, budget, dinner, PLAN, PLAN_ID, prefs, show } = await import("./testkit");

const U1 = "00000000-0000-4000-8000-0000000000a1";
const U2 = "00000000-0000-4000-8000-0000000000a2";
const options = [
  dinner("Cheap", { usd: 10, dietary: ["vegetarian"] }),
  dinner("Mid", { usd: 15, dietary: ["vegetarian"] }),
  dinner("Steak", { usd: 20 }),
  dinner("Pricey", { usd: 90, dietary: ["vegetarian"] }),
  show("S1", { usd: 0 }),
  show("S2", { usd: 5 }),
  show("S3", { usd: 8 }),
];

beforeEach(() => {
  vi.clearAllMocks();
  repo.getPlan.mockResolvedValue({ id: PLAN_ID, ...PLAN, time_start: "18:30", time_end: "23:00" });
  repo.listMembers.mockResolvedValue([{ user_id: U1 }, { user_id: U2 }]);
  repo.listOptions.mockResolvedValue(options);
  repo.listPreferences.mockResolvedValue([{ user_id: U1, prefs: prefs({ dietary: ["vegetarian"] }) }]); // U2 has none yet
  repo.listForPlan.mockResolvedValue([budget(U1, 4000, 6000), budget(U2, 5000)]);
  repo.rateBundles.mockImplementation(async (p: Preferences, cs: RateCandidate[]) => ({
    ratings: [...cs.map((c) => ({ index: c.index, score: p.dietary.length ? 0.9 : 2 })), { index: 99, score: 1 }, { index: 1, score: 0 }],
  }));
});

describe("computeShortlist", () => {
  it("composes, filters privately, rates once per member with their own prefs, writes ratings, returns 3 diverse", async () => {
    const r = await computeShortlist(PLAN_ID);
    expect(r.from_count).toBe(12); // 4 dinners × 3 shows
    expect(r.survived_count).toBe(6); // vegetarian drops Steak; $90 dinner over U2's $55 cap
    expect(r.survivors.every((b) => b.dinner.data.name !== "Steak" && b.dinner.data.name !== "Pricey")).toBe(true);
    expect(r.top3).toHaveLength(2); // only 2 distinct dinners survive → A sends T_NO_FIT

    expect(repo.rateBundles).toHaveBeenCalledTimes(2);
    const [[p1, c1], [p2]] = repo.rateBundles.mock.calls as [Preferences, RateCandidate[]][];
    expect(p1.dietary).toEqual(["vegetarian"]);
    expect(p2.dietary).toEqual([]); // EMPTY_PREFERENCES for the member without prefs
    expect(c1.map((c) => c.index)).toEqual(c1.map((_, i) => i + 1));

    expect(repo.upsertRatings).toHaveBeenCalledTimes(2);
    const rows = repo.upsertRatings.mock.calls.find((c) => c[1] === U2)![2] as { bundle_id: string; score: number }[];
    expect(rows).toHaveLength(6); // out-of-range index ignored; duplicate index 1 keeps the first answer
    expect(rows.every((x) => x.score === 1)).toBe(true); // clamped to 1
  });

  it("skips the LLM when nothing survives", async () => {
    repo.listForPlan.mockResolvedValue([budget(U1, 500, 500)]);
    const r = await computeShortlist(PLAN_ID);
    expect(r).toMatchObject({ survived_count: 0, survivors: [], top3: [] });
    expect(repo.rateBundles).not.toHaveBeenCalled();
    expect(repo.upsertRatings).not.toHaveBeenCalled();
  });

  it("throws for an unknown plan", async () => {
    repo.getPlan.mockResolvedValue(null);
    await expect(computeShortlist(PLAN_ID)).rejects.toThrow();
  });
});

describe("computeWinner", () => {
  const top = compose(options, PLAN).filter((b) => b.dinner.data.name === "Cheap" || b.dinner.data.name === "Mid").slice(0, 3);

  it("counts only active members' ballots and returns the approved bundle", async () => {
    repo.getShortlist.mockResolvedValue(top);
    repo.listRatings.mockResolvedValue([]);
    repo.listBallots.mockResolvedValue([ballot(U1, [top[2]!.id]), ballot("00000000-0000-4000-8000-0000000000ff", [top[1]!.id, top[0]!.id])]);
    expect(await computeWinner(PLAN_ID, 1)).toBe(top[2]!.id);
    expect(repo.listForPlan).toHaveBeenCalledWith(PLAN_ID, [U1, U2]);
    expect(repo.listRatings).toHaveBeenCalledWith(PLAN_ID, top.map((b) => b.id));
  });

  it("throws when the version has no shortlist", async () => {
    repo.getShortlist.mockResolvedValue([]);
    await expect(computeWinner(PLAN_ID, 2)).rejects.toThrow();
  });
});
