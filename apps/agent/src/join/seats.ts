// Photon shared-line seats (A plan T4/T14). Owner A.
import { env } from "../env";
import { errInfo, log } from "../log";
import { findAssignmentByHandle, type Seat } from "../photon/messaging";
import { problemAction, problemCode } from "../photon/errors";
import { ports } from "../ports";
import {
  countReleasedAssignments, getActiveAssignment, insertAssignment, listActiveAssignmentsExcept, listUntextedAssignments, markAssignmentReleased,
} from "../repo/assignments";
import type { AssignmentRow, UserRow } from "../repo/types";

export type { Seat };

/** SHARED_LINE_CAP_EXCEEDED / SHARED_LINE_POOL_EXHAUSTED: /join, /start and /plans answer 503 {error:"capacity"}. */
export class CapacityError extends Error {
  constructor() {
    super("photon shared-line capacity");
    this.name = "CapacityError";
  }
}

/** Seat scope for POST /start and POST /plans (the organizer's seat exists before any plan does). */
export const START_SEAT_SCOPE = "start";

/** Seat scope for POST /join. Keys stay byte-identical to the pre-scope `join:<planId>:<userId>[:n]` format. */
export const joinSeatScope = (planId: string): string => `join:${planId}`;

/**
 * `<scope>:<userId>`, plus `:<n>` once the user has n released seats in total. The count is across scopes, so any
 * re-seat after any release gets a fresh key (else Photon replays the released assignment).
 */
export function seatIdempotencyKey(scope: string, userId: string, releasedCount: number): string {
  return `${scope}:${userId}${releasedCount > 0 ? `:${releasedCount}` : ""}`;
}

/** `join:<planId>:<userId>[:n]` (pinned by test/skeleton.keys.test.ts). */
export function joinIdempotencyKey(planId: string, userId: string, releasedCount: number): string {
  return seatIdempotencyKey(joinSeatScope(planId), userId, releasedCount);
}

/**
 * Reuses the active app.assignments row (whatever scope created it), else messaging.assign(phone, first_name,
 * seatIdempotencyKey(scope, …)) and records it. ASSIGNMENT_EXISTS → findAssignmentByHandle and adopt. Capacity
 * problems → throws CapacityError.
 */
export async function ensureSeat(user: UserRow, scope: string): Promise<Seat> {
  const active = await getActiveAssignment(user.id);
  if (active) return { assignmentId: active.photon_assignment_id, assignedPhoneNumber: active.assigned_number };

  const key = seatIdempotencyKey(scope, user.id, await countReleasedAssignments(user.id));
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

const teamPhones = (): string[] => env.DEMO_TEAM.map((m) => m.phone_e164);

/** Releases every active seat whose user's phone is not in DEMO_TEAM. Returns how many were released. */
export async function releaseAllExceptTeam(): Promise<number> {
  return releaseEach(await listActiveAssignmentsExcept(teamPhones()));
}

/**
 * Releases seats older than `olderThanMin` minutes whose user never texted on them (a mistyped number, a judge who
 * never hit send), keeping DEMO_TEAM. Safe mid-demo, unlike releaseAllExceptTeam: anyone who texted keeps their seat.
 */
export async function releaseUntexted(olderThanMin = 15): Promise<number> {
  return releaseEach(await listUntextedAssignments(olderThanMin, teamPhones()));
}

async function releaseEach(seats: readonly AssignmentRow[]): Promise<number> {
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
