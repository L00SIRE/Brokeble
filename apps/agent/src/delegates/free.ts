// Everything else: T_ONLY_YOURS for questions about others, else T_HELP (A plan T6). Owner A.
import type { InboundEvent } from "@tab/shared";
import { notify, replyKey } from "../notify/notify";
import { ports } from "../ports";
import { listMembers } from "../repo/participants";
import type { MemberContext, UserRow } from "../repo/types";
import { buildDelegateInput, emitDelegateXray } from "./input";

const MONEY = /budget|afford|spend|\bmax\b/i;
// Group words stand in for names ("what can everyone afford?"); a wrong hit only costs a privacy reminder.
const GROUP = /\b(everyone|everybody|others|the group|anyone else)\b/i;
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Code fallback, always on (the only path in LLM_MODE=mock): a money word AND another participant's
 * first name (word match, case-insensitive). Runs in code only; nothing is logged.
 */
export function mentionsOthersBudget(text: string, otherFirstNames: readonly string[]): boolean {
  let rest = text;
  let named = false;
  for (const n of otherFirstNames) {
    const name = n.trim();
    if (!name) continue;
    const re = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(name)}(?=$|[^\\p{L}\\p{N}])`, "giu");
    const stripped = rest.replace(re, "$1");
    if (stripped !== rest) named = true;
    rest = stripped;
  }
  // Money words are matched with the names removed, so a friend called Max ("is Max coming?") is not a budget question.
  return MONEY.test(rest) && (named || GROUP.test(rest));
}

/** First names of everyone else in the plan (any stage): a declined friend's budget is still not yours to know. */
export async function otherFirstNames(ctx: MemberContext): Promise<string[]> {
  const members = await listMembers(ctx.plan.id, { active: false });
  return members.filter((m) => m.user_id !== ctx.user.id).map((m) => m.first_name);
}

/** T_ONLY_YOURS threaded under the question. */
export function sendOnlyYours(userId: string, planId: string | undefined, e: InboundEvent) {
  return notify(userId, "T_ONLY_YOURS", {}, { key: replyKey(e.message_id, 1), planId, replyTo: e.message_id });
}

/** parseBallot({…stage:"free"}, []) intent ask_about_others OR mentionsOthersBudget → T_ONLY_YOURS (replyTo), else T_HELP. */
export async function handleFreeText(user: UserRow, ctx: MemberContext | null, e: InboundEvent): Promise<void> {
  const text = e.text ?? "";
  const planId = ctx?.plan.id;
  // Code check first: deterministic, free, and works with no LLM at all.
  if (ctx && mentionsOthersBudget(text, await otherFirstNames(ctx))) {
    await sendOnlyYours(user.id, planId, e);
    return;
  }
  if (ctx) void emitDelegateXray(ctx.participant.lane);
  const parse = await ports.llm.parseBallot(buildDelegateInput(user.first_name, "free", text), []);
  if (parse.intent === "ask_about_others") {
    await sendOnlyYours(user.id, planId, e);
    return;
  }
  await notify(user.id, "T_HELP", {}, { key: replyKey(e.message_id, 1), planId });
}
