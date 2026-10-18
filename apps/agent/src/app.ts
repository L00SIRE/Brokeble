// The Hono app: foundation middleware and routes, then each owner's register function (standard-names "register.ts").
// Owners mount routes and due_jobs kinds ONLY in their own register.ts; this file and index.ts are frozen.
import { Hono } from "hono";
import { routePath } from "hono/route";
import { registerA } from "./plan/register";
import { registerB } from "./agentApi/register";
import { registerC } from "./venueClient/register";
import { opsCors, PUBLIC_CORS_PATHS, publicCors } from "./cors";
import { jobs as defaultJobs, type Jobs } from "./dueJobs";
import { eventsRoutes } from "./events";
import { errInfo, log } from "./log";

export type Register = (app: Hono, jobs: Jobs) => void;

export const OWNER_REGISTERS: readonly Register[] = [registerA, registerB, registerC];

/** Calls each register once: job kinds can be registered only once per process, so build one app per process. */
export function createApp(o: { registers?: readonly Register[]; jobs?: Jobs } = {}): Hono {
  const app = new Hono();
  app.use("*", async (c, next) => {
    const t0 = performance.now();
    await next();
    // Route pattern, never the raw path: paths and queries can carry secrets (/creao/hook/:secret, ?k=).
    const fields = { method: c.req.method, route: routePath(c, -1), status: c.res.status, ms: Math.round(performance.now() - t0) };
    if (fields.route === "/healthz") log.debug(fields, "http");
    else log.info(fields, "http");
  });
  app.use("/ops/*", opsCors);
  for (const path of PUBLIC_CORS_PATHS) app.use(path, publicCors);
  app.onError((err, c) => {
    log.error({ route: routePath(c, -1), ...errInfo(err) }, "unhandled");
    return c.json({ error: "internal" }, 500);
  });

  app.get("/healthz", (c) => c.json({ ok: true }));
  app.route("/", eventsRoutes);
  for (const register of o.registers ?? OWNER_REGISTERS) register(app, o.jobs ?? defaultJobs);
  return app;
}
