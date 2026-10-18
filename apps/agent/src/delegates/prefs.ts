// Preferences delegate (A plan T6). Owner A.
import { Preferences, type InboundEvent } from "@tab/shared";
import { onPrefsDone, setStage } from "../plan/membership";
import { ports } from "../ports";
import { EMPTY_PREFERENCES, upsertPreferences } from "../repo/preferences";
import type { MemberContext } from "../repo/types";
import { buildDelegateInput, emitDelegateXray } from "./input";

/**
 * BUDGET_LOCKED text: parsePreferences(buildDelegateInput(…,"prefs",text)) → upsertPreferences (EMPTY_PREFERENCES on a
 * low-confidence result) → setStage PREFS_DONE → membership.onPrefsDone(planId, e.event_id).
 */
export async function handlePrefsText(ctx: MemberContext, e: InboundEvent): Promise<void> {
  void emitDelegateXray(ctx.participant.lane);
  const parsed = Preferences.safeParse(await ports.llm.parsePreferences(buildDelegateInput(ctx.user.first_name, "prefs", e.text ?? "")));
  await upsertPreferences(ctx.plan.id, ctx.user.id, parsed.success ? parsed.data : EMPTY_PREFERENCES);
  await setStage(ctx.plan.id, ctx.user.id, "PREFS_DONE");
  await onPrefsDone(ctx.plan.id, e.event_id);
}
