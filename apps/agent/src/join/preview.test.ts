import { describe, expect, it, vi } from "vitest";
import type { PlanRow } from "../repo/types";

const m = vi.hoisted(() => ({ countByStage: vi.fn(), getUser: vi.fn() }));
vi.mock("../repo/participants", () => ({ countByStage: m.countByStage }));
vi.mock("../repo/users", () => ({ getUser: m.getUser }));

const { buildPlanPreview, countsFrom, previewStatus, publicFirstName, timeLabel } = await import("./preview");

describe("countsFrom", () => {
  it("joined = stage ≥ JOINED; seated includes INVITED; DECLINED and RELEASED count for neither", () => {
    expect(countsFrom({})).toEqual({ joined: 0, seated: 0 });
    expect(countsFrom({ INVITED: 2, JOINED: 1, BUDGET_LOCKED: 1, PREFS_DONE: 1, CAPTURED: 1, DECLINED: 3, RELEASED: 2 })).toEqual({ joined: 4, seated: 6 });
  });
});

describe("timeLabel", () => {
  it.each([["19:00", "7:00 PM"], ["00:05", "12:05 AM"], ["12:30", "12:30 PM"], ["23:59", "11:59 PM"]])("%s → %s", (hhmm, label) => {
    expect(timeLabel(hhmm)).toBe(label);
  });
  it("throws on a malformed time", () => expect(() => timeLabel("7pm")).toThrow(RangeError));
});

describe("previewStatus", () => {
  it("open below 8 seated in a joinable state, full at 8, closed otherwise", () => {
    expect(previewStatus("COLLECTING", 7)).toBe("open");
    expect(previewStatus("VOTING", 8)).toBe("full");
    expect(previewStatus("ORDERING", 1)).toBe("closed");
    expect(previewStatus("CANCELLED", 1)).toBe("closed");
  });
});

describe("publicFirstName", () => {
  it("hides unknown and scrubbed names", () => {
    expect([publicFirstName("Maya"), publicFirstName(""), publicFirstName("(removed)"), publicFirstName(undefined)]).toEqual(["Maya", null, null, null]);
  });
});

describe("buildPlanPreview", () => {
  it("returns exactly the whitelisted keys, never the plan's ids, refs, state or other members", async () => {
    m.countByStage.mockResolvedValue({ JOINED: 2 });
    m.getUser.mockResolvedValue({ first_name: "Maya", phone_e164: "+14155550100", payer_ref: "abc" });
    const plan = {
      id: "p", ref: "secret-ref", code: "4821", state: "COLLECTING", title: "Dinner + show", area: "Santa Monica", event_date: "2026-10-24",
      time_start: "19:00", time_end: "23:00", party_target: 4, organizer_id: "o", venue_order_id: "vo", chosen_bundle_id: "b",
    } as unknown as PlanRow;
    const out = await buildPlanPreview(plan);
    expect(out).toEqual({ code: "4821", title: "Dinner + show", date_label: "Sat, Oct 24", time_label: "7:00 PM", area: "Santa Monica", organizer_first_name: "Maya", joined: 2, party_target: 4, status: "open" });
    expect(JSON.stringify(out)).not.toMatch(/secret-ref|\+1415|abc|vo/);
  });

  it("organizer_first_name is null with no organizer, without a lookup", async () => {
    m.getUser.mockClear();
    m.countByStage.mockResolvedValue({});
    const out = await buildPlanPreview({ code: "1234", state: "COLLECTING", title: "t", area: "a", event_date: "2026-10-24", time_start: "19:00", party_target: 3, organizer_id: null } as unknown as PlanRow);
    expect(out.organizer_first_name).toBeNull();
    expect(m.getUser).not.toHaveBeenCalled();
  });
});
