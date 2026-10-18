import type { ReactNode } from "react";

/** Shared mobile-first frame for `/` and `/j/[code]`: 16px gutters, safe-area padding, server-rendered heading. */
export function Shell({ eyebrow, title, lede, children }: { eyebrow?: string; title: string; lede?: string; children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-6 px-4 pb-[max(2rem,env(safe-area-inset-bottom))] pt-[max(2rem,env(safe-area-inset-top))]">
      <header className="flex flex-col gap-3">
        <p className="flex items-center gap-2 text-sm font-semibold tracking-wide text-muted">
          <span aria-hidden className="size-2.5 rounded-full bg-accent" />
          SquadTab
          {eyebrow ? (
            <>
              <span aria-hidden>·</span>
              <span className="font-mono tabular-nums">{eyebrow}</span>
            </>
          ) : null}
        </p>
        <h1 className="text-balance text-(length:--text-title) leading-tight font-semibold">{title}</h1>
        {lede ? <p className="text-pretty text-muted">{lede}</p> : null}
      </header>
      {children}
    </main>
  );
}
