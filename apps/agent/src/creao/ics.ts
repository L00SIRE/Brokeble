// Minimal iCalendar for the Concierge fallback (B plan T11). Pure. Owner B.
import type { Category } from "@tab/shared";

export type IcsStop = { kind: Category; name: string; address: string; time: string /* HH:MM, America/Los_Angeles */ };

const LA_TZ = "America/Los_Angeles";
const DINNER_MS = 90 * 60_000;
const SHOW_MS = 120 * 60_000;
const laParts = new Intl.DateTimeFormat("en-US", {
  timeZone: LA_TZ, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric",
});

/** LA's UTC offset (ms, negative) at an instant. */
function laOffsetMs(at: number): number {
  const p = Object.fromEntries(laParts.formatToParts(at).map((x) => [x.type, Number(x.value)]));
  return Date.UTC(p.year!, p.month! - 1, p.day!, p.hour!, p.minute!, p.second!) - Math.floor(at / 1000) * 1000;
}

/** An America/Los_Angeles wall-clock date + HH:MM → the UTC instant (DST-correct, no date library). */
export function laWallClockToUtc(isoDate: string, hhmm: string): Date {
  const [y, mo, d] = isoDate.split("-").map(Number) as [number, number, number];
  const [h, mi] = hhmm.split(":").map(Number) as [number, number];
  const wall = Date.UTC(y, mo - 1, d, h, mi);
  // Two passes settle the offset when the guess lands on the other side of a DST switch.
  let utc = wall - laOffsetMs(wall);
  utc = wall - laOffsetMs(utc);
  return new Date(utc);
}

const stamp = (d: Date): string => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const esc = (s: string): string => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

/** RFC 5545 §3.1: lines are folded at 75 octets, never inside a UTF-8 sequence. */
function fold(line: string): string {
  const out: string[] = [];
  let cur = "";
  let bytes = 0;
  for (const ch of line) {
    const n = Buffer.byteLength(ch);
    if (bytes + n > (out.length === 0 ? 75 : 74)) {
      out.push(cur);
      cur = "";
      bytes = 0;
    }
    cur += ch;
    bytes += n;
  }
  out.push(cur);
  return out.join("\r\n ");
}

/**
 * BEGIN:VCALENDAR / VERSION:2.0 / PRODID:-//Tab//Concierge//EN, one VEVENT per stop (dinner 90 min; show until the next
 * stop or 2 h) with UID `<planRef>-<kind>@tab`, DTSTAMP, DTSTART/DTEND in UTC "Z", SUMMARY, LOCATION (escaped), CRLF line
 * endings, END:VCALENDAR. Must satisfy Itinerary.ics (≤20000 chars, starts with BEGIN:VCALENDAR).
 */
export function buildIcs(planRef: string, isoDate: string, stops: readonly IcsStop[], now: Date = new Date()): string {
  const starts = stops.map((s) => laWallClockToUtc(isoDate, s.time).getTime());
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Tab//Concierge//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH"];
  stops.forEach((s, i) => {
    const start = starts[i]!;
    const next = Math.min(...starts.filter((t) => t > start));
    const end = Math.min(start + (s.kind === "dinner" ? DINNER_MS : SHOW_MS), next);
    lines.push(
      "BEGIN:VEVENT",
      `UID:${planRef}-${s.kind}@tab`,
      `DTSTAMP:${stamp(now)}`,
      `DTSTART:${stamp(new Date(start))}`,
      `DTEND:${stamp(new Date(end))}`,
      `SUMMARY:${esc(`${s.kind === "dinner" ? "Dinner" : "Show"}: ${s.name}`)}`,
      `LOCATION:${esc(s.address)}`,
      "END:VEVENT",
    );
  });
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}
