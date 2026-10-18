import type { Metadata } from "next";
import { Funnel_Display, Funnel_Sans, Martian_Mono } from "next/font/google";
import type { ReactNode } from "react";
import "./globals.css";

// Same families as apps/web (design-system 3.3) so the pay page reads as SquadTab.
const display = Funnel_Display({ subsets: ["latin"], variable: "--font-funnel-display", display: "swap" });
const sans = Funnel_Sans({ subsets: ["latin"], variable: "--font-funnel-sans", display: "swap" });
const mono = Martian_Mono({ subsets: ["latin"], axes: ["wdth"], variable: "--font-martian-mono", display: "swap" });

export const metadata: Metadata = {
  title: "SquadTab Partner Venue (demo merchant)",
  description: "Demo merchant of record for SquadTab. Cybersource sandbox or a labelled simulation; no real charges.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable} ${mono.variable}`}>
      <body className="min-h-dvh bg-[#f6f1e6] text-[#100e0a] antialiased">{children}</body>
    </html>
  );
}
