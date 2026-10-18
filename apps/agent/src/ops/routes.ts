// POST /ops/{reset,replay,tap-test,live-scout,release-seats,release-untexted} (PLAN §18, A plan T14). Bearer OPERATOR_KEY compared in
// constant time (auth.ts hasKey). CORS (opsCors) is already applied to /ops/* by app.ts. Owner A.
import type { Context, Hono } from "hono";
import * as z from "zod";
import { hasKey } from "../auth";
import { startLiveScoutDemo } from "../creao/liveDemo";
import { env } from "../env";
import { ports } from "../ports";
import { releaseAllExceptTeam, releaseUntexted } from "../join/seats";
import * as plans from "../repo/plans";
import { errInfo, log } from "../log";
import { VenueHttpError } from "../venueClient";
import { runTapTest } from "../venueClient/tapTest";
import { replayDemo, ReplayError, resetDemo } from "./reset";

export const TapTestBody = z.strictObject({ kind: z.enum(["tamper", "replay", "expired", "wrong_tag"]) });

/** Mounts the six ops routes; each handler first calls requireOperator(c). */
export function mountOps(app: Hono): void {
  app.post("/ops/reset", handleReset);
  app.post("/ops/replay", handleReplay);
  app.post("/ops/tap-test", handleTapTest);
  app.post("/ops/live-scout", handleLiveScout);
  app.post("/ops/release-seats", handleReleaseSeats);
  app.post("/ops/release-untexted", handleReleaseUntexted);
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

/** The step the venue rejected at, and whether it is the step this kind is meant to hit. */
export function tapVerdict(r: Awaited<ReturnType<typeof runTapTest>>) {
  const failed = r.tap.steps.find((s) => !s.ok) ?? null;
  return {
    result: r.result,
    expected_step: r.expected_step,
    failed_step: failed?.n ?? null,
    failed_name: failed?.name ?? null,
    reason: r.tap.reason ?? failed?.detail ?? null,
    matched: failed?.n === r.expected_step,
    captured: r.result === "captured",
  };
}

/**
 * TapTestBody -> runTapTest(kind, latestPlanWithOrder().venue_order_id). Never cancels, never commits (every kind is
 * rejected by the venue; see tapTest.ts). Never a 5xx: no order or a venue-side refusal is 409, an unreachable or
 * misbehaving venue is 424, each with a readable `message`.
 */
export async function handleTapTest(c: Context): Promise<Response> {
  const denied = requireOperator(c);
  if (denied) return denied;
  const body = TapTestBody.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ ok: false, error: "invalid", message: "Unknown test kind.", issues: z.flattenError(body.error).fieldErrors }, 400);
  try {
    const orderId = (await plans.latestPlanWithOrder())?.venue_order_id;
    if (!orderId) return c.json({ ok: false, error: "no_order", message: "No order to test yet. The plan has to reach ordering first." }, 409);
    const r = await runTapTest(body.data.kind, orderId, ports.venue);
    return c.json({ ok: true, ...tapVerdict(r) });
  } catch (e) {
    log.error(errInfo(e), "ops tap-test failed");
    if (e instanceof VenueHttpError && e.status >= 400 && e.status < 500) {
      return c.json({ ok: false, error: "venue_refused", message: `The venue could not find or serve this order (HTTP ${e.status}).` }, 409);
    }
    return c.json({ ok: false, error: "venue_unavailable", message: "The venue did not answer. Try again in a few seconds." }, 424);
  }
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

/**
 * releaseUntexted(15) → 200 {ok:true, released}. Frees seats older than 15 minutes whose user never texted on them
 * (mistyped numbers, judges who never hit send), keeping DEMO_TEAM. Safe while judges are mid-plan, unlike
 * /ops/release-seats: anyone who texted keeps their seat.
 */
export async function handleReleaseUntexted(c: Context): Promise<Response> {
  const denied = requireOperator(c);
  if (denied) return denied;
  return c.json({ ok: true, released: await releaseUntexted() });
}
