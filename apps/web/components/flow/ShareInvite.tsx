"use client";

// "Send invite to your group" (ux-flow §3.5, design-system 6.3): the native share sheet first, copy as the fallback,
// and the URL as a real link if both fail. A link is never copy-only.
import { createContext, use, useRef, useState } from "react";
import { DotIcon } from "@/components/brand/DotIcon";
import { CopyButton } from "@/components/join/CopyButton";
import type { PlanPreview } from "@/lib/agentSchemas";
import { copyText, type ShareResult, shareInvite } from "@/lib/share";
import { primaryButton, textButton } from "./classes";

type Result = ShareResult | "idle";

const ANNOUNCE: Record<Result, string> = {
  idle: "",
  shared: "Invite shared.",
  copied: "Invite link copied. Paste it in your group chat.",
  cancelled: "",
  failed: "Couldn’t open the share sheet. Here’s the link.",
};

/** Only an http(s) URL from the agent ever becomes a link. */
const isWebUrl = (u: string) => /^https?:\/\/[^\s"<>]+$/.test(u);

/**
 * The line under the share actions. A chat-started plan also gets the link by text; the POST /plans fallback texts
 * no link, so StartFlowProvider overrides it there.
 */
export const ShareNoteContext = createContext("SquadTab texted you the link too.");

export function ShareInvite({ plan, note }: { plan: Pick<PlanPreview, "title" | "date_label" | "time_label"> & { join_url: string }; note?: string }) {
  const contextNote = use(ShareNoteContext);
  const [result, setResult] = useState<Result>("idle");
  // The share sheet can resolve after a later "Copy link instead": only the latest action's result is shown.
  const latest = useRef(0);
  const run = async (action: () => Promise<Result>) => {
    const id = ++latest.current;
    const r = await action();
    if (id === latest.current) setResult(r);
  };
  const url = isWebUrl(plan.join_url) ? plan.join_url : null;
  if (!url) return null;
  const input = { title: plan.title, dateLabel: `${plan.date_label} at ${plan.time_label}`, url };

  return (
    <div className="grid gap-1.5">
      {/* Called straight from the click: navigator.share needs the user gesture. */}
      <button type="button" className={primaryButton} onClick={() => run(() => shareInvite(input))}>
        <DotIcon name="share" color="var(--btn-fg)" className="size-5" />
        Send invite to your group
      </button>
      <button type="button" className={`${textButton} justify-self-center`} onClick={() => run(() => copyText(url))}>
        {result === "copied" ? "Link copied" : "Copy link instead"}
      </button>
      {result === "failed" ? (
        <div className="flex items-center justify-between gap-3 rounded-control border-2 border-current px-3.5 py-2.5">
          <a href={url} className="mono min-w-0 text-[14px] break-all underline underline-offset-4">
            {url}
          </a>
          <CopyButton value={url} what="invite link" />
        </div>
      ) : null}
      <p className="text-center text-[15px] text-muted">{note ?? contextNote}</p>
      <p role="status" className="sr-only">
        {ANNOUNCE[result]}
      </p>
    </div>
  );
}
