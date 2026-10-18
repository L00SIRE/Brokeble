// holdGate (M7; P1 allowlist): a share above a member's effective hard max is never linked without their private YES.
// Import as a namespace: `import * as holdGate from "../money/holdGate"`. Owner A.
// Never log or emit amounts/limits/pay URLs here; the max is revealed to nobody but that member (and only as "above").
import type { InboundEvent } from "@tab/shared";
import { effectiveHardMax } from "../decide/filter";
import { clearAwaiting, setAwaiting } from "../delegates/awaiting";
import { log } from "../log";
import { fmtDeadline, usd2 } from "../notify/render";
import { notify, tplKey } from "../notify/notify";
import { setStage, onOut } from "../plan/membership";
import * as holdGates from "../repo/holdGates";
import * as payLinks from "../repo/payLinks";
import * as privateConstraints from "../repo/privateConstraints";
import type { MemberContext } from "../repo/types";

export type GateDecision = "link" | "ask";

/**
 * No constraints, or amount ≤ effectiveHardMax(c) → "link". Otherwise insert a pending hold_gates row
 * (on conflict do nothing) and return "ask". Never reveals the max to anyone but that member.
 */
export async function check(planId: string, userId: string, planVersion: number, amountCents: number): Promise<GateDecision> {
  const c = await privateConstraints.get(planId, userId);
  if (!c || amountCents <= effectiveHardMax(c)) return "link";
  await holdGates.insertPendingHoldGate(planId, userId, planVersion, amountCents);
  return "ask";
}

/**
 * Re-run after "change budget" while APPROVING and the member is not HELD: uses the stored pay link amount;
 * "ask" → T_HOLD_GATE {amount: usd2} (key suffix amount_cents), stage GATED, awaiting 'holdgate'.
 */
export async function recheck(ctx: MemberContext): Promise<void> {
  const { user, plan, participant } = ctx;
  if (plan.state !== "APPROVING" || (participant.stage !== "GATED" && participant.stage !== "LINK_SENT")) return;
  const link = await payLinks.getPayLink(plan.id, user.id, plan.version);
  if (!link) return;

  const decision = await check(plan.id, user.id, plan.version, link.amount_cents);
  const gate = await holdGates.getHoldGate(plan.id, user.id, plan.version);

  if (decision === "link") {
    // Budget raised above the share: a still-pending ask is moot. Close it, then hand over the link.
    if (participant.stage === "GATED") {
      if (gate?.status === "pending") await holdGates.answerHoldGate(plan.id, user.id, plan.version, "approved");
      await sendLink(ctx, link, "raised");
    }
    return;
  }

  // An approved (or declined) gate for this exact share stays final: their YES already covers it.
  if (gate && gate.status !== "pending") return;
  await notify(user.id, "T_HOLD_GATE", { amount: usd2(link.amount_cents) }, {
    key: tplKey(plan.id, user.id, "T_HOLD_GATE", plan.version, link.amount_cents), planId: plan.id,
  });
  await setStage(plan.id, user.id, "GATED", { amountCents: link.amount_cents });
  setAwaiting(user.id, "holdgate");
}

/** YES → answerHoldGate approved → T_PAY_LINK with the stored URL, stage LINK_SENT. NO → declined → membership.onOut(…,"holdgate_no"). */
export async function answer(ctx: MemberContext, yes: boolean, e: InboundEvent): Promise<void> {
  const { user, plan, participant } = ctx;
  const gate = await holdGates.getHoldGate(plan.id, user.id, plan.version);
  // Stale or repeated reply (plan moved on, gate already answered and delivered): nothing to do.
  const retryDelivery = yes && gate?.status === "approved" && participant.stage === "GATED";
  if (!gate || plan.state !== "APPROVING" || (gate.status !== "pending" && !retryDelivery)) {
    clearAwaiting(user.id);
    return;
  }

  if (!yes) {
    if (!(await holdGates.answerHoldGate(plan.id, user.id, plan.version, "declined"))) return;
    clearAwaiting(user.id);
    await onOut(ctx, e, "holdgate_no");
    return;
  }

  const link = await payLinks.getPayLink(plan.id, user.id, plan.version);
  if (!link) {
    // Leave the gate pending so a retry can still succeed once the link exists.
    log.error({ plan_id: plan.id, user_id: user.id }, "holdGate YES without a stored pay link");
    return;
  }
  if (gate.status === "pending" && !(await holdGates.answerHoldGate(plan.id, user.id, plan.version, "approved"))) return;
  await sendLink(ctx, link, "yes", e);
}

/** Delivers the stored link; the stage and awaiting flag move only once Photon has it, so a failed send can be retried by replying again. */
async function sendLink(ctx: MemberContext, link: { amount_cents: number; pay_url: string; expires_at: Date }, suffix: string, e?: InboundEvent): Promise<void> {
  const { user, plan } = ctx;
  const outcome = await notify(
    user.id,
    "T_PAY_LINK",
    { title: plan.title, amount: usd2(link.amount_cents), deadline: fmtDeadline(plan.deadlines.approve_at ?? link.expires_at), url: link.pay_url },
    { key: tplKey(plan.id, user.id, "T_PAY_LINK", plan.version, suffix), planId: plan.id, ...(e ? { replyTo: e.message_id } : {}) },
  );
  if (outcome !== "sent" && outcome !== "duplicate") return;
  clearAwaiting(user.id);
  await setStage(plan.id, user.id, "LINK_SENT", { amountCents: link.amount_cents });
}
