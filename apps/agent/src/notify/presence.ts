// Cosmetic Photon calls (typing, mark-as-read): fire-and-forget, never block or fail a reply (A plan T1/T3/T7).
// A send clears typing, so there is no setTyping(false). Owner A.
import type { InboundEvent } from "@tab/shared";
import { env } from "../env";
import { errInfo, log } from "../log";
import { ports, type DmAddress } from "../ports";
import { getDmRoute } from "../repo/dmRoutes";
import { listRecipients } from "../repo/participants";
import { getPlan } from "../repo/plans";

/** Runs `f` without awaiting; a rejection (or synchronous throw) is logged as `{what, ...errInfo}` and swallowed. */
export function safe(what: string, f: () => Promise<unknown>): void {
  void Promise.resolve()
    .then(f)
    .catch((err) => log.warn({ what, ...errInfo(err) }, "cosmetic call failed"));
}

/** markRead(e.message_id, `read:${e.message_id}`) via safe(). */
export function markReadSafe(e: InboundEvent): void {
  safe("markRead", () => ports.messaging.markRead(e.message_id, `read:${e.message_id}`));
}

/** setTyping(to, true) via safe(). */
export function typingOn(to: DmAddress): void {
  safe("setTyping", () => ports.messaging.setTyping(to, true));
}

// A forgotten stop must not type forever: each tick re-checks the plan state, and a hard cap ends the loop.
const MAX_TYPING_MS = 15 * 60_000;
const typing = new Map<string, { timer: NodeJS.Timeout; busy: boolean; startedAt: number }>();

async function typingTick(planId: string): Promise<void> {
  const t = typing.get(planId);
  if (!t || t.busy) return; // a slow tick never overlaps the next one
  if (Date.now() - t.startedAt > MAX_TYPING_MS) return stopPlanTyping(planId);
  t.busy = true;
  try {
    const plan = await getPlan(planId);
    // COLLECTING is tolerated: start may run before the RESEARCHING transition's transaction is visible.
    if (plan?.state !== "RESEARCHING" && plan?.state !== "COLLECTING") return stopPlanTyping(planId);
    const routes = await Promise.all((await listRecipients(planId)).map((m) => getDmRoute(m.user_id)));
    for (const to of routes) if (to) typingOn(to);
  } finally {
    t.busy = false;
  }
}

/**
 * RESEARCHING typing: an in-memory interval per plan that calls typingOn for every recipient with a dm_route
 * every TYPING_REFRESH_MS. Idempotent per plan; lost on restart (fine).
 */
export function startPlanTyping(planId: string): void {
  if (typing.has(planId)) return;
  const timer = setInterval(() => safe("planTyping", () => typingTick(planId)), env.TYPING_REFRESH_MS);
  timer.unref();
  typing.set(planId, { timer, busy: false, startedAt: Date.now() });
  safe("planTyping", () => typingTick(planId));
}

/** Clears the plan's typing interval (plan left RESEARCHING). Idempotent. */
export function stopPlanTyping(planId: string): void {
  const t = typing.get(planId);
  if (!t) return;
  clearInterval(t.timer);
  typing.delete(planId);
}
