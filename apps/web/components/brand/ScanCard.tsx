import type { ReactNode } from "react";

/**
 * Defense in depth for the injected QR markup. `svg` must come from our own server code (`lib/qr.ts`, qrcode@1.5.4),
 * never from a request, but a malformed or hostile string still never reaches the DOM.
 */
const UNSAFE_SVG = /<\s*(script|foreignObject|iframe|image|use|a)\b|\son[a-z]+\s*=|javascript:|data:|href\s*=/i;
export function isSafeQrSvg(svg: string): boolean {
  const s = svg.trim();
  return /^<svg[\s>]/i.test(s) && /<\/svg>$/i.test(s) && !UNSAFE_SVG.test(s);
}

/**
 * Desktop stub, scan first (design-system 6.3, ux-flow 4.2). Presentational: W1's DesktopScan passes the
 * server-rendered QR of the page's own URL. Children go last, pinned to the stub's foot: the
 * `<ScanCard.More>` number fallback.
 */
function ScanCardRoot({
  title,
  svg,
  body,
  kicker = "Your seat",
  qrLabel = "QR code that opens this page on your iPhone",
  children,
}: {
  title: string;
  svg: string;
  body: ReactNode;
  kicker?: string;
  qrLabel?: string;
  children?: ReactNode;
}) {
  const safe = isSafeQrSvg(svg);
  return (
    <>
      <p className="stub-kicker">{kicker}</p>
      <h2 className="stub-title">{title}</h2>
      <div className="scan">
        {safe ? (
          <div className="scan-qr" role="img" aria-label={qrLabel} dangerouslySetInnerHTML={{ __html: svg }} />
        ) : (
          <div className="scan-qr" aria-hidden="true" />
        )}
        <p>{body}</p>
      </div>
      {children}
    </>
  );
}

/** "Or enter your number here": a native disclosure holding the one phone field (keyboard and screen-reader friendly). */
function ScanCardMore({ summary = "Or enter your number here", children }: { summary?: string; children: ReactNode }) {
  return (
    <details className="or-number">
      <summary>{summary}</summary>
      <div>{children}</div>
    </details>
  );
}

export const ScanCard = Object.assign(ScanCardRoot, { More: ScanCardMore });
