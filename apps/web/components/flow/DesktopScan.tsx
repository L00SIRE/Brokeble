// Desktop before any submit (ux-flow §4.2, design-system 6.3): the primary element is a QR of the page's own URL. It
// costs no seat and asks for nothing; the phone continues with the normal phone flow. The single phone field stays
// available as a secondary disclosure.
import type { ReactNode } from "react";
import { ScanCard } from "@/components/brand/ScanCard";

export function DesktopScan({
  svg,
  title = "Scan to start on your iPhone",
  qrLabel = "QR code that opens this page on your iPhone",
  children,
}: {
  /** Server-rendered by lib/qr.ts from the page's own absolute URL. */
  svg: string;
  /** "Scan to join on your iPhone" on /j/[code]. */
  title?: string;
  qrLabel?: string;
  /** The phone step, shown inside "Or enter your number here". */
  children: ReactNode;
}) {
  return (
    <ScanCard
      title={title}
      svg={svg}
      qrLabel={qrLabel}
      body={
        <>
          <b>Point your camera here.</b> Messages opens with your first text ready. Nothing to fill in.
        </>
      }
    >
      {/* PhoneField opens this disclosure itself after "Wrong number? Fix it", so the prefilled number is visible. */}
      <ScanCard.More>{children}</ScanCard.More>
    </ScanCard>
  );
}
