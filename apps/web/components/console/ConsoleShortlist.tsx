// "…and checked" (design-system §0 P1): how many composed plans the plain-code filter tested against every private
// budget, and how many survived. The filter is a pipeline step in decide/score.ts, never a model (CLAUDE.md #3), and it
// emits only counts: no budget reaches this slice.
import type { ConsoleState } from "@/lib/consoleReducer";

export function ShortlistCheck({ shortlist }: { shortlist: ConsoleState["shortlist"] }) {
  if (!shortlist) return null;
  return (
    <p className="mt-[.6cqw] text-[max(13px,1.05cqw)] leading-[1.3] text-(--c-2)">
      <b className="font-[650] text-(--c-fg)">
        {shortlist.survived_count} of {shortlist.from_count}
      </b>{" "}
      plans fit every budget. Checked by code, not a model.
    </p>
  );
}
