// B's prompts for LLMPort.rateBundles / repairScoutJson; A's delegates/anthropicLLM.ts sends them (standard-names
// "Anthropic"). Fixed system strings; only public bundle fields and one member's own prefs reach the model. Owner B.
import type { Preferences, RateCandidate } from "@tab/shared";

export const RATE_SYSTEM =
  "You rate evening plans for ONE person using ONLY their stated preferences. Ignore price; price is handled elsewhere. " +
  "Score each plan index from 0 to 1.";

export const REPAIR_SYSTEM = "Fix this JSON to match the schema; do not invent fields.";

/** JSON.stringify({ preferences: prefs, plans: candidates }): public fields only, no names or budgets. */
export function buildRateUserMessage(prefs: Preferences, candidates: readonly RateCandidate[]): string {
  return JSON.stringify({ preferences: prefs, plans: candidates });
}
