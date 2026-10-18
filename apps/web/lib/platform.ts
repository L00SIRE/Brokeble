// Platform detection for the chat-first flow (ux-flow §3.1). Pure; run it client-side only, after mount, so the server
// render and the first client render match (the phone layout renders first).

export type Platform = "ios" | "android" | "mac" | "desktop";

export function detectPlatform(ua: string, maxTouchPoints: number): Platform {
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && maxTouchPoints > 1)) return "ios"; // iPadOS reports Macintosh
  if (/Android/.test(ua)) return "android";
  if (/Macintosh/.test(ua)) return "mac";
  return "desktop";
}

/** Desktop and Mac get the scan-first QR; phones never see a QR (ux-flow §0.7). */
export const isDesktop = (p: Platform): boolean => p === "mac" || p === "desktop";

/** Windows and Linux do nothing with `sms:` links, so they never render one (ux-flow §6). */
export const canOpenMessages = (p: Platform): boolean => p !== "desktop";
