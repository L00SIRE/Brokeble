// B's prompts for LLMPort.rateBundles / repairScoutJson; A's delegates/anthropicLLM.ts sends them (standard-names
// "Anthropic"). Fixed system strings; only public bundle fields and one member's own prefs reach the model. Owner B.
import type { Preferences, RateCandidate } from "@tab/shared";

export const RATE_SYSTEM =
  "You rate evening plans for ONE person using ONLY their stated preferences. Ignore price; price is handled elsewhere. " +
  "Score each plan index from 0 to 1. Dishes and cuisines they like raise a plan's score. If a plan's dinner or show " +
  "clearly serves or is built around something in their cuisines_avoid or dealbreakers (for example a steakhouse or " +
  "burger place when they avoid beef), score it 0.05, the floor.";

export const REPAIR_SYSTEM = "Fix this JSON to match the schema; do not invent fields.";

/** JSON.stringify({ preferences: prefs, plans: candidates }): public fields only, no names or budgets. */
export function buildRateUserMessage(prefs: Preferences, candidates: readonly RateCandidate[]): string {
  return JSON.stringify({ preferences: prefs, plans: candidates });
}
