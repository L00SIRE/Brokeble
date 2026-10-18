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
  // A-additive (A plan §3.3 / T5)
  "T_HELP",
  "T_STATUS",
  "T_OUT_ACK",
  "T_RECEIPTS",
  "T_FORGOTTEN",
  "T_ORGANIZER_ONLY",
  "T_BALLOT_CLARIFY",
  "T_BUDGET_CONFIRM_NOCAP",
  "T_SMALL_GROUP",
  "T_NOT_IN_PLAN",
  "T_CARD_REMOVED",
  // B C-4 voice recaps (copy by A): a call never moves money, so each recap points back to a text action.
  "T_VOICE_RECAP_IN",
  "T_VOICE_RECAP_OUT",
  "T_VOICE_RECAP_LATER",
  // Free-form reply written by the person's private delegate (LLM over their own data only). Never money/privacy-critical.
  "T_DELEGATE_REPLY",
  // A-additive after the 11 PM freeze (additive only): accurate copy where the older templates over-promised.
  "T_BUDGET_REASK", // 'change budget' mid-plan (T_BUDGET_ASK opens with "First up:")
  "T_PLAN_OFF", // cancelled before any pay link existed (T_CANCELLED mentions a released authorization)
  "T_HOLD_RELEASED_RETRY", // a hold that timed out and was reversed (the card itself was fine)
  "T_PLAN_FULL", // JOIN text when 8 lanes are already confirmed (the venue caps party_size at 8)
  // Chat-first start and join (docs/design/ux-flow.md §8.5): the organizer plans in chat, a blank name is asked once.
  "T_START_HELLO",
  "T_START_ASK_AREA",
  "T_START_ASK_COUNT",
  "T_START_ASK_BOTH",
  "T_PLAN_READY",
  "T_JOIN_WELCOME_NAME",
  "T_BUDGET_ASK_NAMED",
  "T_ALREADY_IN_PLAN", // the /start pre-fill from someone still in an open plan: offer 'new plan' or 'status'
  "T_PREFS_UPDATED", // a food preference stated after the prefs answer was merged into the member's own prefs
  "T_BUDGET_TOO_LOW", // private: the cheapest plan found is over this member's max; only that member is told
  "T_OUT_TOO_LATE", // 'I'm out' after everyone held and the booking went through: nothing can be undone by text
]);
export type TemplateId = z.infer<typeof TemplateId>;

