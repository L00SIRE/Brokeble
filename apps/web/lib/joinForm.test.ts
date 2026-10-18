import { describe, expect, it } from "vitest";
import { parseUsd } from "./formUtils";
import { androidCopy, fetchPlanPreview, joinFailureCopy, type JoinFailure, planMeta, toJoinFailure, validateJoinPhone } from "./joinForm";
import { formatPhone, normalizePhone } from "./normalizePhone";

describe("normalizePhone", () => {
  it.each([
    ["(310) 555-0123", "+13105550123"],
    ["310.555.0123", "+13105550123"],
    ["1 310 555 0123", "+13105550123"],
    ["+1 (310) 555-0123", "+13105550123"],
    ["+44 20 7946 0958", "+442079460958"],
  ])("accepts %s", (input, out) => expect(normalizePhone(input)).toBe(out));

  it.each(["", "555-0123", "3105550123x", "abc", "0105550123", "310555012", "442079460958", "+0123456789", "+12"])("rejects %j", (input) =>
    expect(normalizePhone(input)).toBeNull(),
  );

  it("formats US numbers and leaves others alone", () => {
    expect(formatPhone("+13105550123")).toBe("+1 (310) 555-0123");
    expect(formatPhone("+442079460958")).toBe("+442079460958");
  });
});

describe("parseUsd", () => {
  it.each([
    ["60", 60],
    ["$1,000", 1000],
    [" 42.5 ", 42.5],
    ["", null],
    ["60 bucks", "invalid"],
    ["-5", "invalid"],
  ])("%j", (raw, out) => expect(parseUsd(raw)).toBe(out));
});

describe("validateJoinPhone", () => {
  it("builds the one-field wire body: no name, no budget", () => {
    const r = validateJoinPhone("4821", " (310) 555-0123 ");
    expect(r).toEqual({ ok: true, body: { code: "4821", phone_e164: "+13105550123", consent: true } });
    expect(r.ok && Object.keys(r.body).sort()).toEqual(["code", "consent", "phone_e164"]);
  });

  it.each(["", "555-0123", "abc", "0105550123"])("rejects %j with the ux-flow sentence", (phone) => {
    expect(validateJoinPhone("4821", phone)).toEqual({
      ok: false,
      error: "That doesn’t look like a US mobile number. Try 10 digits, like (310) 555-0123.",
    });
  });

  it("rejects a malformed invite code even with a good number", () => {
    expect(validateJoinPhone("48a1", "3105550123").ok).toBe(false);
  });
});

