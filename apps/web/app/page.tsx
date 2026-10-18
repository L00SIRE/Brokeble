import type { Metadata } from "next";
import { SignalHero } from "@/components/brand/SignalHero";
import { StartFlow, StartFlowProvider, type StartMode, StartScreen } from "@/components/flow/StartFlow";
import { qrSvg, webOrigin } from "@/lib/qr";

export const metadata: Metadata = {
  title: "SquadTab · Plan the night in one text",
  description: "SquadTab plans dinner and a show with your friends, keeps everyone's budget private, and nobody fronts the bill.",
};

const SEATS = ["Maya", "Leo", "Sam", "Priya"] as const;

/** ux-flow §10.4 cut line: `SQUADTAB_START_FALLBACK=1` swaps start-by-chat for the 3-field POST /plans form. */
const mode: StartMode = process.env.SQUADTAB_START_FALLBACK === "1" ? "form" : "chat";

export default async function StartPage() {
  // The desktop scan-first QR: this page's own URL, rendered on the server at build time. It costs no seat. A bad
  // NEXT_PUBLIC_WEB_ORIGIN (not https) must not take the landing down: desktops then get the number field directly.
  const scanSvg = await qrSvg(`${webOrigin()}/`).catch((err: unknown) => {
    console.error("landing QR not rendered; check NEXT_PUBLIC_WEB_ORIGIN:", err instanceof Error ? err.message : err);
    return null;
  });
  return (
    <StartFlowProvider mode={mode}>
      <StartScreen hero={<SignalHero price={42} seats={SEATS} stub={<StartFlow scanSvg={scanSvg} />} />} />
    </StartFlowProvider>
  );
}
