// Photon shared-line seats (A plan T4/T14). Owner A.
import { env } from "../env";
import { errInfo, log } from "../log";
import { findAssignmentByHandle, type Seat } from "../photon/messaging";
import { problemAction, problemCode } from "../photon/errors";
import { ports } from "../ports";
import { getActiveAssignment, countReleasedAssignments, insertAssignment, listActiveAssignmentsExcept, markAssignmentReleased } from "../repo/assignments";
import type { UserRow } from "../repo/types";

export type { Seat };

/** SHARED_LINE_CAP_EXCEEDED / SHARED_LINE_POOL_EXHAUSTED: /join answers 503 {error:"capacity"}. */
export class CapacityError extends Error {
  constructor() {
    super("photon shared-line capacity");
    this.name = "CapacityError";
  }
}

/** `join:<planId>:<userId>`, plus `:<n>` once the user has n released seats (else Photon replays the released one). */
export function joinIdempotencyKey(planId: string, userId: string, releasedCount: number): string {
  return `join:${planId}:${userId}${releasedCount > 0 ? `:${releasedCount}` : ""}`;
}

/**
 * Reuses the active app.assignments row, else messaging.assign(phone, first_name, joinIdempotencyKey) and records it.
 * ASSIGNMENT_EXISTS → findAssignmentByHandle and adopt. Capacity problems → throws CapacityError.
 */
export async function ensureSeat(user: UserRow, planId: string): Promise<Seat> {
  const active = await getActiveAssignment(user.id);
  if (active) return { assignmentId: active.photon_assignment_id, assignedPhoneNumber: active.assigned_number };

  const key = joinIdempotencyKey(planId, user.id, await countReleasedAssignments(user.id));
  let seat: Seat;
  try {
    seat = await ports.messaging.assign(user.phone_e164, user.first_name, key);
  } catch (e) {
    const action = problemAction(problemCode(e));
    if (action === "capacity") throw new CapacityError();
    if (action !== "assignment_exists") throw e;
    // Photon has a seat we have no row for (earlier crash between assign and insert): adopt it.
    const existing = await findAssignmentByHandle(user.phone_e164);
    if (!existing) throw e;
    seat = existing;
  }
  const row = await insertAssignment({ user_id: user.id, photon_assignment_id: seat.assignmentId, assigned_number: seat.assignedPhoneNumber });
  return { assignmentId: row.photon_assignment_id, assignedPhoneNumber: row.assigned_number };
}

/** messaging.release(active seat) + markAssignmentReleased. No-op without an active seat. */
export async function releaseSeat(userId: string): Promise<void> {
  const active = await getActiveAssignment(userId);
  if (!active) return;
  await ports.messaging.release(active.photon_assignment_id);
  await markAssignmentReleased(active.photon_assignment_id);
}

/** Releases every active seat whose user's phone is not in DEMO_TEAM. Returns how many were released. */
export async function releaseAllExceptTeam(): Promise<number> {
  const seats = await listActiveAssignmentsExcept(env.DEMO_TEAM.map((m) => m.phone_e164));
  let released = 0;
  // Sequential: Photon rate-limits, and one failed release must not strand the rest.
  for (const s of seats) {
    try {
      await ports.messaging.release(s.photon_assignment_id);
      await markAssignmentReleased(s.photon_assignment_id);
      released++;
    } catch (e) {
      log.warn({ user_id: s.user_id, ...errInfo(e) }, "seat release failed");
    }
  }
  return released;
}
