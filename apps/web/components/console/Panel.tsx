"use client";

// Console primitives (design-system §7): the console-local theme, the shared motion context and the section heading.
// Sentences beat boxes (§10), so a "panel" is a heading plus content on the console ground: no border, no card.
import { createContext, type ReactNode } from "react";

export type ConsoleTheme = "ink" | "paper";

/**
 * Motion state the animated console parts read: `paused` is the Pause motion control (WCAG 2.2.2) and `theme` lets a
 * canvas repaint its palette on the ink/paper switch. Reduced motion is read from the media query where it is used.
 */
export const ConsoleMotion = createContext<{ paused: boolean; theme: ConsoleTheme }>({ paused: false, theme: "ink" });

/** Martian Mono at the UI width (design-system §3.3). */
export const MONO = "font-mono [font-variation-settings:'wdth'_87.5]";

/**
 * Console-local variables: one attribute (`data-theme`) swaps the whole console between ink and the paper projector
 * ground (§3.2). Fills that sit below 3:1 on paper (sodium, go) get an ink edge there (WCAG 1.4.11). `--lamp-*` themes
 * the brand kit's Lamp. The two redaction colors are the prototype's; every other value is a §3.1 token.
 */
export const CONSOLE_CSS = `
[data-console]{--c-ink:var(--color-ink);--c-held:var(--color-sodium);--c-go:var(--color-go)}
[data-console][data-theme="ink"]{color-scheme:dark;--c-bg:var(--color-ink);--c-fg:var(--color-paper);--c-2:var(--color-night-2);--c-3:var(--color-night-3);--c-rule:var(--color-rule-night);--c-line:var(--color-night-2);--c-held-line:var(--color-sodium);--c-go-line:var(--color-go);--c-go-text:var(--color-go);--c-held-edge:var(--color-sodium);--c-go-edge:var(--color-go);--c-redact:#2a2314;--c-redact-dot:#c98a16;--lamp-edge:var(--color-paper);--lamp-off-edge:var(--color-night-2)}
[data-console][data-theme="paper"]{color-scheme:light;--c-bg:var(--color-paper);--c-fg:var(--color-ink);--c-2:var(--color-on-paper-2);--c-3:var(--color-on-paper-2);--c-rule:var(--color-rule-paper);--c-line:var(--color-on-paper-2);--c-held-line:var(--color-held-line-paper);--c-go-line:var(--color-go-ink);--c-go-text:var(--color-go-ink);--c-held-edge:var(--color-ink);--c-go-edge:var(--color-ink);--c-redact:#e6dcc6;--c-redact-dot:#8a5a08;--lamp-edge:var(--color-ink);--lamp-on-edge:var(--color-ink);--lamp-off-edge:var(--color-on-paper-2)}
@keyframes c-pulse{50%{opacity:.25}}
@keyframes c-chip-in{from{transform:translateY(-.3cqw);opacity:.2}to{transform:none;opacity:1}}
@keyframes c-step-in{from{opacity:.3}to{opacity:1}}
`;

/** A console section: a sentence-case heading with an optional quieter aside ("· Visa Trusted Agent Protocol"). */
export function Panel({ title, aside, className, children }: { title: string; aside?: string; className?: string; children?: ReactNode }) {
  return (
    <section aria-label={title} className={className ? `min-w-0 ${className}` : "min-w-0"}>
      <h2 className="mb-[.6cqw] text-[max(14px,1.15cqw)] leading-tight font-[650]">
        {title}
        {aside ? <span className="font-normal text-(--c-2)"> · {aside}</span> : null}
      </h2>
      {children}
    </section>
  );
}
