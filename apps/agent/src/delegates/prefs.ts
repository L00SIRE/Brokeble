// Preferences delegate (A plan T6). Owner A.
import { Preferences, type InboundEvent } from "@tab/shared";
import { notify, replyKey } from "../notify/notify";
import { onPrefsDone, setStage } from "../plan/membership";
import { ports } from "../ports";
import { countByStage } from "../repo/participants";
import { getPlan } from "../repo/plans";
import { EMPTY_PREFERENCES, upsertPreferences } from "../repo/preferences";
import type { MemberContext } from "../repo/types";
import { askDelegate, buildConverseInput, sendGuardedReply, whereThingsStand } from "./converse";
import { converseReply, mentionsOthersBudget, otherFirstNames, sendOnlyYours } from "./free";
import { buildDelegateInput, emitDelegateXray } from "./input";

/**
 * BUDGET_LOCKED text: parsePreferences(buildDelegateInput(…,"prefs",text)) → upsertPreferences (EMPTY_PREFERENCES on a
 * low-confidence result) → setStage PREFS_DONE → membership.onPrefsDone(planId, e.event_id) → acknowledgement.
 */
export async function handlePrefsText(ctx: MemberContext, e: InboundEvent): Promise<void> {
  void emitDelegateXray(ctx.participant.lane);
  const text = e.text ?? "";
  const parsed = Preferences.safeParse(await ports.llm.parsePreferences(buildDelegateInput(ctx.user.first_name, "prefs", text)));
  const prefs = parsed.success ? parsed.data : EMPTY_PREFERENCES;
  if (isEmptyPrefs(prefs) && /\?\s*$/.test(text)) {
    // A question ("who else is coming?"), not an answer: reply to it and ask again. Nothing is stored and the lane
    // stays BUDGET_LOCKED, so a question can never start research with this person's preferences blank.
    await converseReply(ctx.user, ctx, e);
    await notify(ctx.user.id, "T_PREFS_ASK", {}, { key: replyKey(e.message_id, 2), planId: ctx.plan.id });
    return;
  }
  await upsertPreferences(ctx.plan.id, ctx.user.id, prefs);
  await setStage(ctx.plan.id, ctx.user.id, "PREFS_DONE");
  await onPrefsDone(ctx.plan.id, e.event_id);
  await acknowledgePrefs(ctx, e);
}

/**
 * A natural, specific acknowledgement written by the person's own delegate (it sees the prefs just saved), then what
 * happens next. Runs after onPrefsDone so "what's next" reflects a research start this answer may have triggered.
 * Fallback (no converser, failed/unconfident call, blocked text): "Got it, noted!" + the code-written next step.
 */
async function acknowledgePrefs(ctx: MemberContext, e: InboundEvent): Promise<void> {
  const plan = (await getPlan(ctx.plan.id)) ?? ctx.plan;
  const now: MemberContext = { ...ctx, plan, participant: { ...ctx.participant, stage: "PREFS_DONE" } };
  const input = await buildConverseInput(ctx.user, now, e.text ?? "", "prefs_ack");
  const r = await askDelegate(input, ctx.participant.lane);
  if (r?.intent === "ask_about_others" && mentionsOthersBudget(e.text ?? "", await otherFirstNames(now))) {
    await sendOnlyYours(ctx.user.id, plan.id, e);
    return;
  }
  if (r && (await sendGuardedReply(ctx.user.id, plan.id, r.reply, e, input))) return;
  const next = whereThingsStand(plan, "PREFS_DONE", await countByStage(plan.id));
  await notify(ctx.user.id, "T_DELEGATE_REPLY", { text: `Got it, noted! ${next}` }, { key: replyKey(e.message_id, 1), planId: plan.id });
}

const isEmptyPrefs = (p: Preferences): boolean =>
  p.cuisines_like.length + p.cuisines_avoid.length + p.dietary.length + p.vibe.length + p.dealbreakers.length === 0 &&
  p.earliest_start === null && p.latest_end === null;
