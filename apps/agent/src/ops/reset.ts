// Reset and Replay (A plan T14). Owner A.
import { randomBytes } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { env } from "../env";
import { emit } from "../events";
import { errInfo, log } from "../log";
import { cancelResearch } from "../creao/research";
import { clearAwaiting } from "../delegates/awaiting";
import { transition } from "../plan/machine";
import { ports } from "../ports";
import * as dmRoutes from "../repo/dmRoutes";
import * as participants from "../repo/participants";
import * as plans from "../repo/plans";
import type { PlanRow } from "../repo/types";
import * as users from "../repo/users";
import { route } from "../router/route";
import { toInboundEvent } from "../dev/inbound";
import { loadDemoScript, seedDemo } from "./seed";

const VENUE_CANCEL_TIMEOUT_MS = 7_000; // Reset must answer in < 10 s; a slow venue keeps cancelling in the background
const CODE_RETRIES = 10;

/** The demo operator hit Replay before the plan was ready, or a scripted lane has nowhere to receive replies. */
export class ReplayError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReplayError";
  }
}

async function warn(msg: string, e: unknown): Promise<void> {
  log.warn(errInfo(e), msg);
  await emit({ type: "system", level: "warn", msg }).catch(() => {});
}

/** Reverses a plan's live holds. Failures are surfaced to the console but never block the reset. */
async function cancelVenueOrder(orderId: string): Promise<void> {
  const cancel = ports.venue.cancel(orderId, "reset");
  cancel.catch(() => {}); // a late rejection after the timeout won the race must not be unhandled
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error("venue cancel timed out")), VENUE_CANCEL_TIMEOUT_MS)));
  try {
    await Promise.race([cancel, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function retireActivePlan(plan: PlanRow): Promise<void> {
  if (plan.venue_order_id) await cancelVenueOrder(plan.venue_order_id).catch((e) => warn("reset: venue cancel failed", e));
  await transition(plan.id, plans.ACTIVE_STATES, "CANCELLED"); // no DMs: the demo operator is resetting, not the group
  await cancelResearch(plan.id).catch((e) => warn("reset: research cancel failed", e));
  // A stale "awaiting yes/no" flag would hijack the team's next text after the new plan is seeded.
  for (const m of await participants.listMembers(plan.id, { active: false })) clearAwaiting(m.user_id);
}

/** Moves the plan holding DEMO_CODE to a throwaway code so the seed can re-take it. */
async function freeDemoCode(): Promise<void> {
  for (let i = 0; i < CODE_RETRIES; i++) {
    const spare = `R${randomBytes(2).toString("hex").slice(0, 3)}`; // never all digits, so it can't equal a real join code
    try {
      await plans.renameCode(env.DEMO_CODE, spare);
      return;
    } catch (e) {
      if (!(e instanceof Error && "code" in e && e.code === "23505")) throw e;
    }
  }
  throw new Error("could not free the demo join code");
}

let inflight: Promise<{ ok: true; plan_id: string }> | null = null;

/**
 * For each active plan (never SHOWCASE): venue_order_id ⇒ venue.cancel(orderId, "reset") (reverses holds); then
 * transition(ACTIVE_STATES→CANCELLED) with NO DMs and B's cancelResearch(planId). Free DEMO_CODE, seedDemo(), emit
 * system:info "reset". Never waits for CREAO or ratings. Concurrent calls share one run (a double click must not double-seed).
 */
export function resetDemo(): Promise<{ ok: true; plan_id: string }> {
  inflight ??= (async () => {
    const active = await plans.listActivePlans();
    await Promise.all(active.map(retireActivePlan));
    await freeDemoCode();
    const { planId } = await seedDemo();
    await emit({ type: "system", level: "info", msg: "reset" });
    return { ok: true as const, plan_id: planId };
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}

export type ReplayOptions = { pauseMs?: number; pollMs?: number; readyTimeoutMs?: number };

/** Replayed texts go to the seeded recompute's shortlist, so wait until the plan is actually voting. */
async function waitForVoting(planId: string, pollMs: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const plan = await plans.getPlan(planId);
    if (plan?.state === "VOTING") return;
    if (plan?.state !== "RESEARCHING" || Date.now() >= deadline) throw new ReplayError(`plan is ${plan?.state ?? "gone"}, not VOTING`);
    await sleep(pollMs);
  }
}

/**
 * resetDemo(), then feeds fixtures/demo-script.json through route() (as /dev/inbound does) with synthetic event ids.
 * Each text arrives as the team member's real Photon identity and DM space, so replies reach their phones; in photon
 * mode every scripted lane must have texted the agent once already.
 */
export async function replayDemo(o: ReplayOptions = {}): Promise<{ ok: true; steps: number }> {
  const { pauseMs = 1_500, pollMs = 500, readyTimeoutMs = 90_000 } = o;
  const script = await loadDemoScript();
  const { plan_id: planId } = await resetDemo();
  const team = env.DEMO_TEAM;

  const senders = new Map<number, { handle: string; photonUserId?: string; space?: { spaceId: string; agentUserId: string } }>();
  for (const { lane } of script.steps) {
    const member = team[lane - 1];
    if (!member) throw new ReplayError(`script lane ${lane} has no DEMO_TEAM member`);
    if (senders.has(lane)) continue;
    const user = await users.findUserByPhone(member.phone_e164);
    const space = user ? await dmRoutes.getDmRoute(user.id) : null;
    if (!space && env.MESSAGING_MODE === "photon") throw new ReplayError(`lane ${lane} has not texted the agent yet`);
    senders.set(lane, { handle: member.phone_e164, photonUserId: user?.photon_user_id ?? undefined, space: space ?? undefined });
  }

  await waitForVoting(planId, pollMs, readyTimeoutMs);
  for (const [i, step] of script.steps.entries()) {
    const s = senders.get(step.lane)!;
    await route(
      toInboundEvent({
        from_handle: s.handle,
        text: step.text,
        content_type: "text",
        parent_message_id: null,
        from_user_id: s.photonUserId,
        space_id: s.space?.spaceId,
        agent_user_id: s.space?.agentUserId,
        event_id: `replay:${planId}:${i}`,
        message_id: `replay_msg:${planId}:${i}`,
      }),
    );
    if (pauseMs > 0 && i < script.steps.length - 1) await sleep(pauseMs);
  }
  return { ok: true, steps: script.steps.length };
}
