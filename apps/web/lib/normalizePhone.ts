// Join-page phone normalization (B plan T8). Pure.
import { z } from "zod";

const e164 = z.e164();

/**
 * Strip spaces, dashes, dots and parentheses; 10 digits → "+1…"; 11 digits starting with 1 → "+…"; otherwise a
 * leading "+" is required. Returns the E.164 string if z.e164() accepts it, else null. US numbers must also have a
 * valid NANP area code (2-9), which catches the common "0310…" and "1310…" typos before the server does.
 */
export function normalizePhone(input: string): string | null {
  const compact = input.trim().replace(/[\s().-]/g, "");
  if (!/^\+?\d+$/.test(compact)) return null;
  let candidate: string;
  if (compact.startsWith("+")) candidate = compact;
  else if (/^[2-9]\d{9}$/.test(compact)) candidate = `+1${compact}`;
  else if (/^1[2-9]\d{9}$/.test(compact)) candidate = `+${compact}`;
  else return null;
  return e164.safeParse(candidate).success ? candidate : null;
}

/** "+13105550123" → "+1 (310) 555-0123"; anything else is returned unchanged. */
export function formatPhone(e: string): string {
  const m = /^\+1([2-9]\d{2})(\d{3})(\d{4})$/.exec(e);
  return m ? `+1 (${m[1]}) ${m[2]}-${m[3]}` : e;
}
