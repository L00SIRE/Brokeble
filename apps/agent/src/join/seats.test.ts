import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AssignmentRow, UserRow } from "../repo/types";

const m = vi.hoisted(() => ({
  assign: vi.fn(),
  release: vi.fn(),
  getActiveAssignment: vi.fn(),
  countReleasedAssignments: vi.fn(),
  insertAssignment: vi.fn(),
  markAssignmentReleased: vi.fn(),
  listActiveAssignmentsExcept: vi.fn(),
  listUntextedAssignments: vi.fn(),
  findAssignmentByHandle: vi.fn(),
}));

vi.mock("../ports", () => ({ ports: { messaging: { assign: m.assign, release: m.release } } }));
vi.mock("../repo/assignments", () => m);
vi.mock("../photon/messaging", () => ({ findAssignmentByHandle: m.findAssignmentByHandle }));
vi.mock("../photon/errors", () => ({
  problemCode: (e: { code?: string }) => e.code ?? "TRANSPORT",
  problemAction: (c: string) => (c === "SHARED_LINE_CAP_EXCEEDED" ? "capacity" : c === "ASSIGNMENT_EXISTS" ? "assignment_exists" : "transient"),
}));
vi.mock("../env", async (orig) => {
  const actual = await orig<typeof import("../env")>();
  return { ...actual, env: { ...actual.env, DEMO_TEAM: [{ phone_e164: "+14155550100", first_name: "Team" }] } };
});

const { CapacityError, ensureSeat, joinIdempotencyKey, joinSeatScope, releaseAllExceptTeam, releaseSeat, releaseUntexted, seatIdempotencyKey, START_SEAT_SCOPE } = await import("./seats");

const user = { id: "u1", phone_e164: "+14155550111", first_name: "Ana" } as UserRow;
const row = (id: string, number = "+13105550001") => ({ user_id: "u1", photon_assignment_id: id, assigned_number: number }) as AssignmentRow;
const problem = (code: string) => Object.assign(new Error(code), { code });

beforeEach(() => {
  vi.resetAllMocks();
  m.getActiveAssignment.mockResolvedValue(null);
  m.countReleasedAssignments.mockResolvedValue(0);
  m.insertAssignment.mockImplementation(async (a) => row(a.photon_assignment_id, a.assigned_number));
});

describe("seat idempotency keys", () => {
  it("suffixes the released count only when positive", () => {
    expect(joinIdempotencyKey("p", "u", 0)).toBe("join:p:u");
    expect(joinIdempotencyKey("p", "u", 2)).toBe("join:p:u:2");
    expect(seatIdempotencyKey(START_SEAT_SCOPE, "u", 0)).toBe("start:u");
    expect(seatIdempotencyKey(START_SEAT_SCOPE, "u", 3)).toBe("start:u:3");
  });

  it("regression: the /join scope yields byte-identical keys to the pre-scope joinIdempotencyKey format", () => {
    for (const n of [0, 1, 7]) expect(seatIdempotencyKey(joinSeatScope("plan-9"), "user-3", n)).toBe(`join:plan-9:user-3${n ? `:${n}` : ""}`);
  });
});

