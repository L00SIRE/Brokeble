// P3/P4: the ONLY caller of MessagingPort.sendText. Every user-facing message is a template (packages/shared
// templates.ts). Stores template_id only, never text (own-budget confirmations stay out of the DB). Owner A.
// Logs carry template_id/plan_id/problem code only: never the text, vars or pay URLs (P7).
import { VARS, type TemplateId, type TemplateVars } from "@tab/shared";
import { emit } from "../events";
import { errInfo, log } from "../log";
import { ports, type DmAddress } from "../ports";
import { problemAction, problemCode, retryAfterMs } from "../photon/errors";
import { getDmRoute } from "../repo/dmRoutes";
import { claimOutbound, markOutboundAccepted, markOutboundBlocked, markOutboundFailed, type OutboundClaim } from "../repo/outbound";
import { render } from "./render";

export type NotifyOptions = {
  /** From tplKey() or replyKey(); also the Photon idempotency-key. */
  key: string;
  planId?: string;
  /** Inbound message id to thread under (parentMessageId). */
  replyTo?: string;
};

/** sent = accepted by Photon; duplicate = key already accepted; blocked_inbound = no dm_route / user must text first. */
export type NotifyOutcome = "sent" | "duplicate" | "blocked_inbound" | "failed";

/**
 * Sends one template to one user: zod-parse vars → render → load dm_route (none → blocked_inbound, never a first
 * message) → claimOutbound(key) → sendText → markOutboundAccepted / markOutboundFailed(problemCode).
 * Never throws for Photon problems (returns "failed"); throws only on a vars/programming or DB error before the send.
 */
export async function notify<T extends TemplateId>(userId: string, id: T, vars: TemplateVars<T>, o: NotifyOptions): Promise<NotifyOutcome> {
  const text = renderChecked(id, vars);
  const claim: OutboundClaim = { idempotency_key: o.key, user_id: userId, plan_id: o.planId ?? null, template_id: id };
  const to = await getDmRoute(userId);
  if (!to) {
    await markOutboundBlocked(claim);
    log.info({ template_id: id, plan_id: claim.plan_id }, "notify: no dm route, not sending first");
    await warnNoRoute(userId, claim);
    return "blocked_inbound";
  }
  return deliver(to, text, claim, o.replyTo);
}

// (userId, planId) pairs already reported on the console. In memory: a restart re-warns once, which is fine.
const warnedNoRoute = new Set<string>();

/**
 * Once per member per plan, tells the operator console that a member's messages are being held because they never
 * texted SquadTab (shared lines cannot message first). Carries the template id only: no name, phone or text.
 */
async function warnNoRoute(userId: string, claim: OutboundClaim): Promise<void> {
  if (!claim.plan_id) return;
  const k = `${userId}:${claim.plan_id}`;
  if (warnedNoRoute.has(k)) return;
  warnedNoRoute.add(k);
  await quiet("notify.systemEvent", emit({ type: "system", level: "warn", msg: `A member hasn't texted SquadTab yet; ${claim.template_id} is held` }));
}

/** Unknown senders only (router step 4): replies to the inbound address directly; no user row, no plan. */
export async function notifyRaw(addr: DmAddress, id: "T_NOT_IN_PLAN", vars: TemplateVars<"T_NOT_IN_PLAN">, key: string): Promise<NotifyOutcome> {
  const text = renderChecked(id, vars);
  return deliver(addr, text, { idempotency_key: key, user_id: null, plan_id: null, template_id: id });
}

/**
 * Plan-driven key: `tpl:<planId>:<userId>:<templateId>:<version>[:<suffix>]`. Suffixes for templates sent more
 * than once per version: T_VOTE_TALLY/T_IN_COUNT `k`, T_REPING `1`, T_DECLINED_RETRY `<VenueEvent.event_id>`,
 * T_HOLD_GATE `<amount_cents>`.
 */
export function tplKey(planId: string, userId: string, templateId: TemplateId, version: number, suffix?: string | number): string {
  return `tpl:${planId}:${userId}:${templateId}:${version}${suffix === undefined ? "" : `:${suffix}`}`;
}

