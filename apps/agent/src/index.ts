// Agent entry point (foundation-owned, then frozen). Importing this module boots the agent.
// Routes and due_jobs kinds are mounted only by the owners' register functions, which app.ts calls:
// registerA (src/plan/register.ts), registerB (src/agentApi/register.ts), registerC (src/venueClient/register.ts).
import type { Server } from "node:http";
import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { sql } from "./db";
import { createPoller } from "./dueJobs";
import { env } from "./env";
import { startEventBroadcaster } from "./events";
import { handleInbound } from "./inbound";
import { errInfo, log } from "./log";
import { ports } from "./ports";

export async function boot(port = env.PORT) {
  const stopBroadcaster = await startEventBroadcaster();
  const app = createApp(); // registers every owner's job kinds, so it must run before the poller starts
  const poller = createPoller();
  poller.start();
  await ports.messaging.start(handleInbound);

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
