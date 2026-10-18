// LLM_MODE=anthropic. Owners: A (parseBudget, parsePreferences, parseBallot, repairScoutJson), B (rateBundles prompt/model).
// Rules (PLAN §9, P5): client.messages.parse + zodOutputFormat, effort "low", NO tools / tool_choice / assistant prefill.
import type { BallotParse, BudgetParse, DelegateInput, Preferences, PublicBundle, Ratings } from "@tab/shared";
import type { LLMPort } from "./types";
import { notImplemented } from "./notImplemented";

export class AnthropicLLM implements LLMPort {
  async parseBudget(_i: DelegateInput): Promise<BudgetParse> {
    return notImplemented("AnthropicLLM.parseBudget", "A");
  }
  async parsePreferences(_i: DelegateInput): Promise<Preferences> {
    return notImplemented("AnthropicLLM.parsePreferences", "A");
  }
  async parseBallot(_i: DelegateInput, _shortlist: PublicBundle[]): Promise<BallotParse> {
    return notImplemented("AnthropicLLM.parseBallot", "A");
  }
  async rateBundles(_prefs: Preferences, _bundles: PublicBundle[]): Promise<Ratings> {
    return notImplemented("AnthropicLLM.rateBundles", "B");
  }
  async repairScoutJson(_raw: string, _category: "dinner" | "show"): Promise<unknown> {
    return notImplemented("AnthropicLLM.repairScoutJson", "A");
  }
}
