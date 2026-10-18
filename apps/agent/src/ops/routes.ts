// POST /ops/{reset,replay,tap-test,live-scout,release-seats} (PLAN §18, A plan T14). Bearer OPERATOR_KEY compared in
// constant time (auth.ts hasKey). CORS (opsCors) is already applied to /ops/* by app.ts. Owner A.
import type { Context, Hono } from "hono";
import * as z from "zod";
import { hasKey } from "../auth";
import { startLiveScoutDemo } from "../creao/liveDemo";
import { env } from "../env";
import { ports } from "../ports";
import { releaseAllExceptTeam } from "../join/seats";
import * as plans from "../repo/plans";
import { runTapTest } from "../venueClient/tapTest";
import { replayDemo, ReplayError, resetDemo } from "./reset";

export const TapTestBody = z.strictObject({ kind: z.enum(["tamper", "replay", "expired", "wrong_tag"]) });

/** Mounts the five ops routes; each handler first calls requireOperator(c). */
export function mountOps(app: Hono): void {
  app.post("/ops/reset", handleReset);
  app.post("/ops/replay", handleReplay);
  app.post("/ops/tap-test", handleTapTest);
  app.post("/ops/live-scout", handleLiveScout);
  app.post("/ops/release-seats", handleReleaseSeats);
}

/** null when Authorization is Bearer OPERATOR_KEY; else the 401 (or 503 when OPERATOR_KEY is unset) response. */
export function requireOperator(c: Context): Response | null {
  if (!env.OPERATOR_KEY) return c.json({ ok: false, error: "ops_disabled" }, 503);
  if (!hasKey(c, env.OPERATOR_KEY)) return c.json({ ok: false, error: "unauthorized" }, 401);
  return null;
}

/** resetDemo() → 200 {ok:true}. Must answer in < 10 s. */
export async function handleReset(c: Context): Promise<Response> {
  const denied = requireOperator(c);
  if (denied) return denied;
  const { plan_id } = await resetDemo();
  return c.json({ ok: true, plan_id });
}

/** resetDemo() then the scripted texts → 200 {ok:true, steps}. 409 when the plan or a team lane isn't ready. */
export async function handleReplay(c: Context): Promise<Response> {
  const denied = requireOperator(c);
  if (denied) return denied;
  try {
    return c.json(await replayDemo());
  } catch (e) {
    if (e instanceof ReplayError) return c.json({ ok: false, error: e.message }, 409);
    throw e;
  }
}

/** TapTestBody → C's runTapTest(kind, latestPlanWithOrder().venue_order_id) → 200 {ok:true}. Never triggers cancel. 409 {ok:false} without an order. */
export async function handleTapTest(c: Context): Promise<Response> {
  const denied = requireOperator(c);
  if (denied) return denied;
  const body = TapTestBody.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ ok: false, error: "invalid", issues: z.flattenError(body.error).fieldErrors }, 400);
  const orderId = (await plans.latestPlanWithOrder())?.venue_order_id;
  if (!orderId) return c.json({ ok: false, error: "no_order" }, 409);
  const { result } = await runTapTest(body.data.kind, orderId, ports.venue);
  return c.json({ ok: true, result });
}

/** B's startLiveScoutDemo() → 200 {ok:true, ...result} or 429 {ok:false, reason:"debounced"}. */
export async function handleLiveScout(c: Context): Promise<Response> {
  const denied = requireOperator(c);
  if (denied) return denied;
  const r = await startLiveScoutDemo();
  return c.json(r, r.ok ? 200 : 429);
}

/** releaseAllExceptTeam() → 200 {ok:true, released}. */
export async function handleReleaseSeats(c: Context): Promise<Response> {
  const denied = requireOperator(c);
  if (denied) return denied;
  return c.json({ ok: true, released: await releaseAllExceptTeam() });
}
