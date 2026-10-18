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

const { CapacityError, ensureSeat, joinIdempotencyKey, releaseAllExceptTeam, releaseSeat } = await import("./seats");

const user = { id: "u1", phone_e164: "+14155550111", first_name: "Ana" } as UserRow;
const row = (id: string, number = "+13105550001") => ({ user_id: "u1", photon_assignment_id: id, assigned_number: number }) as AssignmentRow;
const problem = (code: string) => Object.assign(new Error(code), { code });

beforeEach(() => {
  vi.resetAllMocks();
  m.getActiveAssignment.mockResolvedValue(null);
  m.countReleasedAssignments.mockResolvedValue(0);
  m.insertAssignment.mockImplementation(async (a) => row(a.photon_assignment_id, a.assigned_number));
});

describe("joinIdempotencyKey", () => {
  it("suffixes the released count only when positive", () => {
    expect(joinIdempotencyKey("p", "u", 0)).toBe("join:p:u");
    expect(joinIdempotencyKey("p", "u", 2)).toBe("join:p:u:2");
  });
});

describe("ensureSeat", () => {
  it("reuses the active seat without calling Photon", async () => {
    m.getActiveAssignment.mockResolvedValue(row("asg_1"));
    expect(await ensureSeat(user, "p")).toEqual({ assignmentId: "asg_1", assignedPhoneNumber: "+13105550001" });
    expect(m.assign).not.toHaveBeenCalled();
  });

  it("assigns with the release-suffixed key and records the seat", async () => {
    m.countReleasedAssignments.mockResolvedValue(1);
    m.assign.mockResolvedValue({ assignmentId: "asg_2", assignedPhoneNumber: "+13105550002" });
    expect(await ensureSeat(user, "p")).toEqual({ assignmentId: "asg_2", assignedPhoneNumber: "+13105550002" });
    expect(m.assign).toHaveBeenCalledWith("+14155550111", "Ana", "join:p:u1:1");
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
