// `sms:` deep links (ux-flow §3.2). Pure. The client builds the link from `assigned_number` + `sms_body` in the agent's
// response and never trusts a server-built href.
import { canOpenMessages, type Platform } from "./platform";

/** Stricter than the legacy `startsWith("sms:")` check: only a plain E.164 number ever becomes a link. */
const E164_STRICT = /^\+\d{8,15}$/;

export const isLinkableNumber = (n: string): boolean => E164_STRICT.test(n);

/** RFC 3986 strict: encodeURIComponent leaves `!'()*` alone; escape them too so no URL parser can trip on them. */
export const encodeBody = (s: string): string => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/**
 * iOS and macOS take `sms:+1…&body=` (de facto, not documented by Apple; ux-flow §3.2 UNVERIFIED on iOS 26); Android
 * takes RFC 5724 `?body=`. Returns null when the number is not linkable or the platform can't open Messages.
 */
export function smsHref(number: string, body: string, p: Platform): string | null {
  if (!isLinkableNumber(number) || !canOpenMessages(p)) return null;
  const sep = p === "android" ? "?" : "&";
  return `sms:${number}${sep}body=${encodeBody(body)}`;
}

/** "+12135550147" → "(213) 555-0147" for display; other numbers are shown as given. */
export function displayNumber(e164: string): string {
  const m = /^\+1([2-9]\d{2})(\d{3})(\d{4})$/.exec(e164);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : e164;
}
