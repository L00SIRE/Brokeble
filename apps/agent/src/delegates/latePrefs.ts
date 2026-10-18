// Preferences stated after the prefs answer ("actually no beef", "I want chicken tenders"). Owner A.
// Detection reuses parsePreferences (a non-empty parse is an update); the merge touches only the sender's own row.
import { Preferences, type InboundEvent } from "@tab/shared";
import { researchReady } from "../creao/research";
import { enqueue } from "../dueJobs";
import { A_JOB_KINDS, aJobKeys } from "../jobs/kinds";
import { notify, replyKey } from "../notify/notify";
import { stageAtLeast } from "../plan/machine";
import { ports } from "../ports";
import { EMPTY_PREFERENCES, getPreferences, upsertPreferences } from "../repo/preferences";
import type { MemberContext } from "../repo/types";
import { buildDelegateInput, emitDelegateXray } from "./input";

export const isEmptyPrefs = (p: Preferences): boolean =>
  p.cuisines_like.length + p.cuisines_avoid.length + p.dietary.length + p.vibe.length + p.dealbreakers.length === 0 &&
  p.earliest_start === null && p.latest_end === null;

const norm = (s: string) => s.trim().toLowerCase();

/** Union keeping the newest `max` entries (case-insensitive dedupe; `drop` entries are removed from the old side). */
function union(old: readonly string[], add: readonly string[], max: number, drop: readonly string[] = []): string[] {
  const dropped = new Set(drop.map(norm));
  const out: string[] = [];
  for (const s of [...old.filter((x) => !dropped.has(norm(x))), ...add]) {
    const i = out.findIndex((x) => norm(x) === norm(s));
    if (i >= 0) out.splice(i, 1);
    out.push(s);
  }
  return out.slice(-max);
}

/**
 * Newer statements win: lists are unions (capped to the Preferences maxima, newest kept), a newly avoided food leaves
 * cuisines_like and a newly liked one leaves cuisines_avoid, and a stated earliest/latest time overrides.
 */
export function mergePreferences(old: Preferences, add: Preferences): Preferences {
  return Preferences.parse({
    cuisines_like: union(old.cuisines_like, add.cuisines_like, 5, add.cuisines_avoid),
    cuisines_avoid: union(old.cuisines_avoid, add.cuisines_avoid, 5, add.cuisines_like),
    dietary: [...new Set([...old.dietary, ...add.dietary])],
    vibe: union(old.vibe, add.vibe, 3),
    earliest_start: add.earliest_start ?? old.earliest_start,
    latest_end: add.latest_end ?? old.latest_end,
    dealbreakers: union(old.dealbreakers, add.dealbreakers, 3),
  });
}

/** Plan states in which a changed preference can still change what the group sees. Never ORDERING onward. */
const OPEN: readonly string[] = ["COLLECTING", "RESEARCHING", "VOTING"];

/**
 * A member past their prefs answer states a food preference: merge it into their own stored preferences, queue a
 * recompute when picks are being (or have been) built, and confirm with the fixed T_PREFS_UPDATED. Returns false (the
 * caller continues with its normal handling) for questions, texts with no preference in them, the wrong stage or state.
 */
export async function maybeUpdatePrefs(ctx: MemberContext, e: InboundEvent): Promise<boolean> {
  const { user, plan, participant } = ctx;
  const text = e.text ?? "";
  if (!OPEN.includes(plan.state) || !stageAtLeast(participant.stage, "PREFS_DONE") || /\?\s*$/.test(text.trim())) return false;
  void emitDelegateXray(participant.lane);
  const parsed = Preferences.safeParse(await ports.llm.parsePreferences(buildDelegateInput(user.first_name, "prefs", text)));
  if (!parsed.success || isEmptyPrefs(parsed.data)) return false;

  const merged = mergePreferences((await getPreferences(plan.id, user.id)) ?? EMPTY_PREFERENCES, parsed.data);
  await upsertPreferences(plan.id, user.id, merged);
  // RESEARCHING with options still arriving: the recompute that options-ready queues reads these prefs, and an early
  // one would find no bundles and cancel the plan.
  if (plan.state === "VOTING" || (plan.state === "RESEARCHING" && (await researchReady(plan.id)))) {
    await enqueue(A_JOB_KINDS.recompute, aJobKeys.recompute(plan.id, e.event_id), new Date(), {}, { planId: plan.id });
  }
  await notify(user.id, "T_PREFS_UPDATED", {}, { key: replyKey(e.message_id, 1), planId: plan.id });
  return true;
}
