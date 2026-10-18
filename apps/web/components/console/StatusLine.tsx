// The status sentence (design-system §7.2): the one thing to read from 5 m. Copy is derived in lib/consoleView.ts.
import type { Status } from "@/lib/consoleView";

export function StatusLine({ status }: { status: Status }) {
  return (
    <div aria-live="polite" aria-atomic="true" className="col-start-1 row-start-2 pt-[1.2cqw] pb-[1cqw] @max-[860px]:pt-3.5 @max-[860px]:pb-3">
      <p className="font-display text-[3.6cqw] leading-[.95] font-[720] tracking-[-.045em] text-balance @max-[860px]:text-[30px]">{status.big}</p>
      <p className="mt-[.5cqw] text-[max(14px,1.35cqw)] text-pretty text-(--c-2) @max-[860px]:mt-1.5 @max-[860px]:text-[14.5px]">{status.small}</p>
    </div>
  );
}
