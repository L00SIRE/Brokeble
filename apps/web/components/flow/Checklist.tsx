import type { ReactNode } from "react";
import { DotIcon } from "@/components/brand/DotIcon";

export type ChecklistItem = { label: string; done: boolean; note?: ReactNode };

/**
 * Sentences with a dot check or an empty box (design-system 6.5: no ✓/✗ characters). The box ticks from the
 * person's own stage only. The accent is ink on paper and sodium on ink, through the ground's `--color-accent`.
 */
export function Checklist({ items, label }: { items: readonly ChecklistItem[]; label: string }) {
  return (
    <ul aria-label={label} className="m-0 grid list-none p-0">
      {items.map((it) => (
        <li key={it.label} className="grid grid-cols-[26px_1fr] items-center gap-3 border-b border-current/15 py-3.5 text-base last:border-b-0">
          <DotIcon name={it.done ? "check" : "box"} color={it.done ? "var(--color-accent)" : "var(--color-muted)"} />
          <span>
            <span className="sr-only">{it.done ? "Done: " : "Not yet: "}</span>
            {it.label}
            {it.note ? <small className="block text-[13.5px] text-muted">{it.note}</small> : null}
          </span>
        </li>
      ))}
    </ul>
  );
}
