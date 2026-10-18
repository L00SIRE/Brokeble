import type { BallotParse, PublicBundle } from "@tab/shared";
import { describe, expect, it } from "vitest";
import { resolveApprovals } from "./ballot";

const pb = (index: number, show_end_est: string, dinner_time = "18:30"): PublicBundle => ({
  id: `bnd_${index}`,
  index,
  title: `Plan ${index}`,
  dinner_name: "D",
  show_name: "S",
  dinner_time,
  show_start: "20:30",
  show_end_est,
  all_in_pp_cents: 3000,
  dietary_fit: [],
  pitch: "",
});
const parse = (p: Partial<BallotParse>): BallotParse => ({ approvals: [], constraints: [], none_of_these: false, intent: "ballot", confidence: "high", ...p });

describe("resolveApprovals", () => {
  const list = [pb(3, "22:30"), pb(1, "21:45"), pb(2, "22:00")];

  it("digit-only replies keep approvals in index order and ignore unknown indices", () => {
    expect(resolveApprovals(parse({ approvals: [3, 1, 1] }), list, "18:30")).toEqual(["bnd_1", "bnd_3"]);
    expect(resolveApprovals(parse({ approvals: [3] }), list.slice(1), "18:30")).toEqual([]);
  });

  it('"2, but not if it ends after 10" keeps 2 only when it ends ≤ 22:00', () => {
    const p = parse({ approvals: [2], constraints: [{ kind: "end_before", time: "22:00" }] });
    expect(resolveApprovals(p, list, "18:30")).toEqual(["bnd_2"]);
    expect(resolveApprovals(p, [pb(2, "22:01")], "18:30")).toEqual([]);
  });

  it("a 00:30 show end counts as after 22:00", () => {
    const p = parse({ approvals: [1], constraints: [{ kind: "end_before", time: "22:00" }] });
    expect(resolveApprovals(p, [pb(1, "00:30")], "18:30")).toEqual([]);
    const late = parse({ approvals: [1], constraints: [{ kind: "end_before", time: "01:00" }] });
    expect(resolveApprovals(late, [pb(1, "00:30")], "18:30")).toEqual(["bnd_1"]);
  });

  it("exclude drops that index", () => {
    const p = parse({ approvals: [1, 2, 3], constraints: [{ kind: "exclude", index: 2 }] });
    expect(resolveApprovals(p, list, "18:30")).toEqual(["bnd_1", "bnd_3"]);
  });

  it("start_after drops dinners starting earlier", () => {
    const l = [pb(1, "22:00", "18:30"), pb(2, "22:00", "19:30")];
    const p = parse({ approvals: [1, 2], constraints: [{ kind: "start_after", time: "19:00" }] });
    expect(resolveApprovals(p, l, "18:30")).toEqual(["bnd_2"]);
  });

  it("none_of_these → []", () => {
    expect(resolveApprovals(parse({ approvals: [1], none_of_these: true }), list, "18:30")).toEqual([]);
  });
});
