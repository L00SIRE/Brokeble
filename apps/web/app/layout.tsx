import type { Metadata, Viewport } from "next";
import { Funnel_Display, Funnel_Sans, Martian_Mono } from "next/font/google";
import type { ReactNode } from "react";
import { BrandSymbols } from "@/components/brand/Wordmark";
import { MotionProvider } from "@/lib/motion/MotionProvider";
import { webOrigin } from "@/lib/qr";
import "./globals.css";

// Variable fonts: no weight list needed. Martian Mono adds the `wdth` axis (87.5 for UI, 75 for tracks; design-system 3.3).
const display = Funnel_Display({ subsets: ["latin"], variable: "--font-funnel-display", display: "swap" });
const sans = Funnel_Sans({ subsets: ["latin"], variable: "--font-funnel-sans", display: "swap" });
const mono = Martian_Mono({ subsets: ["latin"], axes: ["wdth"], variable: "--font-martian-mono", display: "swap" });

export const metadata: Metadata = {
  // Absolute og:image URLs for the /j/[code] link preview (iMessage needs them). Same origin as the scan QR.
  metadataBase: new URL(webOrigin()),
  title: "SquadTab",
  description: "Group plans that book themselves, without anyone fronting the bill.",
};

// Sodium: the landing field and the brand. Ink pages still read correctly under a sodium browser bar.
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#FFB224" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable} ${mono.variable}`}>
      <body className="min-h-dvh">
        <BrandSymbols />
        <MotionProvider>{children}</MotionProvider>
      </body>
    </html>
  );
}
