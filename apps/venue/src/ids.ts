import { randomBytes } from "node:crypto";

const B32 = "abcdefghijklmnopqrstuvwxyz234567";

function base32(n: number): string {
  const bytes = randomBytes(n);
  let out = "";
  for (let i = 0; i < n; i++) out += B32[bytes[i]! & 31];
  return out;
}

export const orderId = () => `ord_${base32(10)}`;
export const shareId = () => `shr_${base32(10)}`;
export const eventId = () => `evt_${base32(16)}`;

/** Deterministic Cybersource reference code and a unique 30-hex transactionId (spec maxLength 59 / 30). */
export function opIds(shareId: string, op: "auth" | "capture" | "reverse" | "timeout_reverse", attempt: number) {
  const code = `${shareId}-${op}-${attempt}`;
  if (code.length > 59) throw new RangeError("client reference code exceeds 59 chars");
  return { code, transactionId: randomBytes(15).toString("hex") };
}
