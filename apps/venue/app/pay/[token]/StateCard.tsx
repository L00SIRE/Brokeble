import type { ReactNode } from "react";

export const money = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);

export const clock = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number) as [number, number];
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
};

// The SquadTab ticket mark (apps/web components/brand/icons.ts TICKET_PATH).
const TICKET_PATH =
  "M2 1H22A2 2 0 0 1 24 3V5.4A2.6 2.6 0 0 0 24 10.6V13A2 2 0 0 1 22 15H2A2 2 0 0 1 0 13V10.6A2.6 2.6 0 0 0 0 5.4V3A2 2 0 0 1 2 1Z" +
  "M17 3.5a1 1 0 1 0 0 2a1 1 0 1 0 0-2ZM17 7a1 1 0 1 0 0 2a1 1 0 1 0 0-2ZM17 10.5a1 1 0 1 0 0 2a1 1 0 1 0 0-2Z";

export function Wordmark() {
  return (
    <span className="wordmark" translate="no">
      <svg viewBox="0 0 24 16" aria-hidden="true" focusable="false"><path fill="currentColor" fillRule="evenodd" d={TICKET_PATH} /></svg>
      squadtab
    </span>
  );
}

export const day = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

export function Shell({ children, source }: { children: ReactNode; source: string }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col px-5 pb-10 pt-8">
      <Wordmark />
      <p className="mono mt-2 text-[11px] uppercase tracking-wide text-[#6b6355]">Partner venue (demo) · {source}</p>
      {children}
    </main>
  );
}

export function StateCard({ title, body, tone = "neutral", children }: { title: string; body?: string; tone?: "neutral" | "good" | "bad"; children?: ReactNode }) {
  const look =
    tone === "good" ? "bg-[#ffb224] text-[#100e0a]" : tone === "bad" ? "border-2 border-dashed border-[#100e0a] bg-[#ede6d6]" : "bg-[#ede6d6]";
  return (
    <section aria-live="polite" className={`mt-6 rounded-[14px] p-5 ${look}`}>
      <h1 className="font-[family-name:var(--font-display)] text-[26px] font-extrabold leading-tight tracking-tight text-balance">{title}</h1>
      {body ? <p className="mt-2 text-[17px] leading-snug text-pretty">{body}</p> : null}
      {children}
    </section>
  );
}
