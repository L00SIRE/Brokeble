// Owner B. The only place B mounts routes and registers due_jobs kinds (standard-names "register.ts"). Final wiring:
// builders implement the functions below and never edit this file. None of these routes get CORS (server to server).
import type { Register } from "../app";
import { registerBJobs } from "../creao/jobs";
import { mountCreaoHook } from "../creao/hook";
import { env } from "../env";
import { voiceNudgeJob, VOICE_NUDGE_KIND } from "../voice/call";
import { mountVoiceHook } from "../voice/hook";
import { mountHostedPages } from "./pages";
import { mountAgentApi } from "./routes";

export const registerB: Register = (app, jobs) => {
  mountAgentApi(app); // GET /agent/ping, POST /agent/{progress,options/validate,options,itinerary}
  mountCreaoHook(app); // POST /creao/hook/:secret
  mountHostedPages(app); // GET /p/:planRef/itinerary, GET /p/:planRef/plan.ics
  registerBJobs(jobs); // creao_poll, creao_timeout, check_research_ready
  if (env.VOICE_ENABLED) {
    mountVoiceHook(app); // POST /voice/hook
    jobs.register(VOICE_NUDGE_KIND, voiceNudgeJob);
  }
};
