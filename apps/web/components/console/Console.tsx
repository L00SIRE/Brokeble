"use client";

import type { ReactNode } from "react";
import { useEventStream } from "@/lib/useEventStream";

function Region({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <section aria-label={title} className="flex min-h-0 flex-col gap-3 rounded-xl border border-border bg-surface p-5">
      <h2 className="text-(length:--text-console-label) font-medium uppercase tracking-wide text-muted">{title}</h2>
      <div className="min-h-0 flex-1 text-(length:--text-console-body) text-muted">{children}</div>
    </section>
  );
}

export function Console({ consoleKey }: { consoleKey: string | null }) {
  const { status, invalidCount } = useEventStream(consoleKey, () => {
    // B's consoleReducer plugs in here.
  });

  return (
    <main className="grid h-dvh grid-rows-[auto_1fr_auto] gap-4 p-4 tabular-nums">
      <header className="flex items-baseline justify-between">
        <h1 className="text-(length:--text-console-key) font-semibold">Tab Trust Console</h1>
        <p role="status" className="font-mono text-(length:--text-console-label) text-muted">
          {consoleKey ? status : "missing key"}
          {invalidCount > 0 ? ` · ${invalidCount} invalid` : ""}
        </p>
      </header>
      <div className="grid min-h-0 grid-cols-[1fr_1.4fr_1fr] gap-4">
        <Region title="Lanes" />
        <div className="grid min-h-0 grid-rows-2 gap-4">
          <Region title="X-ray" />
          <Region title="CREAO" />
        </div>
        <div className="grid min-h-0 grid-rows-2 gap-4">
          <Region title="TAP" />
          <Region title="Ledger" />
        </div>
      </div>
      <footer className="font-mono text-(length:--text-console-label) text-muted">Delivery and system messages</footer>
    </main>
  );
}
