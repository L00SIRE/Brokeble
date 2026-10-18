import { describe, expect, it } from "vitest";
import { containsCardNumber, luhnValid } from "../src/router/luhn";
import { normalizeCommandText, parseCommand, parseDigitsBallot, parseTier, parseYesNo } from "../src/router/commands";

describe("luhn", () => {
  it("validates checksums", () => {
    expect(luhnValid("4111111111111111")).toBe(true);
    expect(luhnValid("4111111111111112")).toBe(false);
    expect(luhnValid("")).toBe(false);
    expect(luhnValid("41x1")).toBe(false);
  });

  it.each([
    ["4111 1111 1111 1111", true],
    ["4111-1111-1111-1111", true],
    ["4111111111111111", true],
    ["my card is 4242 4242 4242 4242 thanks", true],
    ["378282246310005", true], // 15-digit amex
    ["call 3105551234 then 4111 1111 1111 1111", true], // card after a phone number
    ["4111-1111-1111-1112", false],
    ["411111111111", false], // 12 digits
    ["call me at 3105551234", false],
    ["join 1234", false],
    ["I'd say 7 or 8 pm", false],
    ["", false],
  ])("containsCardNumber(%j) = %s", (text, expected) => {
    expect(containsCardNumber(text)).toBe(expected);
  });
});

describe("commands", () => {
  it("normalizes", () => {
    expect(normalizeCommandText("  I’M   OUT ")).toBe("i'm out");
  });

  it.each([
    ["JOIN 4821", { kind: "join", code: "4821" }],
    ["join   4821", { kind: "join", code: "4821" }],
    ["help", { kind: "help" }],
    ["?", { kind: "help" }],
    ["Status", { kind: "status" }],
    ["I’m out", { kind: "out" }],
    ["im out", { kind: "out" }],
    ["I am out.", { kind: "out" }],
    ["STOP", { kind: "out" }],
    ["leave", { kind: "out" }],
    ["receipt", { kind: "receipts" }],
    ["Receipts", { kind: "receipts" }],
    ["remove card", { kind: "remove_card" }],
    ["forget me", { kind: "forget_me" }],
    ["cancel plan", { kind: "cancel_plan" }],
    ["GO", { kind: "go" }],
    ["wait", { kind: "wait" }],
    ["change   budget", { kind: "change_budget" }],
  ])("parseCommand(%j)", (text, expected) => {
    expect(parseCommand(text)).toEqual(expected);
  });

  it.each(["join 12", "join 12345", "join", "I'm out of the loop", "go home", "what's my status", "yes", "2", "cancel", ""])(
    "parseCommand(%j) is null",
    (text) => {
      expect(parseCommand(text)).toBeNull();
    },
  );

  it("parses new plan / start over / start fresh", () => {
    for (const t of ["new plan", "New plan!", "start over", "Start Fresh.", "  start   over "]) expect(parseCommand(t)).toEqual({ kind: "new_plan" });
    for (const t of ["new plan for saturday", "start", "fresh start", "plan"]) expect(parseCommand(t)?.kind).not.toBe("new_plan");
  });

  it("parses digit ballots", () => {
    expect(parseDigitsBallot("1 3")).toEqual([1, 3]);
    expect(parseDigitsBallot(" 2 ")).toEqual([2]);
    expect(parseDigitsBallot("3, 1,3")).toEqual([3, 1]);
    expect(parseDigitsBallot("1 1")).toEqual([1]);
    for (const t of ["4", "0 1", "1 4", "one", "1 and 2", "", "1,"]) expect(parseDigitsBallot(t)).toBeNull();
  });

  it("parses yes/no and tiers", () => {
    for (const t of ["y", "Yes", "YEAH", "yep", "ok", "Yes!"]) expect(parseYesNo(t)).toBe("yes");
    for (const t of ["n", "No", "nope", "no."]) expect(parseYesNo(t)).toBe("no");
    for (const t of ["maybe", "yes please", ""]) expect(parseYesNo(t)).toBeNull();
    expect([1, 2, 3, 4].map((n) => parseTier(` ${n} `))).toEqual([1, 2, 3, 4]);
    for (const t of ["0", "5", "12", "a"]) expect(parseTier(t)).toBeNull();
  });
});
