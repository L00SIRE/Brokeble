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
import { sendOnlyYours } from "./free";
import { buildDelegateInput, emitDelegateXray } from "./input";

/**
 * BUDGET_LOCKED text: parsePreferences(buildDelegateInput(…,"prefs",text)) → upsertPreferences (EMPTY_PREFERENCES on a
 * low-confidence result) → setStage PREFS_DONE → membership.onPrefsDone(planId, e.event_id) → acknowledgement.
 */
export async function handlePrefsText(ctx: MemberContext, e: InboundEvent): Promise<void> {
  void emitDelegateXray(ctx.participant.lane);
  const parsed = Preferences.safeParse(await ports.llm.parsePreferences(buildDelegateInput(ctx.user.first_name, "prefs", e.text ?? "")));
  await upsertPreferences(ctx.plan.id, ctx.user.id, parsed.success ? parsed.data : EMPTY_PREFERENCES);
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
  const r = await askDelegate(await buildConverseInput(ctx.user, now, e.text ?? "", "prefs_ack"), ctx.participant.lane);
  if (r?.intent === "ask_about_others") {
    await sendOnlyYours(ctx.user.id, plan.id, e);
    return;
  }
  if (r && (await sendGuardedReply(ctx.user.id, plan.id, r.reply, e))) return;
  const next = whereThingsStand(plan, "PREFS_DONE", await countByStage(plan.id));
  await notify(ctx.user.id, "T_DELEGATE_REPLY", { text: `Got it, noted! ${next}` }, { key: replyKey(e.message_id, 1), planId: plan.id });
}
