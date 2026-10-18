// X-ray: what CREAO actually receives (B plan T7). Briefs are PII-free by construction (P6), so they are previewed. Owner B.
import type { ResearchBrief } from "@tab/shared";
import { emit } from "../events";

/** Partial context list; the console merges by name. */
export async function emitScoutXray(_planId: string, briefs: readonly ResearchBrief[]): Promise<void> {
  await emit({
    type: "xray",
    contexts: briefs.map((b) => ({ name: `scout_input:${b.category}`, locked: false, preview: JSON.stringify(b) })),
  });
}
