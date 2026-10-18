// P1 allowlist: the private hard filter. A pipeline step, never an LLM-callable tool (P5). No logging. Owner B.
// Tests build constraint literals typed via Parameters<typeof filter>[1] (never import @tab/shared/private in tests).
import type { Bundle } from "@tab/shared";
import type { PrivateConstraints } from "@tab/shared/private";
import { HARD_MAX_SLACK } from "./config";

/** hard_max_pp_cents ?? Math.round(target_pp_cents × HARD_MAX_SLACK). */
export function effectiveHardMax(c: Pick<PrivateConstraints, "target_pp_cents" | "hard_max_pp_cents">): number {
  return c.hard_max_pp_cents ?? Math.round(c.target_pp_cents * HARD_MAX_SLACK);
}

/** Keeps a bundle iff all_in_pp_cents ≤ effectiveHardMax(c) for EVERY c (equality kept). */
export function filter(bundles: readonly Bundle[], constraints: readonly PrivateConstraints[]): Bundle[] {
  const cap = Math.min(...constraints.map(effectiveHardMax)); // Infinity when there are no constraints
  return bundles.filter((b) => b.all_in_pp_cents <= cap);
}
