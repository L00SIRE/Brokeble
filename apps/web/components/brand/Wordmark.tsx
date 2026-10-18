import { TICKET_PATH, TICKET_SYMBOL_ID } from "./icons";

/**
 * The one `<symbol>` every wordmark instance `<use>`s (design-system 6.6). Rendered once, by the root layout.
 * Anything outside the document (next/og images) must draw `TICKET_PATH` itself.
 */
export function BrandSymbols() {
  return (
    <svg width="0" height="0" aria-hidden="true" focusable="false" style={{ position: "absolute", overflow: "hidden" }}>
      <symbol id={TICKET_SYMBOL_ID} viewBox="0 0 24 16">
        <path fill="currentColor" fillRule="evenodd" d={TICKET_PATH} />
      </symbol>
    </svg>
  );
}

/**
 * `squadtab` in Funnel Display 800 beside the ticket mark. It scales with font-size (22px by default; pass e.g.
 * `text-[19px]` for the phone screens). For a home link, wrap it: `<a href="/" aria-label="SquadTab home"><Wordmark /></a>`.
 */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={className ? `wordmark ${className}` : "wordmark"} translate="no">
      <svg aria-hidden="true" focusable="false">
        <use href={`#${TICKET_SYMBOL_ID}`} />
      </svg>
      squadtab
    </span>
  );
}