describe("ensureSeat", () => {
  it("reuses the active seat without calling Photon", async () => {
    m.getActiveAssignment.mockResolvedValue(row("asg_1"));
    expect(await ensureSeat(user, "p")).toEqual({ assignmentId: "asg_1", assignedPhoneNumber: "+13105550001" });
    expect(m.assign).not.toHaveBeenCalled();
  });

  it("ensureSeat(user, join:<planId>) sends exactly the legacy join key", async () => {
    m.assign.mockResolvedValue({ assignmentId: "asg_3", assignedPhoneNumber: "+13105550003" });
    await ensureSeat(user, joinSeatScope("plan-1"));
    expect(m.assign).toHaveBeenCalledWith("+14155550111", "Ana", joinIdempotencyKey("plan-1", "u1", 0));
  });

  it("scope start: key start:<userId>, and a blank first name is passed through (messaging omits it)", async () => {
    m.assign.mockResolvedValue({ assignmentId: "asg_4", assignedPhoneNumber: "+13105550004" });
    await ensureSeat({ ...user, first_name: "" }, START_SEAT_SCOPE);
    expect(m.assign).toHaveBeenCalledWith("+14155550111", "", "start:u1");
  });

  it("assigns with the release-suffixed key and records the seat", async () => {
    m.countReleasedAssignments.mockResolvedValue(1);
    m.assign.mockResolvedValue({ assignmentId: "asg_2", assignedPhoneNumber: "+13105550002" });
    expect(await ensureSeat(user, "p")).toEqual({ assignmentId: "asg_2", assignedPhoneNumber: "+13105550002" });
    expect(m.assign).toHaveBeenCalledWith("+14155550111", "Ana", "p:u1:1");
    expect(m.insertAssignment).toHaveBeenCalledWith({ user_id: "u1", photon_assignment_id: "asg_2", assigned_number: "+13105550002" });
  });

  it("maps cap/pool exhaustion to CapacityError", async () => {
    m.assign.mockRejectedValue(problem("SHARED_LINE_CAP_EXCEEDED"));
    await expect(ensureSeat(user, "p")).rejects.toBeInstanceOf(CapacityError);
    expect(m.insertAssignment).not.toHaveBeenCalled();
  });

  it("adopts the existing Photon seat on ASSIGNMENT_EXISTS", async () => {
    m.assign.mockRejectedValue(problem("ASSIGNMENT_EXISTS"));
    m.findAssignmentByHandle.mockResolvedValue({ assignmentId: "asg_old", assignedPhoneNumber: "+13105550009" });
    expect(await ensureSeat(user, "p")).toEqual({ assignmentId: "asg_old", assignedPhoneNumber: "+13105550009" });
    expect(m.findAssignmentByHandle).toHaveBeenCalledWith("+14155550111");
  });

  it("rethrows ASSIGNMENT_EXISTS when the seat cannot be found, and any other error as-is", async () => {
    m.assign.mockRejectedValue(problem("ASSIGNMENT_EXISTS"));
    m.findAssignmentByHandle.mockResolvedValue(null);
    await expect(ensureSeat(user, "p")).rejects.toThrow("ASSIGNMENT_EXISTS");
    m.assign.mockRejectedValue(problem("BOOM"));
    await expect(ensureSeat(user, "p")).rejects.toThrow("BOOM");
  });
});

describe("releaseSeat", () => {
  it("is a no-op without an active seat", async () => {
    await releaseSeat("u1");
    expect(m.release).not.toHaveBeenCalled();
  });

  it("releases at Photon then marks the row", async () => {
    m.getActiveAssignment.mockResolvedValue(row("asg_1"));
    await releaseSeat("u1");
    expect(m.release).toHaveBeenCalledWith("asg_1");
    expect(m.markAssignmentReleased).toHaveBeenCalledWith("asg_1");
  });
});

describe("releaseAllExceptTeam", () => {
  it("keeps DEMO_TEAM phones and continues past a failed release", async () => {
    m.listActiveAssignmentsExcept.mockResolvedValue([row("a"), row("b"), row("c")]);
    m.release.mockRejectedValueOnce(new Error("down")).mockResolvedValue(undefined);
    expect(await releaseAllExceptTeam()).toBe(2);
    expect(m.listActiveAssignmentsExcept).toHaveBeenCalledWith(["+14155550100"]);
    expect(m.markAssignmentReleased.mock.calls.map((c) => c[0])).toEqual(["b", "c"]);
  });
});

describe("releaseUntexted", () => {
  it("queries untexted seats older than 15 min by default, keeping DEMO_TEAM, and releases each", async () => {
    m.listUntextedAssignments.mockResolvedValue([row("x"), row("y")]);
    expect(await releaseUntexted()).toBe(2);
    expect(m.listUntextedAssignments).toHaveBeenCalledWith(15, ["+14155550100"]);
    expect(m.release.mock.calls.map((c) => c[0])).toEqual(["x", "y"]);
    expect(m.markAssignmentReleased.mock.calls.map((c) => c[0])).toEqual(["x", "y"]);
  });

  it("continues past a failed release and honours a custom age", async () => {
    m.listUntextedAssignments.mockResolvedValue([row("a"), row("b")]);
    m.release.mockRejectedValueOnce(new Error("down")).mockResolvedValue(undefined);
    expect(await releaseUntexted(30)).toBe(1);
    expect(m.listUntextedAssignments).toHaveBeenCalledWith(30, ["+14155550100"]);
    expect(m.markAssignmentReleased.mock.calls.map((c) => c[0])).toEqual(["b"]);
  });

  it("releases nothing when every seat was texted on", async () => {
    m.listUntextedAssignments.mockResolvedValue([]);
    expect(await releaseUntexted()).toBe(0);
    expect(m.release).not.toHaveBeenCalled();
  });
});
