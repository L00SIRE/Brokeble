import { DOT_RADIUS, DOT_RADIUS_BY_GLYPH, DOT_VIEWBOX, type DotIconName, dotCentres, LOCK_BODY, LOCK_SHACKLE } from "./icons";

/**
 * 7x7 dot glyph at 22px (design-system 6.5). Always decorative: the text beside it carries the meaning, so it is
 * hidden from assistive tech. Size it with `className` (e.g. `size-5`); color follows `currentColor` unless `color`
 * is given (any CSS color, e.g. "var(--color-sodium)").
 */
export function DotIcon({ name, color = "currentColor", className }: { name: DotIconName; color?: string; className?: string }) {
  return (
    <svg
      viewBox={`0 0 ${DOT_VIEWBOX} ${DOT_VIEWBOX}`}
      width="22"
      height="22"
      aria-hidden="true"
      focusable="false"
      className={className ? `di ${className}` : "di"}
      data-icon={name}
    >
      {name === "lock" ? (
        <>
          <path d={LOCK_SHACKLE} fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" />
          <rect {...LOCK_BODY} fill={color} />
        </>
      ) : (
        dotCentres(name).map(({ cx, cy }) => (
          <circle key={`${cx},${cy}`} cx={cx} cy={cy} r={DOT_RADIUS_BY_GLYPH[name] ?? DOT_RADIUS} fill={color} />
        ))
      )}
    </svg>
  );
}
