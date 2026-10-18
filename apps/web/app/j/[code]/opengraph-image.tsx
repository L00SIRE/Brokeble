// Per-plan link preview (ux-flow §4.6; design-system §1, §6.4). This is what a friend sees in the group chat before
// they tap. It shows title, date, time, area and "{Maya} is planning", never a budget, a count or a friend's name.
// Apple TN2444: one page-specific image, minimal text, large type.
import { ImageResponse } from "next/og";
import { CODE_RE, fetchPlanPreview, planMeta } from "@/lib/joinForm";

export const alt = "A SquadTab plan invite";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const SODIUM = "#FFB224";
const INK = "#100E0A";
const PAPER = "#F6F1E6";
const NIGHT_2 = "#A39C8C";
const ON_PAPER_2 = "#6B6355";
const STUB = 300;

type Font = { name: string; data: ArrayBuffer; weight: 400 | 600 | 800; style: "normal" };

/**
 * Google Fonts serves TTF to a client without a browser user agent, and `text=` subsets it to just these glyphs, which
 * keeps each font a few KB. Any failure returns null and the image falls back to next/og's bundled font.
 */
async function googleFont(family: string, weight: Font["weight"], text: string): Promise<Font | null> {
  try {
    const css = await fetch(`https://fonts.googleapis.com/css2?family=${family}:wght@${weight}&text=${encodeURIComponent(text)}`, {
      cache: "force-cache",
      signal: AbortSignal.timeout(3000),
    }).then((r) => (r.ok ? r.text() : ""));
    const src = /src: url\((.+?)\) format\('(?:opentype|truetype)'\)/.exec(css)?.[1];
    if (!src) return null;
    const res = await fetch(src, { cache: "force-cache", signal: AbortSignal.timeout(3000) });
    return res.ok ? { name: family.replace(/\+/g, " "), data: await res.arrayBuffer(), weight, style: "normal" } : null;
  } catch {
    return null;
  }
}

export default async function Image({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const preview = CODE_RE.test(code) ? await fetchPlanPreview(code) : null;
  const plan = preview?.kind === "ok" ? preview.plan : null;

  const eyebrow = plan ? (plan.organizer_first_name ? `${plan.organizer_first_name} is planning` : "You’re invited") : "squadtab";
  const title = plan?.title ?? "Plan the night in one text.";
  const meta = plan ? planMeta(plan) : "Dinner and a show, nobody fronts the bill";
  const stubTitle = plan ? "Tap to join" : "Tap to start";

  const [display, sans, mono] = await Promise.all([
    googleFont("Funnel+Display", 800, `${title}${stubTitle}squadtab`),
    googleFont("Funnel+Sans", 600, `${eyebrow}Your seat`),
    googleFont("Martian+Mono", 400, meta),
  ]);
  const fonts = [display, sans, mono].filter((f): f is Font => f !== null);
  const family = (f: Font | null, fallback: string) => (f ? f.name : fallback);

  // Long titles step down so they stay on two lines inside the ticket.
  const titleSize = title.length > 34 ? 76 : title.length > 20 ? 96 : 124;

  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", background: SODIUM, padding: 56 }}>
      {/* The ticket: ink main part, perforation with two notches, paper stub (design-system §6.4). */}
      <div style={{ display: "flex", flex: 1, position: "relative" }}>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            flex: 1,
            background: INK,
            color: PAPER,
            borderRadius: "28px 0 0 28px",
            padding: "52px 56px 48px",
          }}
        >
          <div style={{ display: "flex", fontFamily: family(sans, "sans-serif"), fontWeight: 600, fontSize: 36, color: SODIUM }}>{eyebrow}</div>
          <div
            style={{
              display: "flex",
              fontFamily: family(display, "sans-serif"),
              fontWeight: 800,
              fontSize: titleSize,
              lineHeight: 0.92,
              letterSpacing: "-0.05em",
            }}
          >
            {title}
          </div>
          <div style={{ display: "flex", fontFamily: family(mono, "monospace"), fontSize: 22, lineHeight: 1.4, color: NIGHT_2 }}>{meta}</div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", alignItems: "center", width: 30, background: INK, padding: "34px 0" }}>
          {Array.from({ length: 13 }, (_, i) => (
            <div key={i} style={{ width: 10, height: 10, borderRadius: 5, background: SODIUM }} />
          ))}
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            width: STUB,
            background: PAPER,
            color: INK,
            borderRadius: "0 28px 28px 0",
            padding: "52px 44px 48px",
          }}
        >
          <div style={{ display: "flex", fontFamily: family(sans, "sans-serif"), fontWeight: 600, fontSize: 28, color: ON_PAPER_2 }}>Your seat</div>
          <div style={{ display: "flex", fontFamily: family(display, "sans-serif"), fontWeight: 800, fontSize: 64, lineHeight: 0.95, letterSpacing: "-0.045em" }}>
            {stubTitle}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <Wordmark />
            <div style={{ display: "flex", fontFamily: family(display, "sans-serif"), fontWeight: 800, fontSize: 34, letterSpacing: "-0.045em" }}>squadtab</div>
          </div>
        </div>

        {/* Notches: ground-colored half circles punched at the perforation, top and bottom. */}
        <div style={{ position: "absolute", top: -30, right: STUB - 15, width: 60, height: 60, borderRadius: 30, background: SODIUM }} />
        <div style={{ position: "absolute", bottom: -30, right: STUB - 15, width: 60, height: 60, borderRadius: 30, background: SODIUM }} />
      </div>
    </div>,
    { ...size, fonts },
  );
}

/** The ticket wordmark (design-system §6.6), same path as the prototype's `#wm` symbol. */
function Wordmark() {
  return (
    <svg width="45" height="30" viewBox="0 0 24 16">
      <path
        fill={INK}
        fillRule="evenodd"
        d="M2 1H22A2 2 0 0 1 24 3V5.4A2.6 2.6 0 0 0 24 10.6V13A2 2 0 0 1 22 15H2A2 2 0 0 1 0 13V10.6A2.6 2.6 0 0 0 0 5.4V3A2 2 0 0 1 2 1ZM17 3.5a1 1 0 1 0 0 2a1 1 0 1 0 0-2ZM17 7a1 1 0 1 0 0 2a1 1 0 1 0 0-2ZM17 10.5a1 1 0 1 0 0 2a1 1 0 1 0 0-2Z"
      />
    </svg>
  );
}
