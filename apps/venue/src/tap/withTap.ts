import type { TapVerifyReport } from "@tab/shared";
import { env } from "../env";
import { dbNonces } from "./nonces";
import { verifyTap } from "./verify";

export type TapCtx = { body: Buffer; report: TapVerifyReport };

let keysCache: { raw: string; keys: Record<string, JsonWebKey> } | undefined;
export function keyDirectory(): Record<string, JsonWebKey> {
  const raw = env().TAP_KEY_DIRECTORY_JSON;
  if (keysCache?.raw !== raw) keysCache = { raw, keys: JSON.parse(raw) };
  return keysCache.keys;
}

/** Verifies TAP, then calls the handler with the raw body bytes. On failure: 401 with the report. */
export function withTap<C>(
  handler: (req: Request, ctx: C, tap: TapCtx) => Promise<Response>,
  onReject?: (report: TapVerifyReport, ctx: C) => Response | Promise<Response>,
) {
  return async (req: Request, ctx: C): Promise<Response> => {
    const body = Buffer.from(await req.arrayBuffer());
    const report = await verifyTap(
      { method: req.method, path: new URL(req.url).pathname, headers: req.headers, body },
      { now: () => Math.floor(Date.now() / 1000), authority: env().VENUE_PUBLIC_HOST, keys: keyDirectory() as never, nonces: dbNonces },
    );
    if (!report.accepted) return onReject ? onReject(report, ctx) : Response.json({ error: "tap_rejected", tap: report }, { status: 401 });
    return handler(req, ctx, { body, report });
  };
}
