// Card-number intercept (PLAN §3.2, A plan T3 step 2 / T12). Runs BEFORE any LLM call, log line or text write. Owner A.

/** Luhn checksum over a digit string. */
export function luhnValid(digits: string): boolean {
  if (!/^\d+$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0, double = false; i < digits.length; i++, double = !double) {
    let d = digits.charCodeAt(digits.length - 1 - i) - 48;
    if (double && (d *= 2) > 9) d -= 9;
    sum += d;
  }
  return sum % 10 === 0;
}

/** A run of digit groups joined by single spaces or dashes. */
const DIGIT_RUN = /\d+(?:[ -]\d+)*/g;

/**
 * True if `text` holds 13–19 digits (spaces/dashes allowed between groups) that pass Luhn. Every contiguous span of
 * digit groups is tried, so a card pasted after a phone number ("3105551234 4111 1111 1111 1111") is still caught.
 * "4111 1111 1111 1111" → true; "4111-1111-1111-1112", 12-digit numbers, "call me at 3105551234" → false.
 */
export function containsCardNumber(text: string): boolean {
  for (const [run] of text.matchAll(DIGIT_RUN)) {
    const groups = run.split(/[ -]/);
    for (let i = 0; i < groups.length; i++) {
      let digits = "";
      for (let j = i; j < groups.length && digits.length + groups[j]!.length <= 19; j++) {
        digits += groups[j];
        if (digits.length >= 13 && luhnValid(digits)) return true;
      }
    }
  }
  return false;
}
