// POST /venue/hook (PLAN §18; A plan T9). HMAC verification is C's verifyVenueHook(rawBody, headers, VENUE_HOOK_SECRET) from
// src/venueClient/hook.ts; ledger/counters SSE are C's emitLedger(ev)/emitCounters() from src/venueClient/ledger.ts.
// pay_url arrives only on this hook: never log or emit it. Owner A.
import type { Context, Hono } from "hono";
import { z } from "zod";
import type { VenueEvent } from "@tab/shared";
import { enqueue } from "../dueJobs";
import { env } from "../env";
import { A_JOB_KINDS, aJobKeys } from "../jobs/kinds";
import { errInfo, log } from "../log";
import { fanout } from "../notify/fanout";
import { notify, tplKey } from "../notify/notify";
import { usd2 } from "../notify/render";
import { markInboundSeen, seenInbound } from "../repo/inboundEvents";
import { countByStage, listMembers, memberByPayerRef } from "../repo/participants";
import { getPayLink, upsertPayLink } from "../repo/payLinks";
import { getPlanByRef } from "../repo/plans";
import type { MemberRow, PlanRow } from "../repo/types";
import { finishCancel } from "./cancel";
import { confirm, needsAttention } from "./commit";
import { setStage } from "./membership";

/**
 * C's venueClient (hook.ts: verifyVenueHook; ledger.ts: emitLedger/emitCounters), loaded on first use so app boot and
 * unrelated tests never depend on those modules; tests stub these members with vi.spyOn.
 */
export const venueClient = {
  verifyVenueHook: async (rawBody: string, headers: Headers): Promise<VenueEvent | null> => env.VENUE_HOOK_SECRET ? (await import("../venueClient/hook")).verifyVenueHook(rawBody, headers, env.VENUE_HOOK_SECRET) : null,
  emitLedger: async (ev: VenueEvent): Promise<void> => (await import("../venueClient/ledger")).emitLedger(ev),
  emitCounters: async (): Promise<void> => (await import("../venueClient/ledger")).emitCounters(),
};

/** Mounts POST /venue/hook → handleVenueHook. No CORS (server to server). */
export function mountVenueHook(app: Hono): void {
  app.post("/venue/hook", handleVenueHook);
}

/**
 * raw = await c.req.text() (never re-serialized) → verifyVenueHook(raw, c.req.raw.headers) → null ⇒ 401. Dedupe on
 * inbound_events('venue', event_id) (seen ⇒ 200). Respond 200 fast, dispatchVenueEvent, then markInboundSeen; a failed
 * dispatch stays unseen so a venue redelivery runs it again (every action below is idempotent).
 */
export async function handleVenueHook(c: Context): Promise<Response> {
  const ev = await venueClient.verifyVenueHook(await c.req.text(), c.req.raw.headers);
  if (!ev) return c.body(null, 401);
  if (await seenInbound("venue", ev.event_id)) return c.body(null, 200);
  void dispatchVenueEvent(ev)
    .then(() => markInboundSeen("venue", ev.event_id))
    .catch((e) => log.error({ ...errInfo(e), type: ev.type, event_id: ev.event_id }, "venue hook dispatch failed"));
  return c.body(null, 200);
}

const Authorized = z.object({
  amount_cents: z.number().int().nonnegative(),
  card_brand: z.unknown(),
  card_last4: z.string().regex(/^\d{4}$/),
  cybs_payment_id_short: z.string().nullish(),
});
const RetryLink = z.object({ pay_url: z.url(), expires_at: z.iso.datetime({ offset: true }) });
const Released = z.object({ retry: z.boolean().optional() });
const Captured = z.object({ amount_cents: z.number().int().nonnegative().optional() });

const ledger = (ev: VenueEvent) => venueClient.emitLedger(ev).catch((e) => log.error({ ...errInfo(e), type: ev.type }, "ledger emit failed"));

/** T_DECLINED_RETRY to that person only (key suffix event_id) with the fresh link, which replaces the stored one. */
async function sendRetryLink(plan: PlanRow, m: MemberRow, ev: VenueEvent): Promise<boolean> {
  const link = RetryLink.safeParse(ev.data);
  if (!link.success) {
    log.error({ type: ev.type, event_id: ev.event_id }, "venue hook: retry link missing");
    return false;
  }
  const prev = await getPayLink(plan.id, m.user_id, plan.version);
  if (prev) await upsertPayLink({ ...prev, share_id: ev.share_id ?? prev.share_id, pay_url: link.data.pay_url, expires_at: new Date(link.data.expires_at) });
  await notify(m.user_id, "T_DECLINED_RETRY", { url: link.data.pay_url }, { key: tplKey(plan.id, m.user_id, "T_DECLINED_RETRY", plan.version, ev.event_id), planId: plan.id });
  return true;
}

