import type { ReactNode } from "react";

/** A titled console region. Content is composed by the caller (no variant props). */
export function Panel({ title, className = "", children }: { title: string; className?: string; children?: ReactNode }) {
  return (
    <section aria-label={title} className={`flex min-h-0 flex-col gap-3 rounded-xl border border-border bg-surface p-5 ${className}`}>
      <h2 className="text-(length:--text-console-label) font-medium uppercase tracking-wide text-muted">{title}</h2>
      <div className="min-h-0 flex-1 text-(length:--text-console-body)">{children}</div>
    </section>
  );
}

/** Shared empty state for a panel that has no events yet. */
export function Waiting({ children = "Waiting for events" }: { children?: ReactNode }) {
  return <p className="text-muted">{children}</p>;
}
