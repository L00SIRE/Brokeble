"use client";

// Privacy band (design-system §0 P1, §7.1): "Budgets: hidden, and checked." Beside the title, what the group sees
// (the public facts the Scout briefs carry: area, time, party, dietary tags; P6) and what only SquadTab sees (one
// locked row per private delegate context). Every `delegate:*` context is locked (P1) and rendered as a fixed-width
// redaction bar plus "Locked", never its preview, even if a bad event carried one.
import { DotIcon } from "@/components/brand/DotIcon";
import type { ConsoleState, LaneView, XrayContext } from "@/lib/consoleReducer";
import { groupSees, lockedLanes, planFacts } from "@/lib/consoleView";
import { ShortlistCheck } from "./ConsoleShortlist";
import { RedactBar } from "./RedactBar";

/** Pretty-prints a JSON preview; non-JSON previews are shown as-is. */
export function formatPreview(preview: string): string {
  try {
    return JSON.stringify(JSON.parse(preview), null, 2);
  } catch {
    return preview;
  }
}

/** Stable display order: Scout inputs first, then the fan-out, then delegates; ties by name. */
const group = (name: string) => (name.startsWith("scout_input") ? 0 : name.startsWith("delegate") ? 2 : 1);
export const sortContexts = (contexts: readonly XrayContext[]): XrayContext[] =>
  [...contexts].sort((a, b) => group(a.name) - group(b.name) || a.name.localeCompare(b.name));

const HEAD = "mb-[.5cqw] text-[max(13px,1.02cqw)] text-(--c-2)";

export function XrayPanel({
  contexts,
  lanes = {},
  shortlist = null,
  share = null,
}: {
  contexts: readonly XrayContext[];
  lanes?: Record<number, LaneView>;
  shortlist?: ConsoleState["shortlist"];
  share?: number | null;
}) {
  // The view model reads only locked flags and Scout briefs; previews of locked contexts never reach the markup.
  const xray = Object.fromEntries(contexts.map((c) => [c.name, c.locked ? { ...c, preview: null } : c]));
  const facts = planFacts(xray);
  const sees = groupSees(facts, { laneCount: Object.keys(lanes).length, shortlist, share });
  const locked = lockedLanes(xray, lanes);
  return (
    <section
      aria-label="Privacy"
      className="col-span-full row-start-4 grid grid-cols-[15cqw_minmax(0,1fr)_minmax(0,1.35fr)] items-start gap-x-[2.4cqw] border-t border-(--c-rule) pt-[1.2cqw] pb-[1.1cqw] @max-[860px]:order-5 @max-[860px]:grid-cols-1 @max-[860px]:gap-3 @max-[860px]:py-4"
    >
      <div>
        <h2 className="font-display text-[1.75cqw] leading-[1.05] font-bold tracking-[-.03em] @max-[860px]:text-xl">Budgets: hidden, and checked.</h2>
        <ShortlistCheck shortlist={shortlist} />
      </div>
      <div>
        <p className={HEAD}>What the group sees</p>
        <p className="text-[max(14px,1.35cqw)] leading-[1.3] text-pretty">{sees ?? "Nothing has been read yet."}</p>
      </div>
      <div>
        <p className={HEAD}>What only SquadTab sees</p>
        {locked.length === 0 ? (
          <p className="text-[max(14px,1.35cqw)] leading-[1.3] text-(--c-2)">No budgets set yet.</p>
        ) : (
          <ul className="grid grid-cols-2 gap-x-[2cqw] gap-y-[.55cqw] @max-[860px]:grid-cols-1">
            {locked.map(({ lane, name }) => (
              <li key={lane} className="grid grid-cols-[minmax(0,5.6cqw)_auto_1fr] items-center gap-[.8cqw] text-[max(13px,1.2cqw)] @max-[860px]:grid-cols-[64px_auto_1fr]">
                <span className="break-words">{name}</span>
                <RedactBar salt={lane + 20} className="h-[1.25cqw] w-[6.25cqw] @max-[860px]:h-3 @max-[860px]:w-16" />
                <span className="flex items-center gap-[.4cqw] text-[max(12px,1cqw)] text-(--c-2)" title="Only this person's own delegate can read this context">
                  <DotIcon name="lock" className="size-[1.15cqw] min-h-3 min-w-3" />
                  Locked
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
