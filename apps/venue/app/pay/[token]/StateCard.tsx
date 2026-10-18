import type { ReactNode } from "react";

export const money = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);

export const clock = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number) as [number, number];
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
};

export function Shell({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col px-4 py-8">
      <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">Tab Partner Venue · sandbox merchant of record</p>
      {children}
    </main>
  );
}

export function StateCard({ title, body, tone = "neutral", children }: { title: string; body?: string; tone?: "neutral" | "good" | "bad"; children?: ReactNode }) {
  const ring = tone === "good" ? "border-emerald-300 bg-emerald-50" : tone === "bad" ? "border-red-300 bg-red-50" : "border-neutral-200 bg-neutral-50";
  return (
    <section aria-live="polite" className={`mt-6 rounded-2xl border p-5 ${ring}`}>
      <h1 className="text-xl font-semibold text-balance">{title}</h1>
      {body ? <p className="mt-2 text-neutral-700 text-pretty">{body}</p> : null}
      {children}
    </section>
  );
}
