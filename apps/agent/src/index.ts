// Agent entry point and composition root: the one place routes are mounted and due_jobs kinds are registered.
// Owners add their mounts/registrations below in one announced change each. Importing this module boots the agent.
import type { Server } from "node:http";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { routePath } from "hono/route";
import { sql } from "./db";
import { devRoutes } from "./dev/inbound";
import { createPoller } from "./dueJobs";
import { env, isDevRuntime } from "./env";
import { eventsRoutes, startEventBroadcaster } from "./events";
import { handleInbound } from "./inbound";
import { errInfo, log } from "./log";
import { ports } from "./ports";

export function createApp(): Hono {
  const app = new Hono();
  app.use("*", cors({ origin: env.WEB_ORIGIN, allowMethods: ["GET", "POST", "OPTIONS"], allowHeaders: ["Authorization", "Content-Type", "Last-Event-ID"], maxAge: 600 }));
  app.use("*", async (c, next) => {
    const t0 = performance.now();
    await next();
    // Route pattern, never the raw path: paths and queries can carry secrets (/creao/hook/:secret, ?k=).
    const fields = { method: c.req.method, route: routePath(c, -1), status: c.res.status, ms: Math.round(performance.now() - t0) };
    if (fields.route === "/healthz") log.debug(fields, "http");
    else log.info(fields, "http");
  });
  app.onError((err, c) => {
    log.error({ route: routePath(c, -1), ...errInfo(err) }, "unhandled");
    return c.json({ error: "internal" }, 500);
  });

  app.get("/healthz", (c) => c.json({ ok: true }));
  app.route("/", eventsRoutes);
  if (env.MESSAGING_MODE === "mock" && isDevRuntime) app.route("/", devRoutes(ports));
  // A: app.route("/", joinRoutes); app.route("/", opsRoutes); venue hook (POST /venue/hook)
  // B: app.route("/", agentApiRoutes); app.route("/", creaoHookRoutes)
  return app;
}

function registerJobs(): void {
  // A: registerJob("recompute", …), "vote_deadline", "create_order", "commit", "approve_reping", "approve_deadline", "venue_sweep", …
  // B: registerJob("creao_poll", …), "creao_timeout", "check_research_ready", "run_shortlist", …
}

export async function boot(port = env.PORT) {
  const stopBroadcaster = await startEventBroadcaster();
  registerJobs();
  const poller = createPoller();
  poller.start();
  await ports.messaging.start(handleInbound);

  const app = createApp();
  const { server, boundPort } = await new Promise<{ server: Server; boundPort: number }>((resolve) => {
    const s = serve({ fetch: app.fetch, port }, (info) => resolve({ server: s as Server, boundPort: info.port }));
  });
  log.info(
    { port: boundPort, modes: { messaging: env.MESSAGING_MODE, llm: env.LLM_MODE, planner: env.PLANNER_MODE, venue: env.VENUE_MODE } },
    "tab-agent listening",
  );

  let stopping: Promise<void> | undefined;
  const stop = () =>
    (stopping ??= (async () => {
      server.close();
      server.closeAllConnections(); // open SSE streams would otherwise hold close() forever
      await poller.stop();
      await stopBroadcaster();
      await sql.end({ timeout: 5 });
    })());
  return { app, server, port: boundPort, url: `http://127.0.0.1:${boundPort}`, poller, stop };
}

export const agent = await boot();

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    log.info({ signal }, "shutting down");
    agent.stop().then(
      () => process.exit(0),
      (e) => {
        log.error(errInfo(e), "shutdown");
        process.exit(1);
      },
    );
  });
}
