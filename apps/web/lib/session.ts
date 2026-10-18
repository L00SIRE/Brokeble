// Per-device flow session (ux-flow §9.1–9.2). localStorage is a convenience only: every read and write is wrapped, the
// flow works without it, and it never holds the full phone number (only the last 4 digits, for display).
import { z } from "zod";

export const ORGANIZER_SESSION_KEY = "squadtab.session.v1";
export const joinSessionKey = (code: string): string => `squadtab.join.v1.${code}`;

/** Status tokens live 7 days on the agent (ux-flow §7.1); a stored session older than that is useless. */
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const FlowSession = z.object({
  v: z.literal(1),
  token: z.string().min(1).max(2048),
  role: z.enum(["organizer", "guest"]),
  /** The plan code once /status has revealed it (lets /j/[code] recognize the organizer, ux-flow §4.4). */
  code: z
    .string()
    .regex(/^\d{4}$/)
    .optional(),
  phone_last4: z.string().regex(/^\d{4}$/),
  assigned_number: z.string().max(20),
  sms_body: z.string().max(200),
  /** The agent-rendered QR of /t/<token>, so a desktop resume can still show "Continue on your iPhone". */
  handoff_qr_svg: z.string().max(40_000).optional(),
  /** Client clock (ms) when the token was issued: drives the 45 s "Not seeing your text yet" hint. */
  issued_at: z.number().int().nonnegative(),
});
export type FlowSession = z.infer<typeof FlowSession>;

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function storage(): StorageLike | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null; // blocked site data, private mode
  }
}

export function loadSession(key: string, now = Date.now(), store: StorageLike | null = storage()): FlowSession | null {
  try {
    const raw = store?.getItem(key);
    if (!raw) return null;
    const parsed = FlowSession.safeParse(JSON.parse(raw));
    if (!parsed.success || now - parsed.data.issued_at > SESSION_TTL_MS || parsed.data.issued_at > now + 60_000) {
      store?.removeItem(key);
      return null;
    }
    return parsed.data;
  } catch {
    return null;
  }
}

export function saveSession(key: string, s: FlowSession, store: StorageLike | null = storage()): void {
  try {
    store?.setItem(key, JSON.stringify(FlowSession.parse(s)));
  } catch {
    // Storage full or blocked: the flow keeps working from memory.
  }
}

export function clearSession(key: string, store: StorageLike | null = storage()): void {
  try {
    store?.removeItem(key);
  } catch {
    // ignore
  }
}

/** Last 4 digits of an E.164 number, for "It has to come from •••• 0123". */
export const last4 = (e164: string): string => e164.replace(/\D/g, "").slice(-4).padStart(4, "0");
