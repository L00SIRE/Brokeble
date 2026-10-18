import { Shell } from "./StateCard";

export default function Loading() {
  return (
    <Shell source="loading…">
      <div role="status" aria-label="Loading payment page" className="mt-6 animate-pulse space-y-4">
        <div className="h-6 w-3/4 rounded bg-neutral-200" />
        <div className="h-4 w-full rounded bg-neutral-200" />
        <div className="h-12 w-1/2 rounded bg-neutral-200" />
        <div className="h-12 w-full rounded-xl bg-neutral-200" />
      </div>
    </Shell>
  );
}
