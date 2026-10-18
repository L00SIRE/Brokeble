// Owner A. The only place A mounts routes and registers due_jobs kinds (standard-names "register.ts"). Final wiring:
// builders implement the functions below and never edit this file. CORS for /join, /plans and /ops/* is applied by app.ts.
import type { Register } from "../app";
import { devRoutes } from "../dev/inbound";
import { env, isDevRuntime } from "../env";
import { registerAJobs } from "../jobs/kinds";
import { mountJoin } from "../join/routes";
import { mountOps } from "../ops/routes";
import { ports } from "../ports";
import { mountVenueHook } from "./venueHook";

export const registerA: Register = (app, jobs) => {
  if (env.MESSAGING_MODE === "mock" && isDevRuntime) app.route("/", devRoutes(ports));
  mountJoin(app); // POST /join, POST /plans
  mountVenueHook(app); // POST /venue/hook
  mountOps(app); // POST /ops/{reset,replay,tap-test,live-scout,release-seats}
  registerAJobs(jobs); // still_looking, org_join_status, recompute, vote_deadline, create_order, approve_reping, approve_deadline, commit, venue_sweep
};
