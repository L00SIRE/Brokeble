import { describe, expect, it } from "vitest";
import { displayNumber, encodeBody, isLinkableNumber, smsHref } from "./sms";

const N = "+12135550147";

describe("smsHref", () => {
  it("uses &body= on iOS and macOS", () => {
    expect(smsHref(N, "Hey SquadTab! Help me plan a night out.", "ios")).toBe("sms:+12135550147&body=Hey%20SquadTab%21%20Help%20me%20plan%20a%20night%20out.");
    expect(smsHref(N, "hi", "mac")).toBe("sms:+12135550147&body=hi");
  });

  it("uses RFC 5724 ?body= on Android", () => {
    expect(smsHref(N, "hi", "android")).toBe("sms:+12135550147?body=hi");
  });

  it("encodes apostrophes, exclamation marks and parentheses (encodeURIComponent leaves them)", () => {
    expect(smsHref(N, "I'm in for Dinner + show!", "ios")).toBe("sms:+12135550147&body=I%27m%20in%20for%20Dinner%20%2B%20show%21");
    expect(encodeBody("(a)*")).toBe("%28a%29%2A");
    expect(decodeURIComponent(encodeBody("I'm in! ✓ & more"))).toBe("I'm in! ✓ & more");
  });

  it("never renders a link on Windows/Linux or for a number that isn't plain E.164", () => {
    expect(smsHref(N, "hi", "desktop")).toBeNull();
    for (const bad of ["2135550147", "+1 213 555 0147", "+1234567", "+1234567890123456", "javascript:alert(1)", "+1213555014x", ""]) {
      expect(isLinkableNumber(bad)).toBe(false);
      expect(smsHref(bad, "hi", "ios")).toBeNull();
    }
  });
});

describe("displayNumber", () => {
  it("formats US numbers and passes others through", () => {
    expect(displayNumber(N)).toBe("(213) 555-0147");
    expect(displayNumber("+447700900123")).toBe("+447700900123");
  });
});
