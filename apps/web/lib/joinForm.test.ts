import { describe, expect, it } from "vitest";
import { formatPhone, normalizePhone } from "./normalizePhone";
import { mapJoinIssues, validateJoin } from "./joinForm";
import { parseUsd } from "./formUtils";

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
    ["  ", null],
    ["60 bucks", "invalid"],
    ["-5", "invalid"],
    ["1.234", "invalid"],
  ])("%j", (raw, out) => expect(parseUsd(raw)).toBe(out));
});

const ok = { phone: "310 555 0123", firstName: " Leo ", budgetTarget: "", budgetMax: "", consent: true };

describe("validateJoin", () => {
  it("builds the wire body without a budget when none is given", () => {
    expect(validateJoin("4821", ok)).toEqual({
      ok: true,
      body: { code: "4821", phone_e164: "+13105550123", first_name: "Leo", consent: true },
    });
  });

  it("includes target and optional hard_max in dollars", () => {
    const r = validateJoin("4821", { ...ok, budgetTarget: "$60", budgetMax: "80" });
    expect(r).toMatchObject({ ok: true, body: { budget_usd: { target: 60, hard_max: 80 } } });
    const t = validateJoin("4821", { ...ok, budgetTarget: "60" });
    expect(t).toMatchObject({ ok: true, body: { budget_usd: { target: 60 } } });
    expect(t.ok && "hard_max" in (t.body.budget_usd ?? {})).toBe(false);
  });

  it("reports every field error", () => {
    const r = validateJoin("4821", { phone: "123", firstName: " ", budgetTarget: "abc", budgetMax: "2000", consent: false });
    expect(r.ok).toBe(false);
    expect(!r.ok && Object.keys(r.errors).sort()).toEqual(["budgetMax", "budgetTarget", "consent", "firstName", "phone"]);
  });

  it("rejects a hard max below the target, or a hard max with no target", () => {
    expect(validateJoin("4821", { ...ok, budgetTarget: "80", budgetMax: "60" })).toMatchObject({ ok: false, errors: { budgetMax: expect.any(String) } });
    expect(validateJoin("4821", { ...ok, budgetMax: "60" })).toMatchObject({ ok: false, errors: { budgetTarget: expect.any(String) } });
  });

  it("rejects zero and over-limit budgets", () => {
    expect(validateJoin("4821", { ...ok, budgetTarget: "0" }).ok).toBe(false);
    expect(validateJoin("4821", { ...ok, budgetTarget: "1000.01" }).ok).toBe(false);
    expect(validateJoin("4821", { ...ok, budgetTarget: "1000" }).ok).toBe(true);
  });

  it("never echoes the budget in an error message", () => {
    const r = validateJoin("4821", { ...ok, budgetTarget: "73", budgetMax: "70" });
    expect(JSON.stringify(r.ok ? {} : r.errors)).not.toMatch(/73|70/);
  });
});

describe("mapJoinIssues", () => {
  it("maps known paths to fields with our own copy and flags unknown ones", () => {
    const m = mapJoinIssues([{ path: "phone_e164" }, { path: "budget_usd.hard_max" }, { path: "code" }]);
    expect(Object.keys(m.errors).sort()).toEqual(["budgetMax", "phone"]);
    expect(m.rest).toBe(true);
  });
});
