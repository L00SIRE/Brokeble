// Party-size cap (A plan T4). Owner A.
// The cap counts only lanes whose phone has proven itself by texting JOIN: /join is unauthenticated, so counting
// form-only (INVITED) rows would let a burst of made-up phones lock a plan whose code is on the table QR.
import { getParticipant, countByStage } from "../repo/participants";
import { getPlanByCode } from "../repo/plans";
import type { UserRow } from "../repo/types";

/** The venue's CreateOrderRequest caps party_size at 8 (PLAN §8); a 9th member would strand the plan in ORDERING. */
export const MAX_PARTY = 8;
const JOINABLE = new Set(["COLLECTING", "RESEARCHING", "VOTING"]);
const NOT_CONFIRMED = new Set(["INVITED", "DECLINED", "RELEASED"]);

/** Lanes that texted JOIN and are still in the plan (every stage but INVITED/DECLINED/RELEASED). */
export async function confirmedMembers(planId: string): Promise<number> {
  const by = await countByStage(planId);
  return Object.entries(by).reduce((n, [stage, k]) => (NOT_CONFIRMED.has(stage) ? n : n + (k ?? 0)), 0);
}

/**
 * True when this JOIN text would confirm a 9th lane: the plan is joinable, the user's lane is still INVITED and
 * MAX_PARTY lanes are already confirmed. Anything else (unknown code, no lane, already joined) is left to
 * membership.onJoinText. Two simultaneous last JOINs can both pass (no lock here).
 */
export async function joinWouldOverfill(user: UserRow, code: string): Promise<boolean> {
  const plan = await getPlanByCode(code);
  if (!plan || !JOINABLE.has(plan.state)) return false;
  const participant = await getParticipant(plan.id, user.id);
  return participant?.stage === "INVITED" && (await confirmedMembers(plan.id)) >= MAX_PARTY;
}
