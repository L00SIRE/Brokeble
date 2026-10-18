import type { LaneStage } from "@tab/shared";

/**
 * Lamp states (design-system 3.2). Every stage before HELD renders hollow, so a console lane can pass its raw
 * `LaneStage` straight through.
 */
export type LampState = "VOTED" | "HELD" | "CAPTURED" | "RELEASED" | "DECLINED";

/**
 * One seat lamp. Shape carries the state as well as color (WCAG 1.4.1): hollow, solid sodium, solid go, or dashed.
 * Decorative: the caller renders the state in text. Size it with `className`. Edges are themable through
 * `--lamp-edge` (hollow), `--lamp-on-edge` (HELD/CAPTURED; the paper console sets it to ink for 3:1) and
 * `--lamp-off-edge` (dashed).
 */
export function Lamp({ state, className }: { state: LampState | LaneStage; className?: string }) {
  return <span aria-hidden="true" data-state={state} className={className ? `lamp ${className}` : "lamp"} />;
}

/**
 * A row of `total` dots with the first `filled` solid, in `currentColor` ("k of n in"). Decorative: always pair it with
 * the count in text.
 */
export function Lamps({ filled, total, className }: { filled: number; total: number; className?: string }) {
  const n = Math.max(0, Math.floor(total));
  const k = Math.min(n, Math.max(0, Math.floor(filled)));
  return (
    <span aria-hidden="true" className={className ? `lamps ${className}` : "lamps"}>
      {Array.from({ length: n }, (_, i) => (
        <i key={i} data-on={i < k ? "" : undefined} />
      ))}
    </span>
  );
}
