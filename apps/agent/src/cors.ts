// CORS (PLAN §11). Only the routes a browser on WEB_ORIGIN calls get CORS; server-to-server routes
// (/agent/*, /creao/hook, /venue/hook) get none. app.ts mounts both; a CORS middleware answers preflights
// itself, so a second one mounted later on the same path would never see the OPTIONS request.
import { cors } from "hono/cors";
import { env } from "./env";

/**
 * Paths the web app and console call from the browser: POST /start, /join, /plans; GET /plans/:code (mostly fetched by
 * the Next server, but a client refetch of counts needs it); GET /status (live status polling); GET /events (SSE) and
 * /events/snapshot. A Hono path without a wildcard matches only itself, so "/plans" does not cover "/plans/4821".
 */
export const PUBLIC_CORS_PATHS = ["/join", "/plans", "/plans/:code", "/start", "/status", "/events", "/events/snapshot"] as const;

export const publicCors = cors({
  origin: env.WEB_ORIGIN,
  allowMethods: ["GET", "POST"],
  allowHeaders: ["Authorization", "Content-Type", "Last-Event-ID"],
  maxAge: 600,
});

/** /ops/* (standard-names "Endpoints"): the console's ops bar sends Bearer OPERATOR_KEY, so it needs a preflight. */
export const opsCors = cors({ origin: env.WEB_ORIGIN, allowHeaders: ["Authorization", "Content-Type"], allowMethods: ["POST"] });
