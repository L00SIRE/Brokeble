import type { Metadata } from "next";
import { JoinForm } from "@/components/join/JoinForm";
import { Shell } from "@/components/join/Shell";
import { Notice } from "@/components/join/ui";

const CODE = /^\d{4}$/;

// Invite links are private: keep them out of search results and referrers.
export async function generateMetadata({ params }: PageProps<"/j/[code]">): Promise<Metadata> {
  const { code } = await params;
  return { title: CODE.test(code) ? `Join plan ${code} · Tab` : "Join a plan · Tab", robots: { index: false, follow: false }, referrer: "no-referrer" };
}

export default async function JoinPage({ params }: PageProps<"/j/[code]">) {
  const { code } = await params;
  if (!CODE.test(code)) {
    return (
      <Shell title="Join a plan">
        <Notice tone="error" title="That code doesn't match a plan">
          <p className="text-muted">Check the link your organizer sent you.</p>
        </Notice>
      </Shell>
    );
  }
  return (
    <Shell eyebrow={code} title="You're invited to a plan" lede="Add your number, text Tab once, and Tab handles the rest. Your budget stays private.">
      <JoinForm code={code} />
    </Shell>
  );
}
