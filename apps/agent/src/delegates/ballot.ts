// Free-text ballot delegate (A plan T8). Constraints are evaluated in code by B's resolveApprovals. Owner A.
import type { InboundEvent } from "@tab/shared";
import { notify, replyKey, tplKey } from "../notify/notify";
import { publicShortlist, recordBallot } from "../plan/ballots";
import { ports } from "../ports";
import type { MemberContext } from "../repo/types";
import { maybeUpdatePrefs } from "./latePrefs";
import { converseReply, mentionsOthersBudget, otherFirstNames, sendOnlyYours } from "./free";
import { buildDelegateInput, emitDelegateXray } from "./input";

/**
 * VOTING free text: parseBallot(input, publicShortlist). ask_about_others → T_ONLY_YOURS (replyTo);
 * intent "other" (not a vote: "thanks", "when does voting close?") → the private delegate's natural reply (free.ts);
 * low confidence, or no usable delegate reply → T_BALLOT_CLARIFY once per version, then T_HELP; otherwise
 * plan/ballots.recordBallot(ctx, parse, "delegate", e) (none_of_these → empty approvals).
 */
export async function handleBallotText(ctx: MemberContext, e: InboundEvent): Promise<void> {
  const { user, plan } = ctx;
  const text = e.text ?? "";
  if (mentionsOthersBudget(text, await otherFirstNames(ctx))) {
    await sendOnlyYours(user.id, plan.id, e);
    return;
  }
  void emitDelegateXray(ctx.participant.lane);
  const shortlist = await publicShortlist(plan.id, plan.version);
  const parse = await ports.llm.parseBallot(buildDelegateInput(user.first_name, "ballot", text), shortlist);

  if (parse.intent === "ask_about_others") {
    await sendOnlyYours(user.id, plan.id, e);
    return;
  }
  const decided = parse.none_of_these || parse.approvals.length > 0 || parse.constraints.length > 0;
  if (parse.confidence === "low" || parse.intent === "other" || !decided) {
    // A question about the picks that chooses none ("is 1 walkable from campus?") deserves an answer, not the
    // ballot menu, whichever label the parser gave it.
    const question = !decided && /\?\s*$/.test(text);
    // Not a vote at all ("actually no beef"): a food preference is stored and the picks recomputed.
    if (!decided && parse.intent === "other" && (await maybeUpdatePrefs(ctx, e))) return;
    if ((parse.intent === "other" || question) && (await converseReply(user, ctx, e, { shortlist }))) return;
    // The tplKey makes the clarification once-per-version: a second unclear reply comes back "duplicate" → T_HELP.
    const outcome = await notify(user.id, "T_BALLOT_CLARIFY", {}, { key: tplKey(plan.id, user.id, "T_BALLOT_CLARIFY", plan.version), planId: plan.id });
    if (outcome === "duplicate") await notify(user.id, "T_HELP", {}, { key: replyKey(e.message_id, 1), planId: plan.id });
    return;
  }
  await recordBallot(ctx, parse.none_of_these ? { ...parse, approvals: [] } : parse, "delegate", e);
}
