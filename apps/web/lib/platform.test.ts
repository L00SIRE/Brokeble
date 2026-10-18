import { describe, expect, it } from "vitest";
import { canOpenMessages, detectPlatform, isDesktop } from "./platform";

const UA = {
  iphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  ipadOS: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
  android: "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36",
  windows: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
  linux: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
};

describe("detectPlatform", () => {
  it.each([
    ["iPhone", UA.iphone, 5, "ios"],
    ["iPadOS reporting Macintosh with touch", UA.ipadOS, 5, "ios"],
    ["Mac (no touch)", UA.ipadOS, 0, "mac"],
    ["Android", UA.android, 5, "android"],
    ["Windows", UA.windows, 0, "desktop"],
    ["Linux", UA.linux, 0, "desktop"],
  ] as const)("%s → %s", (_name, ua, touch, expected) => {
    expect(detectPlatform(ua, touch)).toBe(expected);
  });

  it("classifies desktop surfaces and where Messages can open", () => {
    expect(isDesktop("mac")).toBe(true);
    expect(isDesktop("desktop")).toBe(true);
    expect(isDesktop("ios")).toBe(false);
    expect(isDesktop("android")).toBe(false);
    expect(canOpenMessages("desktop")).toBe(false);
    expect(canOpenMessages("mac")).toBe(true);
    expect(canOpenMessages("ios")).toBe(true);
  });
});
