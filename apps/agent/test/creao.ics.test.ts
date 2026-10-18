import { describe, expect, it } from "vitest";
import { Itinerary } from "@tab/shared";
import { buildIcs, laWallClockToUtc } from "../src/creao/ics";

const REF = "11111111-1111-4111-8111-111111111111";
const NOW = new Date("2026-10-17T20:00:00Z");

describe("laWallClockToUtc", () => {
  it("applies PDT (UTC-7) in October", () => expect(laWallClockToUtc("2026-10-17", "18:30").toISOString()).toBe("2026-10-18T01:30:00.000Z"));
  it("applies PST (UTC-8) in winter", () => expect(laWallClockToUtc("2026-12-05", "18:30").toISOString()).toBe("2026-12-06T02:30:00.000Z"));
  it("handles the spring-forward and fall-back days", () => {
    expect(laWallClockToUtc("2026-03-08", "12:00").toISOString()).toBe("2026-03-08T19:00:00.000Z");
    expect(laWallClockToUtc("2026-11-01", "12:00").toISOString()).toBe("2026-11-01T20:00:00.000Z");
  });
});

describe("buildIcs", () => {
  const stops = [
    { kind: "dinner" as const, name: "Pho, Place; Inc", address: "1 Main St, Los Angeles, CA", time: "18:30" },
    { kind: "show" as const, name: "Comedy Night", address: "2 Sunset Blvd, Los Angeles, CA", time: "20:30" },
  ];
  const ics = buildIcs(REF, "2026-10-17", stops, NOW);

  it("is a CRLF VCALENDAR with one VEVENT per stop", () => {
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics.trimEnd().endsWith("END:VCALENDAR")).toBe(true);
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    expect(ics.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
    expect(ics).toContain("PRODID:-//Tab//Concierge//EN");
  });
  it("uses UTC times: dinner 90 min, show 2 h", () => {
    expect(ics).toContain("UID:" + REF + "-dinner@tab");
    expect(ics).toContain("DTSTART:20261018T013000Z\r\nDTEND:20261018T030000Z");
    expect(ics).toContain("DTSTART:20261018T033000Z\r\nDTEND:20261018T053000Z");
    expect(ics).toContain("DTSTAMP:20261017T200000Z");
  });
  it("escapes TEXT values", () => {
    expect(ics).toContain(String.raw`SUMMARY:Dinner: Pho\, Place\; Inc`);
    expect(ics).toContain(String.raw`LOCATION:1 Main St\, Los Angeles\, CA`);
  });
  it("ends a stop at the next one when they overlap", () => {
    const tight = buildIcs(REF, "2026-10-17", [{ ...stops[0]!, time: "18:30" }, { ...stops[1]!, time: "19:30" }], NOW);
    expect(tight).toContain("DTSTART:20261018T013000Z\r\nDTEND:20261018T023000Z");
  });
  it("folds long lines at 75 octets without splitting characters", () => {
    const long = buildIcs(REF, "2026-10-17", [{ ...stops[0]!, name: "Café ".repeat(40) }], NOW);
    for (const line of long.split("\r\n")) expect(Buffer.byteLength(line)).toBeLessThanOrEqual(75);
    expect(long.replace(/\r\n /g, "")).toContain("Café ".repeat(40).trim());
  });
  it("satisfies the Itinerary schema", () => {
    const r = Itinerary.safeParse({
      plan_ref: REF, title: "t", date: "2026-10-17",
      stops: stops.map((s) => ({ ...s, notes: "" })),
      logistics: { getting_there: "a", parking: "b", doors: "c", dress_code: "d", know_before: [] },
      ics, notion_url: null,
    });
    expect(r.success).toBe(true);
  });
});
