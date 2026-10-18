/**
 * Brand geometry shared by the React components (design-system 6.5 and 6.6). Pure data, no React, so tests and
 * any canvas code can read the same source.
 */

/** 7x7 dot glyphs drawn at a 3-unit pitch in a 21x21 box ("1" = dot). The same medium as the signal numerals. */
export const DOT_GLYPHS = {
  chat: ["0111110", "1000001", "1000001", "1000001", "0111110", "0010000", "0100000"],
  card: ["0000000", "1111111", "1111111", "1000001", "1011001", "1111111", "0000000"],
  // Two dots wide, with heavier dots (DOT_RADIUS_BY_GLYPH): a one-dot stroke read as a scattered squiggle at 22px,
  // and "done" is the state that must parse at a glance.
  check: ["0000000", "0000001", "0000011", "1000110", "1101100", "0111000", "0010000"],
  box: ["1111111", "1000001", "1000001", "1000001", "1000001", "1000001", "1111111"],
  share: ["0001000", "0011100", "0101010", "0001000", "1001001", "1000001", "1111111"],
  wait: ["0000000", "0000000", "0000000", "0001000", "0000000", "0000000", "0000000"],
} as const satisfies Record<string, readonly string[]>;

export type DotGlyphName = keyof typeof DOT_GLYPHS;
/** The lock is the one exception: as dots it read as "a little building" in review, so it is a shackle plus a solid body. */
export type DotIconName = DotGlyphName | "lock";

export const DOT_ICON_NAMES = [...(Object.keys(DOT_GLYPHS) as DotGlyphName[]), "lock"] as const satisfies readonly DotIconName[];

export const DOT_VIEWBOX = 21;
export const DOT_PITCH = 3;
export const DOT_RADIUS = 1.18;
/** Per-glyph overrides: the check's dots nearly touch so the stroke reads as one mark. */
export const DOT_RADIUS_BY_GLYPH: Partial<Record<DotGlyphName, number>> = { check: 1.45 };

/** Dot centres for a glyph, in viewBox units. */
export function dotCentres(name: DotGlyphName): { cx: number; cy: number }[] {
  return DOT_GLYPHS[name].flatMap((row, y) =>
    [...row].flatMap((v, x) => (v === "1" ? [{ cx: x * DOT_PITCH + DOT_PITCH / 2, cy: y * DOT_PITCH + DOT_PITCH / 2 }] : [])),
  );
}

/** The lock, in the same 21x21 box: a stroked shackle on a solid body. */
export const LOCK_SHACKLE = "M6.5 9.5V7a4 4 0 0 1 8 0v2.5";
export const LOCK_BODY = { x: 3.5, y: 9.5, width: 14, height: 10, rx: 2 } as const;

/**
 * Wordmark ticket (24x16 viewBox): semicircle notches on both sides and three perforation holes at x=17.
 * `app/icon.svg` draws the same shape at 32px on a sodium tile; keep them in step.
 */
export const TICKET_PATH =
  "M2 1H22A2 2 0 0 1 24 3V5.4A2.6 2.6 0 0 0 24 10.6V13A2 2 0 0 1 22 15H2A2 2 0 0 1 0 13V10.6A2.6 2.6 0 0 0 0 5.4V3A2 2 0 0 1 2 1Z" +
  "M17 3.5a1 1 0 1 0 0 2a1 1 0 1 0 0-2ZM17 7a1 1 0 1 0 0 2a1 1 0 1 0 0-2ZM17 10.5a1 1 0 1 0 0 2a1 1 0 1 0 0-2Z";

/** Fragment id of the single wordmark `<symbol>` (rendered once by `BrandSymbols` in the root layout). */
export const TICKET_SYMBOL_ID = "squadtab-ticket";
