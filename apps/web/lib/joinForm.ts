// /j/[code] friend flow rules (ux-flow §4.4, §9). Pure except `fetchPlanPreview`, which takes its fetch as a parameter.
// The web asks for one thing, the person's phone number. Names and budgets are asked only in the private chat.
import { PlanPreview } from "./agent";
import { normalizePhone } from "./normalizePhone";

export const CODE_RE = /^\d{4}$/;

/** POST /join wire body. `first_name` and `budget_usd` are left out on purpose (ux-flow §7.2): the chat asks for both. */
export type JoinBody = { code: string; phone_e164: string; consent: true };

export const PHONE_ERROR = "That doesn’t look like a US mobile number. Try 10 digits, like (310) 555-0123.";

export function validateJoinPhone(code: string, phone: string): { ok: true; body: JoinBody } | { ok: false; error: string } {
  const e164 = normalizePhone(phone);
  if (!CODE_RE.test(code) || !e164) return { ok: false, error: PHONE_ERROR };
  return { ok: true, body: { code, phone_e164: e164, consent: true } };
}

export type JoinFailure = "not_found" | "plan_closed" | "plan_full" | "capacity" | "rate_limited" | "network" | "invalid" | "unknown";

/** What the error screen offers: `start` links to `/`, `retry` re-submits the same number, `fix` focuses the field. */
export type FailureAction = "start" | "retry" | "fix";

export type FailureCopy = { title: string; body: string; terminal: boolean; action: FailureAction };

const planOf = (name: string | null) => (name ? `${name}’s plan` : "this plan");

/**
 * Error copy table (ux-flow §4.4). Terminal failures replace the form; the rest show above it.
 * `organizer` is the first name from the public plan preview, or null when the preview is unavailable.
 */
export function joinFailureCopy(failure: JoinFailure, organizer: string | null): FailureCopy {
  switch (failure) {
    case "not_found":
      return { title: "We couldn’t find that plan", body: `Double-check the link ${organizer ?? "your friend"} sent, or start your own.`, terminal: true, action: "start" };
    case "plan_closed":
      return { title: "This plan’s already moving", body: "It’s past the joining stage. Ask the organizer to start a new one, or start your own.", terminal: true, action: "start" };
    case "plan_full":
      return { title: "This plan’s full", body: "It already has 8 people, the most SquadTab plans for.", terminal: true, action: "start" };
    case "capacity":
      return { title: "SquadTab is packed right now", body: "Every line is busy. Try again in a few minutes.", terminal: false, action: "retry" };
    case "rate_limited":
      return { title: "Too many tries", body: "Wait a minute, then try again.", terminal: false, action: "retry" };
    case "network":
      return { title: "Couldn’t reach SquadTab", body: "Check your connection and try again. Nothing was sent.", terminal: false, action: "retry" };
    case "invalid":
      return { title: "Check your number", body: PHONE_ERROR, terminal: false, action: "fix" };
    case "unknown":
      return { title: "Something went wrong on our side", body: `Nothing was sent. Try again to join ${planOf(organizer)}.`, terminal: false, action: "retry" };
  }
}

/** Maps the agent's error code to a copy key. Codes this client doesn't know degrade to "unknown". */
export function toJoinFailure(error: string): JoinFailure {
  switch (error) {
    case "not_found":
    case "plan_closed":
    case "plan_full":
    case "capacity":
    case "rate_limited":
    case "network":
    case "invalid":
      return error;
    default:
      return "unknown";
  }
}

/** Android notice (ux-flow §4.4, §6). A product choice, not a verified platform limit, so the page offers an override. */
export function androidCopy(organizer: string | null): { title: string; body: string } {
  return { title: "SquadTab lives in iMessage", body: `Open this link on an iPhone, iPad or Mac to join ${planOf(organizer)}.` };
}

/** "Sat, Oct 24 · 7:00 PM · Santa Monica": the meta line under the plan title. Empty parts are dropped. */
export function planMeta(p: { date_label?: string | null; time_label?: string | null; area?: string | null }): string {
  return [p.date_label, p.time_label, p.area].filter((s): s is string => Boolean(s?.trim())).join(" · ");
}

export type PreviewResult = { kind: "ok"; plan: PlanPreview } | { kind: "not_found" } | { kind: "unavailable" };

/**
 * Server-side GET /plans/:code for the invite page and its link preview. `revalidate: 10` because every server call
 * shares Vercel's egress IP, and with it one rate-limit bucket (ux-flow §6). A slow or down agent must never block the
 * page: it times out at 3 s and the page falls back to a generic header with a working form (ux-flow §4.4).
 */
export async function fetchPlanPreview(code: string, base = process.env.NEXT_PUBLIC_AGENT_URL ?? "", f: typeof fetch = fetch): Promise<PreviewResult> {
  if (!CODE_RE.test(code) || !/^https?:\/\//.test(base)) return { kind: "unavailable" };
  try {
    const res = await f(`${base}/plans/${code}`, { next: { revalidate: 10 }, signal: AbortSignal.timeout(3000) });
    if (res.status === 404) return { kind: "not_found" };
    if (!res.ok) return { kind: "unavailable" };
    const parsed = PlanPreview.safeParse(await res.json());
    return parsed.success && parsed.data.code === code ? { kind: "ok", plan: parsed.data } : { kind: "unavailable" };
  } catch {
    return { kind: "unavailable" };
  }
}

/** Status tokens are `base64url(payload).base64url(mac)` (ux-flow §7.1). /t/[token] rejects anything else before any fetch. */
export const TOKEN_RE = /^[\w-]{8,1024}\.[\w-]{8,256}$/;
