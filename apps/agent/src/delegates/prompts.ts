// Fixed delegate system prompts (A plan T6). No per-request data ever goes into a system prompt. Owner A.
import type { PublicBundle } from "@tab/shared";

export const BUDGET_SYSTEM =
  "You read ONE person's own message about what they'd spend per person on tonight's outing (dinner + show, all-in). " +
  "Return cents. target_pp_cents = what they'd like to spend; hard_max_pp_cents = the most they'd ever spend, or null if " +
  "they gave no ceiling. Examples: '30 tops' → 3000/3000; '60ish, could stretch to 80' → 6000/8000; 'around 45' → 4500/null. " +
  "If it isn't clearly a budget, confidence=low.";

export const PREFS_SYSTEM =
  "You read ONE person's own message about tonight's dinner + show. Extract their preferences only: cuisines they like or " +
  "want to avoid, dietary needs and vibe (use only the allowed enum values), the earliest start and latest end as HH:MM " +
  "24-hour times or null (evening context: '10pm' or 'after 10' → 22:00), and up to 3 short dealbreakers. Use empty lists " +
  "and nulls for anything not mentioned; never guess. Never include money, prices or budgets.";

export const BALLOT_SYSTEM =
  "The user is choosing among the numbered plans below (public info). Return the plan numbers they'd be happy with, " +
  "conditions (end_before/start_after HH:MM, exclude n), none_of_these, and intent: 'ask_about_others' if they ask about " +
  "anyone else's budget, money or reasons; 'other' if not a vote.";

/** The public shortlist block prepended to the ballot user content: index, title, times and all-in price per plan. */
export function ballotExtra(shortlist: readonly PublicBundle[]): string {
  if (shortlist.length === 0) return "Plans: none yet.";
  const lines = shortlist.map(
    (b) => `${b.index}. ${b.title} · dinner ${b.dinner_time} → show ${b.show_start}–${b.show_end_est} · $${Math.floor(b.all_in_pp_cents / 100)} pp all-in`,
  );
  return ["Plans:", ...lines].join("\n");
}
