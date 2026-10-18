// Port factories: one instance per process, chosen by the PLAN §11 modes.
// PLANNER_MODE=cached also uses the mock (no CREAO calls); B's research code reads the mode to go straight to fixtures.
import { env, type Env } from "../env";
import { emit } from "../events";
import { errInfo, log } from "../log";
import { AnthropicLLM } from "./llm.anthropic";
import { MockLLM } from "./llm.mock";
import { MockMessaging } from "./messaging.mock";
import { PhotonMessaging } from "./messaging.photon";
import { CreaoPlanner } from "./planner.creao";
import { MockPlanner } from "./planner.mock";
import type { LLMPort, MessagingPort, PlannerPort, VenuePort } from "./types";
import { LiveVenue } from "./venue.live";
import { MockVenue } from "./venue.mock";

export type * from "./types";
export { MockLLM, MockMessaging, MockPlanner, MockVenue };

export type Ports = { messaging: MessagingPort; planner: PlannerPort; llm: LLMPort; venue: VenuePort };

export function createPorts(e: Pick<Env, "MESSAGING_MODE" | "LLM_MODE" | "PLANNER_MODE" | "VENUE_MODE">): Ports {
  return {
    messaging: e.MESSAGING_MODE === "photon" ? new PhotonMessaging() : new MockMessaging(),
    llm: e.LLM_MODE === "anthropic" ? new AnthropicLLM() : new MockLLM(),
    planner:
      e.PLANNER_MODE === "live"
        ? new CreaoPlanner()
        : new MockPlanner({
            progress: ({ runId, kind, category, step }) =>
              emit({ type: "creao.progress", run_id: runId, kind, category, step }).then(
                () => {},
                (err) => log.warn(errInfo(err), "mock planner progress"),
              ),
          }),
    venue: e.VENUE_MODE === "live" ? new LiveVenue() : new MockVenue(),
  };
}

export const ports: Ports = createPorts(env);