async function onAuthorized(plan: PlanRow, m: MemberRow, ev: VenueEvent): Promise<void> {
  const d = Authorized.safeParse(ev.data);
  const amount = d.success ? d.data.amount_cents : null;
  await setStage(plan.id, m.user_id, "HELD", { amountCents: amount, cybsIdShort: d.success ? (d.data.cybs_payment_id_short ?? null) : null });
  if (d.success) {
    const brand = displayBrand(d.data.card_brand) ?? "card";
    await notify(m.user_id, "T_HELD", { amount: usd2(d.data.amount_cents), brand, last4: d.data.card_last4 }, { key: tplKey(plan.id, m.user_id, "T_HELD", plan.version), planId: plan.id });
  } else log.error({ event_id: ev.event_id }, "venue hook: malformed share.authorized data");
  const [counts, members] = await Promise.all([countByStage(plan.id), listMembers(plan.id)]);
  const k = (counts.HELD ?? 0) + (counts.CAPTURED ?? 0);
  await fanout(plan.id, "T_IN_COUNT", () => ({ k, n: members.length }), { version: plan.version, suffix: k });
  await ledger(ev);
  if (ev.share_id) {
    await enqueue(A_JOB_KINDS.commit, aJobKeys.commit(plan.id, plan.version, ev.share_id), new Date(), { version: plan.version, share_id: ev.share_id }, { planId: plan.id });
  }
}

/**
 * share.authorized → HELD, T_HELD {amount, brand, last4}, T_IN_COUNT fan-out, emitLedger, enqueue commit per share ·
 * share.declined → T_DECLINED_RETRY {url} (suffix event_id), upsertPayLink, emitLedger · share.auth_unknown → emitLedger ·
 * share.released → retry ? T_DECLINED_RETRY + LINK_SENT : RELEASED; emitLedger · share.captured → CAPTURED, emitLedger ·
 * order.captured → confirm · order.cancelled → CANCELLED + T_CANCELLED + emitCounters ·
 * order.needs_attention → system:error, no DMs · tap.verified → ignored.
 */
export async function dispatchVenueEvent(ev: VenueEvent): Promise<void> {
  if (ev.type === "tap.verified") return;
  const plan = await getPlanByRef(ev.plan_ref);
  if (!plan) return log.warn({ type: ev.type, event_id: ev.event_id }, "venue hook: unknown plan_ref");

  switch (ev.type) {
    case "order.captured":
      return confirm(plan.id);
    case "order.cancelled":
      // Usually CANCELLING (we asked); APPROVING/ORDERING when the venue expired the order on its own.
      return finishCancel(plan.id, ["CANCELLING", "APPROVING", "ORDERING"]);
    case "order.needs_attention":
      return needsAttention(plan.id);
  }

  const m = ev.payer_ref ? await memberByPayerRef(plan.id, ev.payer_ref) : null;
  if (!m) return ledger(ev); // e.g. a forgotten user: the ledger still moves, nobody is messaged
  switch (ev.type) {
    case "share.authorized":
      return onAuthorized(plan, m, ev);
    case "share.declined":
      await sendRetryLink(plan, m, ev);
      break;
    case "share.released":
      if (Released.safeParse(ev.data).data?.retry === true) {
        if (await sendRetryLink(plan, m, ev)) await setStage(plan.id, m.user_id, "LINK_SENT");
      } else await setStage(plan.id, m.user_id, "RELEASED");
      break;
    case "share.captured":
      await setStage(plan.id, m.user_id, "CAPTURED", { amountCents: Captured.safeParse(ev.data).data?.amount_cents ?? null });
      break;
    // share.authorizing / share.auth_unknown: ledger only (the venue sweep reverses unknown auths).
  }
  await ledger(ev);
}

const BRANDS: Readonly<Record<string, string>> = {
  visa: "Visa", "001": "Visa",
  mastercard: "Mastercard", "002": "Mastercard",
  amex: "Amex", americanexpress: "Amex", "003": "Amex",
};

/** VISA/visa/001 → "Visa", MASTERCARD/mastercard/002 → "Mastercard", AMEX/amex/003 → "Amex", else null (caller uses "card"). */
export function displayBrand(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  return BRANDS[raw.toLowerCase().replace(/[\s_-]/g, "")] ?? null;
}
