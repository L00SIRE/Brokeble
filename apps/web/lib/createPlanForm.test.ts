import { describe, expect, it } from "vitest";
import { localToday, mapCreateIssues, validateCreatePlan } from "./createPlanForm";

const today = "2026-10-17";
const ok = {
  title: " Saturday dinner ",
  area: "Santa Monica",
  date: "2026-10-18",
  timeStart: "18:00",
  timeEnd: "22:00",
  partyTarget: "4",
  firstName: "Maya",
  phone: "(310) 555-0123",
};

describe("validateCreatePlan", () => {
  it("builds the CreatePlanBody wire shape", () => {
    expect(validateCreatePlan(ok, today)).toEqual({
      ok: true,
      body: {
        title: "Saturday dinner",
        area: "Santa Monica",
        date: "2026-10-18",
        time_start: "18:00",
        time_end: "22:00",
        party_target: 4,
        organizer: { phone_e164: "+13105550123", first_name: "Maya" },
      },
    });
  });

  it("allows today but not the past", () => {
    expect(validateCreatePlan({ ...ok, date: today }, today).ok).toBe(true);
    expect(validateCreatePlan({ ...ok, date: "2026-10-16" }, today).ok).toBe(false);
    expect(validateCreatePlan({ ...ok, date: "" }, today).ok).toBe(false);
  });

  it("requires the end after the start", () => {
    expect(validateCreatePlan({ ...ok, timeEnd: "18:00" }, today)).toMatchObject({ ok: false, errors: { timeEnd: expect.any(String) } });
    expect(validateCreatePlan({ ...ok, timeStart: "" }, today)).toMatchObject({ ok: false, errors: { timeStart: expect.any(String) } });
  });

  it.each(["1", "9", "", "x", "44"])("rejects party size %j", (partyTarget) =>
    expect(validateCreatePlan({ ...ok, partyTarget }, today).ok).toBe(false),
  );

  it("enforces text lengths", () => {
    expect(validateCreatePlan({ ...ok, title: "x".repeat(81) }, today).ok).toBe(false);
    expect(validateCreatePlan({ ...ok, area: "a" }, today).ok).toBe(false);
    expect(validateCreatePlan({ ...ok, firstName: " " }, today).ok).toBe(false);
    expect(validateCreatePlan({ ...ok, phone: "12" }, today).ok).toBe(false);
  });
});

describe("helpers", () => {
  it("maps server paths", () => {
    const m = mapCreateIssues([{ path: "organizer.phone_e164" }, { path: "time_end" }, { path: "nope" }]);
    expect(Object.keys(m.errors).sort()).toEqual(["phone", "timeEnd"]);
    expect(m.rest).toBe(true);
  });

  it("formats local today as ISO", () => {
    expect(localToday(new Date(2026, 9, 17, 23, 30))).toBe("2026-10-17");
  });
});
