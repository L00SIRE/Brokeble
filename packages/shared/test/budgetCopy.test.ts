import { describe, expect, it } from "vitest";
import { COPY } from "../src/index";

describe("budget copy frames the number as dinner + show tickets, all-in per person", () => {
  it.each(["T_BUDGET_ASK", "T_BUDGET_ASK_NAMED", "T_BUDGET_REASK"] as const)("%s", (id) => {
    expect(COPY[id]).toMatch(/dinner \+ show tickets/);
    expect(COPY[id]).toMatch(/all-in per person/);
  });
  it("ask templates keep the privacy promise", () => {
    expect(COPY.T_BUDGET_ASK).toContain("Nobody in the group, and no other agent, ever sees it.");
    expect(COPY.T_BUDGET_ASK_NAMED).toMatch(/^Nice to meet you, \{name\}\./);
  });
  it("tier menu has no dinner-only tier", () => {
    expect(COPY.T_BUDGET_TIERS).toContain("1 (under $50), 2 ($50–80), 3 ($80–120) or 4 (no cap)");
    expect(COPY.T_BUDGET_TIERS).not.toContain("$25");
  });
});