describe("joinFailureCopy", () => {
  const all: JoinFailure[] = ["not_found", "plan_closed", "plan_full", "in_other_plan", "capacity", "rate_limited", "network", "invalid", "unknown"];

  it("uses the ux-flow §4.4 titles", () => {
    expect(joinFailureCopy("not_found", "Maya").title).toBe("We couldn’t find that plan");
    expect(joinFailureCopy("plan_closed", null).title).toBe("This plan’s already moving");
    expect(joinFailureCopy("plan_full", null).title).toBe("This plan’s full");
    expect(joinFailureCopy("in_other_plan", null).title).toBe("You’re already in another plan tonight");
    expect(joinFailureCopy("capacity", null).title).toBe("SquadTab is packed right now");
    expect(joinFailureCopy("rate_limited", null).title).toBe("Too many tries");
    expect(joinFailureCopy("network", null)).toMatchObject({ title: "Couldn’t reach SquadTab", body: expect.stringContaining("Nothing was sent.") });
  });

  it("names the organizer when known and reads naturally when not", () => {
    expect(joinFailureCopy("not_found", "Maya").body).toBe("Double-check the link Maya sent, or start your own.");
    expect(joinFailureCopy("not_found", null).body).toBe("Double-check the link your friend sent, or start your own.");
  });

  it("makes link-level failures terminal with a start action, and transient ones retryable", () => {
    for (const f of ["not_found", "plan_closed", "plan_full"] as const) expect(joinFailureCopy(f, null)).toMatchObject({ terminal: true, action: "start" });
    for (const f of ["in_other_plan", "capacity", "rate_limited", "network", "unknown"] as const) expect(joinFailureCopy(f, null)).toMatchObject({ terminal: false, action: "retry" });
    expect(joinFailureCopy("invalid", null)).toMatchObject({ terminal: false, action: "fix" });
  });

  it("never blames the platform or uses red-flag copy", () => {
    for (const f of all) {
      const { title, body } = joinFailureCopy(f, "Maya");
      expect(`${title} ${body}`).not.toMatch(/can't text you first|\$0 instantly|Visa-verified/i);
    }
  });
});

describe("toJoinFailure", () => {
  it("passes known codes and degrades unknown ones", () => {
    expect(toJoinFailure("plan_full")).toBe("plan_full");
    expect(toJoinFailure("in_other_plan")).toBe("in_other_plan");
    expect(toJoinFailure("network")).toBe("network");
    expect(toJoinFailure("teapot")).toBe("unknown");
  });
});

describe("androidCopy", () => {
  it("names the organizer's plan", () => {
    expect(androidCopy("Maya")).toEqual({ title: "SquadTab lives in iMessage", body: "Open this link on an iPhone, iPad or Mac to join Maya’s plan." });
    expect(androidCopy(null).body).toBe("Open this link on an iPhone, iPad or Mac to join this plan.");
  });
});

describe("planMeta", () => {
  it("joins date, time and area and drops blanks", () => {
    expect(planMeta({ date_label: "Sat, Oct 24", time_label: "7:00 PM", area: "Santa Monica" })).toBe("Sat, Oct 24 · 7:00 PM · Santa Monica");
    expect(planMeta({ date_label: "Sat, Oct 24", time_label: "", area: null })).toBe("Sat, Oct 24");
  });
});

const PREVIEW = {
  code: "4821",
  title: "Dinner + show",
  date_label: "Sat, Oct 24",
  time_label: "7:00 PM",
  area: "Santa Monica",
  organizer_first_name: "Maya",
  joined: 2,
  party_target: 4,
  status: "open",
};

const fakeFetch = (status: number, body: unknown) => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const f = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  return { f, calls };
};

describe("fetchPlanPreview", () => {
  const BASE = "https://agent.example";

  it("returns the whitelisted preview and caches with revalidate 10", async () => {
    const { f, calls } = fakeFetch(200, PREVIEW);
    expect(await fetchPlanPreview("4821", BASE, f)).toEqual({ kind: "ok", plan: PREVIEW });
    expect(calls[0]?.url).toBe("https://agent.example/plans/4821");
    expect(calls[0]?.init?.next).toEqual({ revalidate: 10 });
  });

  it("distinguishes a dead link (404) from an unreachable agent", async () => {
    expect(await fetchPlanPreview("4821", BASE, fakeFetch(404, { error: "not_found" }).f)).toEqual({ kind: "not_found" });
    expect(await fetchPlanPreview("4821", BASE, fakeFetch(500, {}).f)).toEqual({ kind: "unavailable" });
    const throwing = (async () => {
      throw new TypeError("network");
    }) as typeof fetch;
    expect(await fetchPlanPreview("4821", BASE, throwing)).toEqual({ kind: "unavailable" });
  });

  it("rejects malformed bodies and a preview for another code", async () => {
    expect(await fetchPlanPreview("4821", BASE, fakeFetch(200, { ...PREVIEW, joined: "2" }).f)).toEqual({ kind: "unavailable" });
    expect(await fetchPlanPreview("4821", BASE, fakeFetch(200, { ...PREVIEW, code: "1234" }).f)).toEqual({ kind: "unavailable" });
  });

  it("never calls the network for a bad code or a relative base", async () => {
    const { f, calls } = fakeFetch(200, PREVIEW);
    expect(await fetchPlanPreview("../x", BASE, f)).toEqual({ kind: "unavailable" });
    expect(await fetchPlanPreview("4821", "", f)).toEqual({ kind: "unavailable" });
    expect(calls).toHaveLength(0);
  });
});