export const COPY = {
  T_JOIN_WELCOME: "Hey, you're in for {title}, {date}! Two quick questions and I'll get planning. Whatever you tell me stays between us.",
  T_BUDGET_ASK:
    "First up: what's the most you'd want to spend tonight on dinner + show tickets, all-in per person (tax and tip included)? Most nights land around $50–80. Totally private. Nobody in the group, and no other agent, ever sees it.",
  T_BUDGET_CONFIRM: "Got it. Just between us: aim ~${target}, never over ${max}. Text 'change budget' anytime.",
  T_BUDGET_TIERS: "No worries, pick whichever fits: 1 (under $50), 2 ($50–80), 3 ($80–120) or 4 (no cap). That's per person for dinner + show tickets, all-in.",
  T_PREFS_ASK: "Last one: anything you're craving, can't eat, or want to steer clear of tonight?",
  T_STILL_LOOKING: "Still on it! Checking what's actually open and fun tonight.",
  T_PICKS:
    "Okay, found 3 plans that work for everyone:\n{lines}\nTell me which ones you'd be happy with (like '1 3'), or just say it in your own words.",
  T_PICKS_REFRESH: "The group shifted, so I reshuffled. Fresh picks that still work for everyone:\n{lines}",
  T_VOTE_TALLY: "{k} of {n} have voted so far.",
  T_WINNER: "We have a winner: {title}! Your hold link is on its way. Nobody's charged unless everyone's in.",
  T_HOLD_GATE:
    "Just between us: your share would be ${amount}, which is over the max you gave me. Reply YES to hold it anyway, or NO to sit this one out.",
  T_PAY_LINK:
    "Here's your share for {title}: ${amount}. It's only a hold, and it turns into a charge only if everyone's in by {deadline}. Otherwise it's released. {url}",
  T_HELD: "All set, I'm holding ${amount} on your {brand} ••{last4}. Not charged yet.",
  T_IN_COUNT: "{k} of {n} are in!",
  T_REPING: "Quick nudge: I still need your hold for {title} by {deadline}. {url}",
  T_CAPTURED: "Everyone's in, so you're booked for {title}! Charged ${amount}.",
  T_CANCELLED: "Plan's off. Nobody was charged; your pending authorization was released.",
  T_NO_FIT: "Hmm, I couldn't find a plan that works for everyone this time. Want to try another night or area?",
  T_ONLY_YOURS: "I only know yours. Everyone's budget stays between them and me.",
  T_CARD_INTERCEPT: "Whoa, please don't text card numbers! I didn't keep it. You'll get a secure pay page when it's time.",
  T_DECLINED_RETRY: "Ah, that card didn't go through (only you see this). Mind trying again? {url}",
  T_ITINERARY: "Your night, all planned: {itinerary_url} · Add it to your calendar: {ics_url}",
  T_ORG_JOIN_STATUS: "{k} of {n} have joined. Reply GO to plan with the {k} of you, or WAIT for the rest.",
  T_HELP: "I'm here to plan tonight with you. Text 'status' to see where we're at, or 'I'm out' if plans change. Your budget stays between us.",
  T_STATUS: "{title}: {phase}.",
  T_OUT_ACK: "No problem, you're out of {title}. Nobody's told why.",
  T_RECEIPTS: "Here are your bookings:\n{lines}",
  T_FORGOTTEN: "Done. I deleted your budget, preferences and votes.",
  T_ORGANIZER_ONLY: "That one's for the organizer, sorry!",
  T_BALLOT_CLARIFY: "Which ones would you be happy with? Just send the numbers, like '1 3'.",
  T_BUDGET_CONFIRM_NOCAP: "Got it. Just between us: no hard cap. Text 'change budget' anytime.",
  T_SMALL_GROUP: "Heads up: with fewer than 3 of us, it's easier to guess each other's limits. Reply GO again if you're still good to continue.",
  T_NOT_IN_PLAN: "You're not in a plan right now. Want to start one? Tell me where and how many of you.",
  T_CARD_REMOVED: "Done. Your saved card is removed from the venue.",
  T_VOICE_RECAP_IN:
    "Great chatting! Tap the hold link I sent to lock in {title}. Nobody's charged unless everyone's in by {deadline}.",
  T_VOICE_RECAP_OUT: "Thanks for the call! If you're sitting this one out, just text 'I'm out'. Nobody's told why.",
  T_VOICE_RECAP_LATER: "Thanks for the call! No rush, your hold link for {title} works until {deadline}.",
  T_DELEGATE_REPLY: "{text}",
  T_BUDGET_REASK: "Sure! What's the most you'd want to spend tonight on dinner + show tickets, all-in per person (tax and tip included)? Still just between us.",
  T_PLAN_OFF: "Plan's off. Nobody was charged.",
  T_HOLD_RELEASED_RETRY: "I couldn't confirm your hold, so I released it. Nothing was charged. Here's a fresh link: {url}",
  T_PLAN_FULL: "Sorry, this plan is already full (8 people max), so I can't add you. If a spot opens up, just text me again.",
  // No link in T_START_HELLO: it is the organizer's first reply (Photon deliverability rule).
  T_START_HELLO:
    "Hey! I'm SquadTab. I'll plan dinner and a show with your friends, keep everyone's budget private, and nobody fronts the bill. What should I call you, and where and when are we going? Like: \"Maya, Santa Monica tonight, 4 of us\"",
  T_START_ASK_AREA: "Sounds fun! Which neighborhood or city should I look in?",
  T_START_ASK_COUNT: "Got it. How many of you, counting you?",
  T_START_ASK_BOTH: "Sounds fun! Where should I look, and how many of you, counting you?",
  // The URL sits alone on the last line so a long-press copies it cleanly.
  T_PLAN_READY:
    "{greeting}: {title}, {date} from {time} in {area}, {n} of you. Send this link to your group chat and I'll take it from there:\n{url}",
  T_JOIN_WELCOME_NAME:
    "Hey, you're in for {title}, {date}! I'm SquadTab. A few quick questions and I'll get planning, and whatever you tell me stays between us. First, what should I call you?",
  T_BUDGET_ASK_NAMED:
    "Nice to meet you, {name}. Next: what's the most you'd want to spend tonight on dinner + show tickets, all-in per person (tax and tip included)? Most nights land around $50–80. Totally private. Nobody in the group, and no other agent, ever sees it.",
  T_ALREADY_IN_PLAN:
    "You're still in {title} ({ready} of {total} ready). Text 'new plan' to start fresh, or 'status' to keep going.",
  T_PREFS_UPDATED: "Got it, I'll factor that in.",
  T_BUDGET_TOO_LOW:
    "Heads up: the cheapest dinner + show I found tonight is ${price} all-in per person, a bit over the max you gave me. Text 'change budget' to raise it, or 'I'm out' to sit this one out. Nobody else sees your number.",
  T_OUT_TOO_LATE:
    "You're already booked for {title} and your share went through, so I can't take you off it now. If plans change, give your group a heads-up.",
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
  T_HELP: none,
  T_STATUS: z.strictObject({ title: s, phase: s }), // phase from a fixed code map; never names or budgets
  T_OUT_ACK: z.strictObject({ title: s }),
  T_RECEIPTS: z.strictObject({ lines: s }), // code-built lines, or "None yet."
  T_FORGOTTEN: none,
  T_ORGANIZER_ONLY: none,
  T_BALLOT_CLARIFY: none,
  T_BUDGET_CONFIRM_NOCAP: none,
  T_SMALL_GROUP: none,
  T_NOT_IN_PLAN: none,
  T_CARD_REMOVED: none,
  T_VOICE_RECAP_IN: z.strictObject({ title: s, deadline: s }),
  T_VOICE_RECAP_OUT: none,
  T_VOICE_RECAP_LATER: z.strictObject({ title: s, deadline: s }),
  T_DELEGATE_REPLY: z.strictObject({ text: z.string().min(1).max(600) }),
  T_BUDGET_REASK: none,
  T_PLAN_OFF: none,
  T_HOLD_RELEASED_RETRY: z.strictObject({ url: z.url() }),
  T_PLAN_FULL: none,
  T_START_HELLO: none,
  T_START_ASK_AREA: none,
  T_START_ASK_COUNT: none,
  T_START_ASK_BOTH: none,
  // greeting = "You're set, Maya" or "You're set": never empty, because render() rejects an empty variable.
  T_PLAN_READY: z.strictObject({ greeting: s, title: s, date: s, time: s, area: s, n: count, url: z.url() }),
  T_JOIN_WELCOME_NAME: z.strictObject({ title: s, date: s }),
  T_BUDGET_ASK_NAMED: z.strictObject({ name: s }),
  T_ALREADY_IN_PLAN: z.strictObject({ title: s, ready: count, total: count }),
  T_PREFS_UPDATED: none,
  T_BUDGET_TOO_LOW: z.strictObject({ price: s }), // the cheapest plan's price (public data), never the member's own or anyone's budget
  T_OUT_TOO_LATE: z.strictObject({ title: s }),
} as const satisfies Record<TemplateId, z.ZodObject>;

export type TemplateVars<T extends TemplateId> = z.infer<(typeof VARS)[T]>;
