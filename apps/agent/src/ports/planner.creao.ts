// PLANNER_MODE=live. Owner B: implement here or in src/creao/client.ts and re-export it from this file
// (PLAN §10 CREAO facts; docs/plans/B-intelligence-experience.md T4).
import type { ConciergeInput, CreaoRun, ResearchBrief } from "@tab/shared";
import type { PlannerPort } from "./types";
import { notImplemented } from "./notImplemented";

export class CreaoPlanner implements PlannerPort {
  async startScout(_planRef: string, _brief: ResearchBrief, _attempt: number): Promise<{ runId: string }> {
    return notImplemented("CreaoPlanner.startScout", "B");
  }
  async startConcierge(_input: ConciergeInput): Promise<{ runId: string }> {
    return notImplemented("CreaoPlanner.startConcierge", "B");
  }
  async getRun(_runId: string): Promise<CreaoRun> {
    return notImplemented("CreaoPlanner.getRun", "B");
  }
  async cancel(_runId: string): Promise<void> {
    notImplemented("CreaoPlanner.cancel", "B");
  }
  async downloadArtifact(_runId: string, _artifactId: string): Promise<Uint8Array> {
    return notImplemented("CreaoPlanner.downloadArtifact", "B");
  }
}
