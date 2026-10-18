// /t/[token]: the phone side of the desktop hand-off QR (ux-flow §4.5). The token is a bearer capability for one
// person's status, so the page is never indexed and never sends a Referer. Everything else happens client-side from
// GET /status: the token is never fetched or logged by the Next server.
import type { Metadata } from "next";
import { TokenHandoff } from "@/components/flow/InviteFlow";

export const metadata: Metadata = {
  title: "Continue in Messages · SquadTab",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function HandoffPage({ params }: PageProps<"/t/[token]">) {
  const { token } = await params;
  return <TokenHandoff token={token} />;
}