/** Direct-reply key: `reply:<inboundMessageId>:<n>` (n = 1, 2, … for multiple replies to one inbound). */
export function replyKey(inboundId: string, n: number): string {
  return `reply:${inboundId}:${n}`;
}

function renderChecked<T extends TemplateId>(id: T, vars: TemplateVars<T>): string {
  const parsed = VARS[id].safeParse(vars);
  // Report paths only: a ZodError message would echo the offending value (could be a pay URL or amount).
  if (!parsed.success) throw new Error(`notify ${id}: invalid vars at ${parsed.error.issues.map((i) => i.path.join(".") || "(root)").join(", ")}`);
  return render(id, parsed.data as TemplateVars<T>);
}

/** Longest wait before the single notify-level retry of a rate-limited send (keeps a handler well inside 45 s). */
const RATE_LIMIT_RETRY_MAX_MS = 5_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function deliver(to: DmAddress, text: string, claim: OutboundClaim, replyTo?: string): Promise<NotifyOutcome> {
  if (!(await claimOutbound(claim))) return "duplicate";
  const ctx = { template_id: claim.template_id, plan_id: claim.plan_id };
  const send = () => ports.messaging.sendText(to, text, { idempotencyKey: claim.idempotency_key, ...(replyTo ? { replyTo } : {}) });
  let messageId: string;
  try {
    ({ messageId } = await send());
  } catch (first) {
    // A 429 the SDK gave up on (Retry-After above its cap, or attempts used) gets one more try with the SAME key:
    // Photon replays a key it already accepted, so this can never duplicate a text. Transport errors and 5xx are not
    // retried here: the SDK already retried them, and another round could outlast the consumer's handler timeout.
    if (problemAction(problemCode(first)) !== "rate_limited") return onSendError(first, claim, ctx);
    await sleep(Math.min(retryAfterMs(first) ?? 1_500, RATE_LIMIT_RETRY_MAX_MS));
    try {
      ({ messageId } = await send());
    } catch (e) {
      return onSendError(e, claim, ctx);
    }
  }
  // The text is out; a ledger write failure must not report the send as failed. The row stays 'pending', so a
  // retry re-sends with the same key and Photon dedupes it.
  await quiet("notify.markAccepted", markOutboundAccepted(claim.idempotency_key, messageId));
  return "sent";
}

async function onSendError(e: unknown, claim: OutboundClaim, ctx: { template_id: TemplateId; plan_id: string | null }): Promise<NotifyOutcome> {
  const code = problemCode(e);
  const action = problemAction(code);
  if (action === "blocked_inbound") {
    await quiet("notify.markBlocked", markOutboundBlocked(claim));
    log.warn({ ...ctx, code }, "notify: blocked until the user texts first");
    return "blocked_inbound";
  }
  await quiet("notify.markFailed", markOutboundFailed(claim.idempotency_key, code));
  switch (action) {
    case "bug":
      log.error({ ...ctx, code }, "notify: send rejected (template/key bug)");
      break;
    case "stale_route":
      // The route is kept: the space id is stable per person and line, so deleting it only turned one bad request
      // into silence for every later message (and blocked_inbound rows are never re-claimed).
      log.warn({ ...ctx, code }, "notify: space not sendable");
      await quiet("notify.systemEvent", emit({ type: "system", level: "warn", msg: `Message not delivered (${code})` }));
      break;
    case "not_assigned":
      log.warn({ ...ctx, code }, "notify: shared-line seat released");
      await quiet("notify.systemEvent", emit({ type: "system", level: "error", msg: `Message not delivered (${code}): seat released, member must re-join` }));
      break;
    default:
      log.warn({ ...ctx, code, action }, "notify: send failed");
  }
  return "failed";
}

/** Awaits a best-effort side effect on the failure path; a rejection is logged (errInfo only) and swallowed. */
async function quiet(what: string, p: Promise<unknown>): Promise<void> {
  try {
    await p;
  } catch (err) {
    log.error({ what, ...errInfo(err) }, "notify: bookkeeping failed");
  }
}
