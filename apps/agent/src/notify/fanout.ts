// Group fan-out: the same template to every recipient, each through notify() with a per-user tplKey. Owner A.
// Fan-out templates also emit xray {name:"fanout", locked:false, preview: rendered text for the lowest lane}.
// Personal templates (budget, hold, pay link, receipts) never reach the X-ray or logs, and neither do pay URLs:
// this module logs counts only.
import type { TemplateId, TemplateVars } from "@tab/shared";
import { emit } from "../events";
import { errInfo, log } from "../log";
import { listRecipients } from "../repo/participants";
import type { MemberRow } from "../repo/types";
import { notify, tplKey, type NotifyOutcome } from "./notify";
import { render } from "./render";

/** Templates whose fan-out is previewed on the X-ray (A plan T5). */
export const XRAY_FANOUT_TEMPLATES: ReadonlySet<TemplateId> = new Set<TemplateId>([
  "T_PICKS", "T_PICKS_REFRESH", "T_VOTE_TALLY", "T_WINNER", "T_IN_COUNT", "T_CAPTURED", "T_CANCELLED", "T_PLAN_OFF", "T_NO_FIT",
]);

export type FanoutOptions = {
  /** Plan version for tplKey. */
  version: number;
  /** tplKey suffix (e.g. tally count k). */
  suffix?: string | number;
  /** Narrow the recipients (default: repo listRecipients = stage ∉ {DECLINED, INVITED}). */
  only?: (r: MemberRow) => boolean;
};

/**
 * Sends `id` to every recipient with `varsFor(recipient)`, key tplKey(planId, userId, id, version, suffix).
 * Emits the fan-out xray for XRAY_FANOUT_TEMPLATES. Resolves to the number of "sent" outcomes.
 * One member's failure never stops the others; every send is keyed, so re-running a fan-out is safe.
 */
export async function fanout<T extends TemplateId>(
  planId: string,
  id: T,
  varsFor: (r: MemberRow) => TemplateVars<T>,
  o: FanoutOptions,
): Promise<number> {
  const all = await listRecipients(planId);
  const recipients = (o.only ? all.filter(o.only) : all).sort((a, b) => a.lane - b.lane);
  if (recipients.length === 0) return 0;

  // Vars are built up front so a programming error throws before anyone gets a partial fan-out.
  const jobs = recipients.map((r) => ({ r, vars: varsFor(r) }));

  if (XRAY_FANOUT_TEMPLATES.has(id)) {
    try {
      await emit({ type: "xray", contexts: [{ name: "fanout", locked: false, preview: render(id, jobs[0]!.vars) }] });
    } catch (err) {
      log.warn({ template_id: id, plan_id: planId, ...errInfo(err) }, "fanout: xray emit failed");
    }
  }

  const results = await Promise.allSettled(
    jobs.map(({ r, vars }) => notify(r.user_id, id, vars, { key: tplKey(planId, r.user_id, id, o.version, o.suffix), planId })),
  );
  const counts: Record<NotifyOutcome | "error", number> = { sent: 0, duplicate: 0, blocked_inbound: 0, failed: 0, error: 0 };
  for (const res of results) {
    if (res.status === "fulfilled") counts[res.value]++;
    else {
      counts.error++;
      log.error({ template_id: id, plan_id: planId, ...errInfo(res.reason) }, "fanout: notify threw");
    }
  }
  log.info({ template_id: id, plan_id: planId, version: o.version, recipients: recipients.length, ...counts }, "fanout");
  return counts.sent;
}
