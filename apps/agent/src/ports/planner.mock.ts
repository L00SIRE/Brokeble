// PLANNER_MODE=mock|cached: no CREAO calls. A Scout run completes after `delayMs` with the cached fixture as its
// result text (fenced JSON, as Scout writes it), emitting fake progress on the way.
import { randomUUID } from "node:crypto";
import { type Category, ConciergeInput, type CreaoRun, ResearchBrief } from "@tab/shared";
import { loadCachedOptions } from "./cachedOptions";
import type { PlannerPort } from "./types";

type Progress = (p: { runId: string; kind: "scout" | "concierge"; category: Category | null; step: string }) => Promise<void>;
type MockRun = { id: string; kind: "scout" | "concierge"; category: Category | null; planRef: string; startedAt: number; cancelled: boolean };

export class MockPlanner implements PlannerPort {
  private readonly runs = new Map<string, MockRun>();
  private readonly delayMs: number;
  private readonly progress: Progress | undefined;

  constructor(o: { delayMs?: number; progress?: Progress } = {}) {
    this.delayMs = o.delayMs ?? 5_000;
    this.progress = o.progress;
  }

  async startScout(planRef: string, brief: ResearchBrief, _attempt: number): Promise<{ runId: string }> {
    const b = ResearchBrief.parse(brief); // P6 holds in mock mode too
    return { runId: this.begin("scout", b.category, planRef, [`searching ${b.category} options in ${b.area} (mock)`, "validating options.json (mock)"]) };
  }

  async startConcierge(input: ConciergeInput): Promise<{ runId: string }> {
    const i = ConciergeInput.parse(input);
    return { runId: this.begin("concierge", null, i.plan_ref, ["drafting itinerary (mock)"]) };
  }

  async getRun(runId: string): Promise<CreaoRun> {
    const r = this.runs.get(runId);
    if (!r) throw new Error(`mock planner: unknown run ${runId}`);
    const base = { id: r.id, threadId: `thr_${r.id}` };
    if (r.cancelled) return { ...base, status: "cancelled" };
    const elapsed = Date.now() - r.startedAt;
    if (elapsed < Math.min(300, this.delayMs)) return { ...base, status: "pending" };
    if (elapsed < this.delayMs) return { ...base, status: "running" };
    if (r.kind === "concierge") return { ...base, status: "completed", result: { text: "Mock Concierge run: no itinerary produced (use the code fallback).", artifacts: [] } };
    const { run_id: _r, share_url: _s, captured_at: _c, brief: _b, ...submission } = await loadCachedOptions(r.category!, r.planRef);
    return { ...base, status: "completed", result: { text: "```json\n" + JSON.stringify(submission) + "\n```", artifacts: [] } };
  }

  async cancel(runId: string): Promise<void> {
    const r = this.runs.get(runId);
    if (r) r.cancelled = true;
  }

  async downloadArtifact(runId: string, artifactId: string): Promise<Uint8Array> {
    throw new Error(`mock planner: no artifact ${artifactId} on run ${runId}`);
  }

  private begin(kind: MockRun["kind"], category: Category | null, planRef: string, steps: string[]): string {
    const id = `mock_run_${randomUUID()}`;
    this.runs.set(id, { id, kind, category, planRef, startedAt: Date.now(), cancelled: false });
    steps.forEach((step, i) => {
      const t = setTimeout(() => {
        if (!this.runs.get(id)?.cancelled) void this.progress?.({ runId: id, kind, category, step }).catch(() => {});
      }, ((i + 1) * this.delayMs) / (steps.length + 1));
      t.unref();
    });
    return id;
  }
}
