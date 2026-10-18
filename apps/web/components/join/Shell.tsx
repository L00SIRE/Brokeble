import type { ReactNode } from "react";
import { Wordmark } from "@/components/brand/Wordmark";

/**
 * Shared mobile-first frame for the one-task pages (`/j/[code]`, organizer plan-ready, hand-off, "you're in").
 * Paper ground by default (design-system 1); `ground="ink"` for "you're in". The ground remaps the legacy color
 * aliases, so `text-muted` and friends stay legible on either. Safe-area padding on all sides (viewport-fit=cover).
 * `title` renders the page's h1; omit it only when the content supplies its own h1 (e.g. `<PlanTicket titleAs="h1">`).
 */
export function Shell({
  eyebrow,
  title,
  lede,
  ground = "paper",
  children,
}: {
  eyebrow?: string;
  title?: ReactNode;
  lede?: ReactNode;
  ground?: "paper" | "ink";
  children: ReactNode;
}) {
  return (
    <div data-ground={ground} className="min-h-dvh">
      <main className="mx-auto flex min-h-dvh w-full max-w-[440px] flex-col gap-[22px] pt-[max(22px,env(safe-area-inset-top))] pr-[max(22px,env(safe-area-inset-right))] pb-[max(22px,env(safe-area-inset-bottom))] pl-[max(22px,env(safe-area-inset-left))]">
        <header className="flex items-center justify-between gap-3">
          <Wordmark className="text-[19px]" />
          {eyebrow ? <span className="mono text-[12.5px] text-muted">{eyebrow}</span> : null}
        </header>
        {title || lede ? (
          <div className="flex flex-col gap-3">
            {title ? (
              <h1 className="font-display text-[38px] leading-[.95] font-[760] tracking-[-.05em] text-balance">{title}</h1>
            ) : null}
            {lede ? <p className="text-pretty text-muted">{lede}</p> : null}
          </div>
        ) : null}
        {children}
      </main>
    </div>
  );
}
