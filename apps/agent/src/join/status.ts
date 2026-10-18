// GET /status?t= logic (ux-flow §4.3, §7.2). Phone numbers typed on the web are unverified, so anyone can mint a token
// for someone else's number. The proof-of-possession gate: until that number's owner texts SquadTab after the token
// was issued (dm_routes.updated_at ≥ iat; Photon delivers only the assigned handle's own messages), the response
// carries no name, no plan and no steps. After it: the plan card (public preview fields + join_url), the caller's own
// progress as booleans, and counts only. Never member names, never budgets. Owner A.
import { stageAtLeast } from "../plan/machine";
import { getActiveAssignment } from "../repo/assignments";
import { getParticipant } from "../repo/participants";
import { currentPlanForUser, getPlan } from "../repo/plans";
import type { ParticipantRow, PlanRow, UserRow } from "../repo/types";
import { getUser, lastInboundAt } from "../repo/users";
import { buildPlanPreview, JOINABLE_STATES, joinUrlFor } from "./preview";
import type { StatusPhase, StatusResponse } from "./schemas";
import type { StatusTokenClaims } from "./statusToken";

/** Pre-filled first texts (ux-flow §3.3). */
export const SMS_BODY = {
  start: "Hey SquadTab! Help me plan a night out.",
  plansFallback: "Hey SquadTab! Let's get planning.",
  inPlan: "Hey SquadTab, where are we at?",
} as const;

const JOIN_BODY_MAX_TITLE = 40;
/** "I'm in for {title}!" when the title is 40 characters or fewer, else "I'm in!". */
export const joinSmsBody = (title: string): string => (title.length <= JOIN_BODY_MAX_TITLE ? `I'm in for ${title}!` : "I'm in!");

/** iOS/macOS form; Android needs `?body=` (the web builds its own from assigned_number + sms_body). */
export const smsHref = (assignedNumber: string, body: string): string => `sms:${assignedNumber}&body=${encodeURIComponent(body)}`;

/** The token's `iat` (seconds) as ms; a text at or after it passes the gate. */
const textedSince = (last: Date | null, iatS: number): boolean => last !== null && last.getTime() >= iatS * 1000;

/**
 * The body a person who has not texted yet should send, decided only from what the token holder already knows. A guest
 * token was minted by /join for this plan's (public) code, and /join already answered already_joined for the same
 * (code, phone), so the in-plan body for a JOINED guest reveals nothing new. Re-sending "I'm in for …" from inside the
 * plan would be read as an answer to whatever step the guest is on.
 */
async function waitingBody(c: StatusTokenClaims): Promise<string> {
  if (c.r === "organizer") return c.p === null ? SMS_BODY.start : SMS_BODY.plansFallback;
  const plan = c.p ? await getPlan(c.p) : null;
  if (!plan) return SMS_BODY.inPlan;
  const me = await getParticipant(plan.id, c.u);
  return me && stageAtLeast(me.stage, "JOINED") ? SMS_BODY.inPlan : joinSmsBody(plan.title);
}

function phaseFor(c: StatusTokenClaims, u: string, plan: PlanRow | null, me: ParticipantRow | null): { phase: StatusPhase; role: StatusResponse["role"] } {
  if (!plan) return { phase: c.r === "organizer" ? "texted" : "closed", role: c.r };
  const organizes = c.r === "organizer" && plan.organizer_id === u;
  const role = organizes ? "organizer" : "guest";
  if (!JOINABLE_STATES.has(plan.state)) return { phase: "closed", role };
  if (organizes) return { phase: "plan_ready", role };
  if (!me || me.stage === "DECLINED" || me.stage === "RELEASED") return { phase: "closed", role };
  return { phase: stageAtLeast(me.stage, "JOINED") ? "joined" : "waiting", role };
}

/** The status for verified claims, or null when the user no longer exists (or was forgotten): answer 401. */
export async function getStatus(c: StatusTokenClaims): Promise<StatusResponse | null> {
  const user: UserRow | null = await getUser(c.u);
  if (!user || user.phone_e164.startsWith("forgotten:")) return null;
  const [seat, last] = await Promise.all([getActiveAssignment(user.id), lastInboundAt(user.id)]);
  const base = { phone_last4: user.phone_e164.slice(-4), assigned_number: seat?.assigned_number ?? null };

  if (!textedSince(last, c.iat)) {
    return { ...base, phase: "waiting", role: c.r, sms_body: await waitingBody(c), first_name: null, plan: null, steps: null };
  }

  const plan = c.p ? await getPlan(c.p) : await currentPlanForUser(user.id);
  const me = plan ? await getParticipant(plan.id, user.id) : null;
  const { phase, role } = phaseFor(c, user.id, plan, me);
  return {
    ...base,
    phase,
    role,
    sms_body: plan && me && JOINABLE_STATES.has(plan.state) ? SMS_BODY.inPlan : SMS_BODY.start,
    first_name: user.first_name || null,
    plan: plan ? { ...(await buildPlanPreview(plan)), join_url: joinUrlFor(plan.code) } : null,
    steps: me ? { budget: stageAtLeast(me.stage, "BUDGET_LOCKED"), prefs: stageAtLeast(me.stage, "PREFS_DONE") } : null,
  };
}
