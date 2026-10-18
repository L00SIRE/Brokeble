// Flow control styles (design-system 6.1, 6.2). They read the ground's variables (`--btn-bg`, `--btn-fg`, `text-muted`)
// set by `[data-ground]` in globals.css, so the same button is ink-on-paper in the stub and sodium-on-ink on "you're in".

/** 58px primary: ground-contrast fill, Funnel Sans 700 17px, radius 6px, 1px press. Full width (the flow lives in narrow columns). */
export const primaryButton =
  "inline-flex h-[58px] w-full touch-manipulation items-center justify-center gap-3 whitespace-nowrap rounded-control border-0 px-[26px] " +
  "bg-(--btn-bg) font-sans text-[17px] font-bold tracking-[-0.01em] text-(--btn-fg) no-underline transition-transform duration-75 " +
  "active:translate-y-px disabled:cursor-progress";

/** Underlined text button: "Copy link instead", "Wrong number? Fix it". ≥44px target. */
export const textButton =
  "inline-flex min-h-11 touch-manipulation items-center bg-transparent p-0 text-[15px] font-semibold text-current " +
  "underline decoration-2 underline-offset-4 hover:decoration-[3px]";

/**
 * 58px input, 2px ink border, white fill, Martian Mono 17px (≥16px: no iOS zoom). Focus is the system ring (3px, 3px
 * offset, design-system 9); error is a 3px border, never red, so the two never look alike.
 */
export const phoneInput =
  "mono h-[58px] w-full min-w-0 rounded-control border-2 border-ink bg-white px-[18px] text-[17px] tracking-[0.01em] text-ink " +
  "placeholder:text-on-paper-2 placeholder:opacity-100 focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-fg " +
  "aria-invalid:border-[3px] aria-invalid:px-[17px]";

/** Display heading inside the stub and the status panels. */
export const stubTitle = "font-display text-[27px] font-[740] leading-none tracking-[-0.04em] text-balance outline-none";

/** Mono caption ("Your seat", "Your first text, typed for you"). */
export const kicker = "mono text-[12.5px] text-muted";
