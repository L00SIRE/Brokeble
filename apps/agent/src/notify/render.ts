// Template rendering and display formatting (A plan T5). Pure. Owner A.
// Money: the copy already contains "$". Dates/times use Intl with timeZone "America/Los_Angeles"; no date library.
import { COPY, type PublicBundle, type TemplateId, type TemplateVars } from "@tab/shared";

export const LA_TZ = "America/Los_Angeles";

/** Replaces every {name} in COPY[id] with vars[name]; throws on a missing variable (vars are already zod-parsed by notify). */
export function render<T extends TemplateId>(id: T, vars: TemplateVars<T>): string {
  const v = vars as Record<string, string | number | undefined>;
  return COPY[id].replace(/\{(\w+)\}/g, (_, name: string) => {
    const value = v[name];
    if (value === undefined || value === "") throw new Error(`render ${id}: missing {${name}}`);
    return String(value);
  });
}

function assertCents(cents: number): void {
  if (!Number.isSafeInteger(cents) || cents < 0) throw new RangeError(`invalid cents: ${cents}`);
}

/** Whole dollars, floored (budgets, per-person bundle prices): 3099 → "30". Never overstates a max. */
export function usd0(cents: number): string {
  assertCents(cents);
  return String(Math.floor(cents / 100));
}

/** Dollars with cents (share amounts: T_HOLD_GATE, T_PAY_LINK, T_HELD, T_CAPTURED): 3000 → "30.00". Integer math, no float rounding. */
export function usd2(cents: number): string {
  assertCents(cents);
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

const DATE_FMT = new Intl.DateTimeFormat("en-US", { timeZone: LA_TZ, weekday: "short", month: "short", day: "numeric" });
const TIME_FMT = new Intl.DateTimeFormat("en-US", { timeZone: LA_TZ, hour: "numeric", minute: "2-digit" });
// ICU 72+ puts U+202F (narrow no-break space) before AM/PM; plain spaces render the same everywhere.
const plainSpaces = (s: string) => s.replace(/[\u202f\u00a0]/g, " ");

/** {date}: IsoDate → "Sat, Oct 17" (weekday short, month short, day numeric; LA). */
export function fmtDate(isoDate: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) throw new RangeError(`invalid date: ${isoDate}`);
  // A calendar date has no zone: noon UTC is the same calendar day in LA (UTC-7/-8), so the weekday is right.
  const d = new Date(`${isoDate}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) throw new RangeError(`invalid date: ${isoDate}`);
  return plainSpaces(DATE_FMT.format(d));
}

/** {deadline}: instant → "9:40 PM" (hour numeric, minute 2-digit; LA). */
export function fmtDeadline(at: Date | string): string {
  const d = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(d.getTime())) throw new RangeError("invalid deadline");
  return plainSpaces(TIME_FMT.format(d));
}

/** HHMM → "h:mm" 12-hour without suffix ("18:30" → "6:30") for T_PICKS lines. */
export function fmtClock(hhmm: string): string {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm);
  if (!m) throw new RangeError(`invalid time: ${hhmm}`);
  return `${Number(m[1]) % 12 || 12}:${m[2]}`;
}

/** Scout pitch for user copy: strip control/format chars and newlines, collapse spaces, cut to `max` (default 140). */
export function sanitizePitch(pitch: string, max = 140): string {
  // \p{Cf} also removes bidi overrides and zero-width characters that could disguise text in a bubble.
  const clean = pitch.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]+/gu, " ").replace(/\s+/g, " ").trim();
  const chars = Array.from(clean); // code points, so an emoji is never split
  if (chars.length <= max) return clean;
  if (max <= 1) return "";
  return `${chars.slice(0, max - 1).join("").trimEnd()}…`;
}

const MESSAGE_BUDGET = 600; // MESSAGE_TOO_LONG limit UNVERIFIED; stay well under any plausible cap
const PICKS_FRAME = COPY.T_PICKS.length - "{lines}".length; // the longer of the two picks frames
const PITCH_INDENT = "\n   ";
const MIN_PITCH = 24; // shorter than this reads as noise; drop pitches instead

/**
 * T_PICKS / T_PICKS_REFRESH {lines}: one entry per bundle,
 * `${index}. ${title} · dinner ${h:mm} → show ${h:mm} · $${usd0(all_in)} pp all-in\n   ${pitch}`, joined by "\n".
 * Keeps the whole message under ~600 chars (MESSAGE_TOO_LONG limit UNVERIFIED) by trimming pitches.
 */
export function picksLines(bundles: readonly PublicBundle[]): string {
  const sorted = [...bundles].sort((a, b) => a.index - b.index);
  const heads = sorted.map(
    (b) => `${b.index}. ${b.title} · dinner ${fmtClock(b.dinner_time)} → show ${fmtClock(b.show_start)} · $${usd0(b.all_in_pp_cents)} pp all-in`,
  );
  const pitches = sorted.map((b) => sanitizePitch(b.pitch));
  const withPitch = pitches.filter((p) => p !== "").length;
  const fixed = PICKS_FRAME + heads.reduce((n, h) => n + h.length, 0) + Math.max(0, heads.length - 1);
  const perPitch = withPitch === 0 ? 0 : Math.min(140, Math.floor((MESSAGE_BUDGET - fixed) / withPitch) - PITCH_INDENT.length);
  return heads
    .map((h, i) => {
      const p = perPitch >= MIN_PITCH ? sanitizePitch(pitches[i]!, perPitch) : "";
      return p ? `${h}${PITCH_INDENT}${p}` : h;
    })
    .join("\n");
}
