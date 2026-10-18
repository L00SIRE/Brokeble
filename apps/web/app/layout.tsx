import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Tab",
  description: "Group plans that book themselves, without anyone fronting the bill.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#0b0f14" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
