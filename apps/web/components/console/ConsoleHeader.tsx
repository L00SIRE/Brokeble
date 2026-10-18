"use client";

// Console header (design-system §7.1, §7.3): wordmark, "Trust console", the plan's public facts, the rails line and the
// stream state. The live dot is a slow paper pulse; reconnecting stops the pulse; a missing or refused key leaves it
// hollow, never red. No stepper (§10 bans "1-2-3" steppers): the status sentence carries progress.
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { TICKET_PATH } from "@/components/brand/icons";
import type { ConsoleStreamStatus } from "@/lib/useConsoleStream";
import { MONO, type ConsoleTheme } from "./Panel";

export type HeaderStream = ConsoleStreamStatus | "missing";

/** One line in the secondary color when the console cannot read the plan (§7.3). */
const NOTICE: Partial<Record<HeaderStream, string>> = {
  missing: "Add the console key to the link to watch live.",
  unauthorized: "Console key refused. Check the link.",
};

function LiveClock() {
  const [now, setNow] = useState<string | null>(null);
  useEffect(() => {
    const tick = () => setNow(new Date().toTimeString().slice(0, 8));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, []);
  // Rendered only on the client: a server timestamp would mismatch on hydration.
  return now ?? "";
}

function Stream({ stream, paused }: { stream: HeaderStream; paused: boolean }) {
  const dot =
    stream === "open"
      ? `bg-(--c-fg) ${paused ? "" : "motion-safe:animate-[c-pulse_2s_ease-in-out_infinite]"}`
      : stream === "reconnecting"
        ? "bg-(--c-fg)"
        : "border-[.15cqw] border-(--c-fg)";
  const label = stream === "open" ? "Live" : stream === "reconnecting" ? "Reconnecting" : stream === "connecting" || stream === "idle" ? "Connecting" : "Not connected";
  // Only the connection state is a live region: the ticking clock beside it would be announced every second.
  return (
    <span className="flex items-center gap-[.6cqw]">
      <i aria-hidden="true" className={`block size-[.75cqw] min-h-2 min-w-2 rounded-full ${dot}`} />
      <span role="status">{label}</span>
      {stream === "open" ? (
        <span aria-hidden="true">
          <LiveClock />
        </span>
      ) : null}
    </span>
  );
}

const THEMES: { value: ConsoleTheme; label: string }[] = [
  { value: "ink", label: "Ink" },
  { value: "paper", label: "Paper (projector)" },
];

/**
 * Ink | Paper (projector), for the operator (?ops=1) when the venue projector washes out blacks (§0 P2, §9 open check 3).
 * The theme lives in the URL (?theme=paper), so a reload or a shared link keeps it.
 */
export function ThemeSwitch({ theme }: { theme: ConsoleTheme }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const choose = (next: ConsoleTheme) => {
    const q = new URLSearchParams(params.toString());
    if (next === "paper") q.set("theme", "paper");
    else q.delete("theme");
    router.replace(`${pathname}?${q.toString()}`, { scroll: false });
  };
  return (
    <span role="group" aria-label="Console ground" className="flex items-center">
      {THEMES.map((t, i) => (
        <button
          key={t.value}
          type="button"
          aria-pressed={theme === t.value}
          onClick={() => choose(t.value)}
          className={`inline-flex min-h-11 touch-manipulation items-center px-[.5cqw] hover:text-(--c-fg) aria-pressed:text-(--c-fg) aria-pressed:underline aria-pressed:decoration-[.12cqw] aria-pressed:underline-offset-[.3cqw] ${i > 0 ? "border-l border-(--c-rule)" : ""}`}
        >
          {t.label}
        </button>
      ))}
    </span>
  );
}

export function ConsoleHeader({
  meta,
  stream,
  paused,
  showPause,
  onTogglePause,
  children,
}: {
  meta: string;
  stream: HeaderStream;
  paused: boolean;
  /** False under reduced motion: nothing runs, so there is nothing to pause (same rule as the brand MotionToggle). */
  showPause: boolean;
  onTogglePause: () => void;
  /** Operator controls (the theme switch under ?ops=1), set after the stream state. */
  children?: ReactNode;
}) {
  const notice = NOTICE[stream];
  return (
    <header className="col-span-full flex items-center justify-between gap-[2cqw] border-b border-(--c-rule) pb-[1cqw] @max-[860px]:flex-wrap @max-[860px]:gap-2 @max-[860px]:pb-3">
      <div className="flex min-w-0 items-center gap-[1.4cqw]">
        <span translate="no" className="flex items-center gap-[.6cqw] font-display text-[max(18px,1.75cqw)] leading-none font-extrabold tracking-[-.045em]">
          <svg viewBox="0 0 24 16" aria-hidden="true" focusable="false" className="h-[1.47cqw] min-h-4 w-[2.2cqw] min-w-6 fill-current">
            <path fillRule="evenodd" d={TICKET_PATH} />
          </svg>
          squadtab
        </span>
        <h1 className="text-[max(14px,1.3cqw)] font-[650] whitespace-nowrap">Trust console</h1>
        {meta ? <span className="min-w-0 truncate text-[max(13px,1.1cqw)] text-(--c-2) @max-[860px]:hidden">{meta}</span> : null}
      </div>
      <div className={`${MONO} flex shrink-0 items-center gap-[1.6cqw] text-[max(11px,1cqw)] whitespace-nowrap text-(--c-2)`}>
        {notice ? <span>{notice}</span> : <span className="@max-[860px]:hidden">Holds on Visa Cybersource</span>}
        <Stream stream={stream} paused={paused} />
        {children}
        {showPause ? (
          // A toggle keeps one stable name; aria-pressed carries the state (matches the brand MotionToggle).
          <button
            type="button"
            aria-pressed={paused}
            onClick={onTogglePause}
            className="inline-flex min-h-11 touch-manipulation items-center rounded-[.3cqw] underline decoration-[.12cqw] underline-offset-[.3cqw] hover:text-(--c-fg) aria-pressed:text-(--c-fg)"
          >
            Pause motion
          </button>
        ) : null}
      </div>
    </header>
  );
}
