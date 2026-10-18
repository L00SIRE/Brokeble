// Everything else goes to the person's private delegate (natural reply); T_ONLY_YOURS for questions about others;
// T_HELP when no generated reply is usable (A plan T6). Owner A.
import type { InboundEvent, PublicBundle } from "@tab/shared";
import { notify, replyKey } from "../notify/notify";
import { stageAtLeast } from "../plan/machine";
import { ports } from "../ports";
import { listMembers } from "../repo/participants";
import type { MemberContext, UserRow } from "../repo/types";
import { handleCommand } from "../router/handlers";
import { handleBudgetText } from "./budget";
import { askDelegate, buildConverseInput, sendGuardedReply } from "./converse";
import { asConverser } from "./converseSchema";
import { buildDelegateInput, emitDelegateXray } from "./input";

const MONEY = /budget|afford|spend|\bmax\b/i;
// Group words stand in for names ("what can everyone afford?"); a wrong hit only costs a privacy reminder.
const GROUP = /\b(everyone|everybody|others|the group|anyone else)\b/i;
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// A question about someone else that touches money gets the fixed privacy template; any other question about the
// group ("who else is coming?") gets the guarded generated reply, which knows nothing about other members anyway.
const MONEYISH = /budget|afford|spend|\bmax\b|money|broke|cheap|expensive|pric|cost|\bpay|cash|\$/i;

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

/** Text that steers a would-be "I'm out" to the deterministic command: an LLM guess never removes anyone from a plan. */
export const OUT_HINT = "No worries if plans changed. Just text \"I'm out\" and I'll take you off this one. Nobody's told why.";

/**
 * Everything that isn't a command, budget, prefs or ballot answer. The code check for another member's budget runs
 * first (deterministic, no LLM). Then the person's private delegate (converse.ts) writes a natural reply:
 * ask_about_others → T_ONLY_YOURS when it touches money, else the guarded reply; wants_change_budget → parse a stated
 * number now, else the change-budget command; wants_out → OUT_HINT (the user
 * still has to text the command); otherwise the guarded generated reply (wants_status falls back to T_STATUS).
 * No converser (LLM_MODE=mock), a failed or unconfident call, or a blocked reply → T_HELP.
 */
export async function handleFreeText(user: UserRow, ctx: MemberContext | null, e: InboundEvent): Promise<void> {
  const text = e.text ?? "";
  const planId = ctx?.plan.id;
  if (ctx && mentionsOthersBudget(text, await otherFirstNames(ctx))) {
    await sendOnlyYours(user.id, planId, e);
    return;
  }
  if (await converseReply(user, ctx, e)) return;
  if (!asConverser(ports.llm)) {
    // Template-only path (LLM_MODE=mock): the ballot parser still recognizes questions about other people.
    if (ctx) void emitDelegateXray(ctx.participant.lane);
    const parse = await ports.llm.parseBallot(buildDelegateInput(user.first_name, "free", text), []);
    if (parse.intent === "ask_about_others") {
      await sendOnlyYours(user.id, planId, e);
      return;
    }
  }
  await notify(user.id, "T_HELP", {}, { key: replyKey(e.message_id, 1), planId });
}

/**
 * The delegate's reply with intent dispatch. Returns false (caller sends its own fallback) when there is no usable
 * reply: no converser, a failed/unconfident call, or a generated text the guard blocked. `shortlist` = public picks
 * while voting is open.
 */
export async function converseReply(user: UserRow, ctx: MemberContext | null, e: InboundEvent, o: { shortlist?: readonly PublicBundle[] } = {}): Promise<boolean> {
  if (!asConverser(ports.llm)) return false;
  const planId = ctx?.plan.id;
  const input = await buildConverseInput(user, ctx, e.text ?? "", "chat", o);
  const r = await askDelegate(input, ctx?.participant.lane ?? null);
  if (!r) return false;
  const text = e.text ?? "";
  switch (r.intent) {
    case "ask_about_others":
      if (MONEYISH.test(text)) {
        await sendOnlyYours(user.id, planId, e);
        return true;
      }
      return sendGuardedReply(user.id, planId, r.reply, e, input);
    case "wants_change_budget":
      // "change my budget to 300 max": parse this same message instead of asking again for the number.
      if (ctx && /\d/.test(text) && canChangeBudget(ctx)) await handleBudgetText(ctx, e);
      else await handleCommand(user, ctx, { kind: "change_budget" }, e);
      return true;
    case "wants_out":
      await notify(user.id, "T_DELEGATE_REPLY", { text: OUT_HINT }, { key: replyKey(e.message_id, 1), ...(planId ? { planId } : {}) });
      return true;
    case "wants_status":
      if (await sendGuardedReply(user.id, planId, r.reply, e, input)) return true;
      await handleCommand(user, ctx, { kind: "status" }, e);
      return true;
    default:
      return sendGuardedReply(user.id, planId, r.reply, e, input);
  }
}

/** Same window as the 'change budget' command (router/handlers.ts changeBudget): from JOINED until the member is HELD. */
function canChangeBudget({ plan, participant }: MemberContext): boolean {
  return stageAtLeast(participant.stage, "JOINED") && !stageAtLeast(participant.stage, "HELD") && ["COLLECTING", "RESEARCHING", "VOTING", "ORDERING", "APPROVING"].includes(plan.state);
}
