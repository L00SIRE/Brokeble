// QR codes for the desktop hand-off (ux-flow §4.2). `qrSvg` runs on the server only (the page's own URL, rendered at
// build time); `qrcode` is loaded lazily so a client import of `safeQrSvg` never pulls it into the bundle.

const DEFAULT_ORIGIN = "https://tab-web-ten.vercel.app";

/** --color-ink on --color-paper (globals.css). */
export const QR_COLORS = { dark: "#100e0aff", light: "#f6f1e6ff" } as const;

/** Public origin the QR points at: explicit env, else Vercel's production host, else the known production URL. */
export function webOrigin(env: Record<string, string | undefined> = process.env): string {
  const explicit = env.NEXT_PUBLIC_WEB_ORIGIN?.trim();
  if (explicit) return new URL(explicit).origin;
  const vercel = env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  return vercel ? `https://${vercel}` : DEFAULT_ORIGIN;
}

/**
 * SVG for `url`, 200 px with a 1-module quiet zone (the agent's settings, ux-flow §7.2), ink modules drawn on paper
 * (design-system 6.3: "a 168px ink QR … on paper"). Ink on paper is 17.1:1, far above what scanners need, and the
 * quiet zone is paper too, so the code reads as printed on the stub, not pasted on. Only https URLs are encoded: a QR
 * never carries a raw `sms:` URI (ux-flow §0.7).
 */
export async function qrSvg(url: string): Promise<string> {
  if (new URL(url).protocol !== "https:") throw new Error("qrSvg: only https URLs are encoded");
  const { default: QRCode } = await import("qrcode");
  return QRCode.toString(url, { type: "svg", margin: 1, width: 200, errorCorrectionLevel: "M", color: QR_COLORS });
}

/**
 * The agent's `handoff_qr_svg` is inserted as markup, so accept only the exact shape `qrcode` emits: one <svg> root
 * holding <path> elements, with no scripts, event handlers, links or foreign content. Anything else returns null and
 * the page falls back to the number and message as text.
 */
export function safeQrSvg(svg: string | null | undefined): string | null {
  if (!svg || svg.length > 40_000) return null;
  const s = svg.trim();
  if (!/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"[^<>]*>(?:<path [^<>]*\/>)+<\/svg>$/.test(s)) return null;
  if (/\son[a-z]+\s*=|href|javascript:|<script|url\(/i.test(s)) return null;
  return s;
}
