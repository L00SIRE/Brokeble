// POST /creao/hook/:secret (PLAN §18, B plan T5). Webhooks are unsigned: the body is a HINT, never trusted. Always 200
// fast (CREAO retries after 10 s); the run is re-fetched by reconcile. The route pattern (never the path) is logged by
// app.ts. Owner B.
import type { Context, Hono } from "hono";
import { safeEqual } from "../auth";
import { env } from "../env";
import { errInfo, log } from "../log";
import { insertInboundEvent } from "../repo/inboundEvents";
import { reconcileByCreaoRunId } from "./research";

/** Mounts POST /creao/hook/:secret → handleCreaoHook. No CORS (server to server). */
export function mountCreaoHook(app: Hono): void {
  app.post("/creao/hook/:secret", handleCreaoHook);
}

const ID = /^[A-Za-z0-9_-]{1,128}$/;
const idOrNull = (v: unknown): string | null => (typeof v === "string" && ID.test(v) ? v : null);

/** Test seam: the reconcile scheduler (default setImmediate, so the 200 never waits on CREAO). */
export const hookDeps = {
  dedupe: (eventId: string): Promise<boolean> => insertInboundEvent("creao", eventId),
  schedule: (f: () => void): void => void setImmediate(f),
  reconcile: reconcileByCreaoRunId,
};

/**
 * Secret mismatch (or unset) → 404. Parse {runId} leniently; dedupe on X-Creao-Delivery-Id ?? runId (one UUID per
 * result across attempts) → fresh ⇒ reconcile re-fetches GET /runs/{id}. A dedupe-store failure still reconciles:
 * reconcile is idempotent, and dropping a hint would only delay the run until the next poll.
 */
export async function handleCreaoHook(c: Context): Promise<Response> {
  const expected = env.CREAO_HOOK_SECRET;
  if (!expected || !safeEqual(c.req.param("secret") ?? "", expected)) return c.body(null, 404);

  let runId: string | null = null;
  try {
    runId = idOrNull((JSON.parse(await c.req.text()) as { runId?: unknown } | null)?.runId);
  } catch {
    // malformed body: acknowledged and ignored (polling covers the run)
  }
  if (!runId) {
    log.warn("creao.hook.no_run_id");
    return c.json({ ok: true });
  }

  const deliveryId = idOrNull(c.req.header("x-creao-delivery-id"));
  let fresh = true;
  try {
    fresh = await hookDeps.dedupe(deliveryId ?? runId);
  } catch (e) {
    log.warn({ creaoRunId: runId, ...errInfo(e) }, "creao.hook.dedupe_failed");
  }
  if (fresh) {
    const id = runId;
    hookDeps.schedule(() => {
      hookDeps.reconcile(id).catch((e: unknown) => log.error({ creaoRunId: id, ...errInfo(e) }, "creao.hook.reconcile_failed"));
    });
  } else {
    log.debug({ creaoRunId: runId }, "creao.hook.duplicate");
  }
  return c.json({ ok: true });
}
