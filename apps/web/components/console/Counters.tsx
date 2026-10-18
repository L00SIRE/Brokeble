// Counters (design-system §7.1): our own 5×7 dot numerals in the console's paper (or ink) color. "$" is set in
// Funnel Display beside the digits, never as dots (§3.3). Values come from the agent's `counters` event, which it
// computes from the database, so a restart never zeroes them. The SVG is decorative; the label carries the number.
// The zero is slashed: a plain 5×7 "0" in dots reads as an empty box (a missing glyph) from 5 m.
import type { ConsoleState } from "@/lib/consoleReducer";

const DOT_FONT: Readonly<Record<string, readonly string[]>> = {
  "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
  "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  "2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
  "3": ["11111", "00010", "00100", "00010", "00001", "10001", "01110"],
  "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  "5": ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
  "6": ["00110", "01000", "10000", "11110", "10001", "10001", "01110"],
  "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  "9": ["01110", "10001", "10001", "01111", "00001", "00010", "01100"],
  "-": ["000", "000", "000", "111", "000", "000", "000"],
};

/** Dot centres for `text` in a 7-row grid, one empty column between glyphs. Unknown characters draw as "-". */
export function dotLayout(text: string): { width: number; dots: { x: number; y: number }[] } {
  const dots: { x: number; y: number }[] = [];
  let x = 0;
  for (const ch of text) {
    const rows = DOT_FONT[ch] ?? DOT_FONT["-"]!;
    rows.forEach((row, y) => [...row].forEach((v, cx) => v === "1" && dots.push({ x: x + cx + 0.5, y: y + 0.5 })));
    x += rows[0]!.length + 1;
  }
  return { width: Math.max(1, x - 1), dots };
}

function DotNum({ value, className }: { value: string; className: string }) {
  const { width, dots } = dotLayout(value);
  return (
    <svg viewBox={`0 0 ${width} 7`} aria-hidden="true" focusable="false" data-avoid className={`w-auto fill-current ${className}`} style={{ aspectRatio: `${width} / 7` }}>
      {dots.map((d) => (
        <circle key={`${d.x},${d.y}`} cx={d.x} cy={d.y} r={0.46} />
      ))}
    </svg>
  );
}

function Count({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex items-center gap-[.9cqw]">
      <DotNum value={String(value)} className="h-[2.2cqw] min-h-6" />
      <p className="text-[max(15px,1.2cqw)] leading-[1.2] text-(--c-2)">
        <span className="sr-only">{value} </span>
        {label}
      </p>
    </div>
  );
}

/**
 * "$0 fronted by any one person", groups booked and holds released. `fronted_by_individual_cents` is 0 by schema, so
 * that line is true before any counters frame; the two counts appear only once the agent has sent real ones.
 */
export function Counters({ counters }: { counters: ConsoleState["counters"] }) {
  const fronted = String(Math.round((counters?.fronted_by_individual_cents ?? 0) / 100));
  return (
    <div className="mt-auto grid gap-[.6cqw] border-t border-(--c-rule) pt-[.8cqw] pb-[.6cqw] @max-[860px]:gap-3 @max-[860px]:pt-3.5">
      <div className="flex items-center gap-[.9cqw]">
        <span className="flex items-center gap-[.25cqw]">
          <span aria-hidden="true" className="font-display text-[3cqw] leading-none font-extrabold @max-[860px]:text-3xl">
            $
          </span>
          <DotNum value={fronted} className="h-[2.8cqw] min-h-7" />
        </span>
        <p className="text-[max(15px,1.2cqw)] leading-[1.2] text-(--c-2)">
          <span className="sr-only">${fronted} </span>fronted by any one person, all night
        </p>
      </div>
      {counters ? (
        <div className="grid grid-cols-2 gap-[1cqw]">
          <Count value={counters.groups_converted} label="groups booked" />
          <Count value={counters.holds_released} label="holds released" />
        </div>
      ) : null}
    </div>
  );
}
