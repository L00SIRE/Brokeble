// P3/P4: every user-facing message is a fixed template. Copy is owned by A; PLAN §8 copy is used verbatim
// (money/privacy copy is final). Vars are display-ready strings: callers format money/dates before rendering.
import * as z from "zod";

export const TemplateId = z.enum([
  "T_JOIN_WELCOME",
  "T_BUDGET_ASK",
  "T_BUDGET_CONFIRM",
  "T_BUDGET_TIERS",
  "T_PREFS_ASK",
  "T_STILL_LOOKING",
  "T_PICKS",
  "T_PICKS_REFRESH",
  "T_VOTE_TALLY",
  "T_WINNER",
  "T_HOLD_GATE",
  "T_PAY_LINK",
  "T_HELD",
  "T_IN_COUNT",
  "T_REPING",
  "T_CAPTURED",
  "T_CANCELLED",
  "T_NO_FIT",
  "T_ONLY_YOURS",
  "T_CARD_INTERCEPT",
  "T_DECLINED_RETRY",
  "T_ITINERARY",
  "T_ORG_JOIN_STATUS",
]);
export type TemplateId = z.infer<typeof TemplateId>;

export const COPY = {
  T_JOIN_WELCOME: "You're in for {title}, {date}. A couple of quick questions, and what you tell me here stays between us.",
  T_BUDGET_ASK:
    "What's the most you'd spend per person tonight, all-in? Just between us: nobody in the group, and no other agent, ever sees it.",
  T_BUDGET_CONFIRM: "Just between us: aim ~${target}, never over ${max}. Text 'change budget' anytime.",
  T_BUDGET_TIERS: "No problem. Reply 1 (under $25), 2 ($25–50), 3 ($50–80) or 4 (no cap).",
  T_PREFS_ASK: "Anything you're craving, can't eat, or want to avoid tonight?",
  T_STILL_LOOKING: "Still looking. Checking what's actually open and on tonight.",
  T_PICKS:
    "3 plans that work for everyone:\n{lines}\nReply with the numbers you'd be happy with (like '1 3'), or tell me in your own words.",
  T_PICKS_REFRESH: "The group changed, so here are fresh picks that work for everyone:\n{lines}",
  T_VOTE_TALLY: "{k} of {n} voted.",
  T_WINNER: "It's {title}. Your hold link is coming. Nobody's charged unless everyone's in.",
  T_HOLD_GATE:
    "Just between us: your share would be ${amount}, above the max you gave me. Reply YES to hold it anyway, or NO to sit this one out.",
  T_PAY_LINK:
    "Your share for {title}: ${amount}. It's a hold, charged only if everyone's in by {deadline}; otherwise it's released. {url}",
  T_HELD: "Held ${amount} on {brand} ••{last4}. Not charged yet.",
  T_IN_COUNT: "{k} of {n} are in.",
  T_REPING: "Still need your hold for {title} by {deadline}: {url}",
  T_CAPTURED: "Everyone's in. You're booked for {title}. Charged ${amount}.",
  T_CANCELLED: "Plan cancelled. Nobody was charged; your pending authorization was released.",
  T_NO_FIT: "I couldn't find a plan that works for everyone this time. Want to try another night or area?",
  T_ONLY_YOURS: "I only know yours. Everyone's budget stays between them and me.",
  T_CARD_INTERCEPT: "Please don't text card numbers. I didn't keep it. You'll get a secure pay page when it's time.",
  T_DECLINED_RETRY: "That card didn't go through (only you see this). Try again: {url}",
  T_ITINERARY: "Your night, planned: {itinerary_url} · Add to calendar: {ics_url}",
  T_ORG_JOIN_STATUS: "{k} of {n} joined. Reply GO to plan with {k}, or WAIT.",
} as const satisfies Record<TemplateId, string>;

const s = z.string().min(1);
const count = z.number().int().nonnegative();
const none = z.strictObject({});

export const VARS = {
  T_JOIN_WELCOME: z.strictObject({ title: s, date: s }),
  T_BUDGET_ASK: none,
  T_BUDGET_CONFIRM: z.strictObject({ target: s, max: s }),
  T_BUDGET_TIERS: none,
  T_PREFS_ASK: none,
  T_STILL_LOOKING: none,
  T_PICKS: z.strictObject({ lines: s }),
  T_PICKS_REFRESH: z.strictObject({ lines: s }),
  T_VOTE_TALLY: z.strictObject({ k: count, n: count }),
  T_WINNER: z.strictObject({ title: s }),
  T_HOLD_GATE: z.strictObject({ amount: s }),
  T_PAY_LINK: z.strictObject({ title: s, amount: s, deadline: s, url: z.url() }),
  T_HELD: z.strictObject({ amount: s, brand: s, last4: z.string().regex(/^\d{4}$/) }),
  T_IN_COUNT: z.strictObject({ k: count, n: count }),
  T_REPING: z.strictObject({ title: s, deadline: s, url: z.url() }),
  T_CAPTURED: z.strictObject({ title: s, amount: s }),
  T_CANCELLED: none,
  T_NO_FIT: none,
  T_ONLY_YOURS: none,
  T_CARD_INTERCEPT: none,
  T_DECLINED_RETRY: z.strictObject({ url: z.url() }),
  T_ITINERARY: z.strictObject({ itinerary_url: z.url(), ics_url: z.url() }),
  T_ORG_JOIN_STATUS: z.strictObject({ k: count, n: count }),
} as const satisfies Record<TemplateId, z.ZodObject>;

export type TemplateVars<T extends TemplateId> = z.infer<(typeof VARS)[T]>;
