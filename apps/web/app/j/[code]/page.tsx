// /j/[code]: the friend's invite (ux-flow §4.4, §9.2). Server-rendered from GET /plans/:code so the page shows the
// real plan before any JavaScript runs; if the agent is unreachable it falls back to a generic header and the form
// still works. The desktop scan-first QR encodes this page's own URL and costs no seat.
import type { Metadata } from "next";
import { cache } from "react";
import { InviteFlow } from "@/components/flow/InviteFlow";
import { CODE_RE, fetchPlanPreview, planMeta, type PreviewResult } from "@/lib/joinForm";
import { qrSvg, webOrigin } from "@/lib/qr";

// One preview per request, shared by generateMetadata and the page.
const getPreview = cache((code: string): Promise<PreviewResult> => (CODE_RE.test(code) ? fetchPlanPreview(code) : Promise.resolve({ kind: "not_found" })));

// Invite links are private: out of search results, and the code never leaks through a Referer header.
const PRIVATE = { robots: { index: false, follow: false }, referrer: "no-referrer" } satisfies Metadata;

export async function generateMetadata({ params }: PageProps<"/j/[code]">): Promise<Metadata> {
  const { code } = await params;
  const p = await getPreview(code);
  if (p.kind !== "ok") return { ...PRIVATE, title: "Join a plan · SquadTab", description: "Plan the night in one text. Nobody fronts the bill." };
  const { plan } = p;
  const title = plan.organizer_first_name ? `${plan.organizer_first_name} invited you: ${plan.title}` : `You’re invited: ${plan.title}`;
  const description = planMeta(plan);
  return { ...PRIVATE, title, description, openGraph: { title, description, siteName: "SquadTab", type: "website" } };
}

export default async function InvitePage({ params }: PageProps<"/j/[code]">) {
  const { code } = await params;
  const [preview, scanSvg] = await Promise.all([
    getPreview(code),
    CODE_RE.test(code) ? qrSvg(`${webOrigin()}/j/${code}`).catch(() => null) : Promise.resolve(null),
  ]);
  return <InviteFlow code={code} preview={preview} scanSvg={scanSvg} />;
}
