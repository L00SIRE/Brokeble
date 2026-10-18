// Conversational private delegate: input/output contracts (pure; no repo or port imports so the adapter can use them).
// ConverseInput is the structured context code builds and guards against; the model sees it only as ConverseWire.
// The input holds ONLY the sender's own data plus public plan facts (P2). No other member's name, prefs or budget,
// and never a budget value at all: the delegate only learns whether the person's own budget is set. Owner A.
import { Preferences } from "@tab/shared";
import * as z from "zod";

export const ConverseIntent = z.enum(["chat", "ask_about_others", "wants_status", "wants_out", "wants_change_budget", "other"]);
export type ConverseIntent = z.infer<typeof ConverseIntent>;

/** What the model returns. `reply` length is checked in code (600 = T_DELEGATE_REPLY's cap), not in the JSON schema. */
export const ConverseResult = z.strictObject({
  reply: z.string(),
  intent: ConverseIntent,
  confidence: z.enum(["high", "low"]),
});
export type ConverseResult = z.infer<typeof ConverseResult>;

export const ConverseInput = z.strictObject({
  user_first_name: z.string(),
  /**
   * chat = any free-form message; prefs_ack = they just answered the preferences question; budget_question = they
   * answered the first budget ask with a question, and code re-asks for the budget right after this reply.
   */
  mode: z.enum(["chat", "prefs_ack", "budget_question"]),
  message_text: z.string().max(2000), // this person's own inbound text only
  plan: z.strictObject({ title: z.string(), date: z.string(), start_time: z.string(), area: z.string() }).nullable(),
  is_organizer: z.boolean(),
  /** Public, name-free description of where the plan is and what happens next (code-written). */
  where_things_stand: z.string(),
  my_preferences: Preferences.nullable(),
  my_budget_set: z.boolean(),
  commands: z.array(z.string()),
  /** VOTING only: the public numbered picks (titles and times, no prices). */
  picks: z.array(z.string()),
  /**
   * Once the vote is decided (ORDERING onward): the group's winning pick, public venue facts only (names, addresses,
   * times; no prices). `booked` = the plan is CONFIRMED.
   */
  chosen_plan: z
    .strictObject({
      booked: z.boolean(),
      title: z.string(),
      dinner_name: z.string(),
      dinner_address: z.string(),
      dinner_time: z.string(),
      show_name: z.string(),
      show_address: z.string(),
      show_start: z.string(),
      show_end: z.string(),
    })
    .nullable(),
});
export type ConverseInput = z.infer<typeof ConverseInput>;

/**
 * What the model actually reads: ConverseInput rendered as plain sentences (converse.ts converseWire). Field names and
 * internal labels (mode, stage, chosen_plan, ...) never reach the model, so it has nothing machine-like to echo back.
 */
export type ConverseWire = { facts: string[]; message: string };

/** Implemented by AnthropicLLM. The mock LLM does not implement it, so LLM_MODE=mock keeps the template fallbacks. */
export interface DelegateConverser {
  converse(i: ConverseInput): Promise<ConverseResult | null>;
}

export function asConverser(llm: unknown): DelegateConverser | null {
  return typeof (llm as Partial<DelegateConverser> | null)?.converse === "function" ? (llm as DelegateConverser) : null;
}
