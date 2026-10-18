import { describe, expect, it, vi } from "vitest";
import { copyText, inviteText, shareInvite } from "./share";

const input = { title: "Dinner + show", dateLabel: "Sat, Oct 24 at 7:00 PM", url: "https://tab-web-ten.vercel.app/j/4821" };
const clipboard = (writeText = vi.fn(() => Promise.resolve())) => ({ writeText }) as unknown as Clipboard;

describe("shareInvite", () => {
  it("opens the share sheet with the URL inside the text (iOS copies text, not url)", async () => {
    const share = vi.fn(() => Promise.resolve());
    expect(await shareInvite(input, { share, clipboard: clipboard() })).toBe("shared");
    expect(share).toHaveBeenCalledWith({ title: "Dinner + show", text: "Dinner + show, Sat, Oct 24 at 7:00 PM. Tap to join: https://tab-web-ten.vercel.app/j/4821" });
    expect(inviteText(input)).toContain(input.url);
  });

  it("reports a dismissed sheet as cancelled and other errors as failed", async () => {
    const abort = vi.fn(() => Promise.reject(new DOMException("dismissed", "AbortError")));
    expect(await shareInvite(input, { share: abort, clipboard: clipboard() })).toBe("cancelled");
    const denied = vi.fn(() => Promise.reject(new DOMException("no", "NotAllowedError")));
    expect(await shareInvite(input, { share: denied, clipboard: clipboard() })).toBe("failed");
  });

  it("falls back to copying the bare URL when Web Share is missing", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    expect(await shareInvite(input, { clipboard: clipboard(writeText) })).toBe("copied");
    expect(writeText).toHaveBeenCalledWith(input.url);
  });

  it("fails cleanly when neither share nor clipboard works", async () => {
    expect(await shareInvite(input, {})).toBe("failed");
    expect(await copyText("x", { clipboard: clipboard(vi.fn(() => Promise.reject(new Error("blocked")))) })).toBe("failed");
  });
});
