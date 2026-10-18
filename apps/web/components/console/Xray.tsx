// Context X-ray (B plan T9/T12): exactly what each model-facing context contained. Scout inputs and the fan-out are
// shown as a preview; every `delegate:*` context is locked (P1) and rendered as a lock only, never its preview.
import type { XrayContext } from "@/lib/consoleReducer";
import { Panel, Waiting } from "./Panel";

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

function Tile({ context }: { context: XrayContext }) {
  // A locked context never renders its preview, even if a bad event carried one.
  const preview = context.locked ? null : context.preview;
  return (
    <li className="flex min-w-0 flex-col gap-1 rounded-lg border border-border bg-surface-2 p-3">
      <div className="flex items-center justify-between gap-2">
        <span translate="no" className="min-w-0 truncate font-mono text-(length:--text-console-label)">
          {context.name}
        </span>
        {context.locked && (
          <span className="shrink-0 font-medium text-lock" title="Only this person's own delegate can read this context">
            <span aria-hidden="true">🔒 </span>Locked
          </span>
        )}
      </div>
      {preview !== null && (
        <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-(length:--text-console-label) text-muted">
          {formatPreview(preview)}
        </pre>
      )}
    </li>
  );
}

export function XrayPanel({ contexts }: { contexts: readonly XrayContext[] }) {
  return (
    <Panel title="Context X-ray" className="min-h-48">
      {contexts.length === 0 ? (
        <Waiting />
      ) : (
        <ul className="flex max-h-full flex-col gap-2 overflow-y-auto">
          {sortContexts(contexts).map((c) => (
            <Tile key={c.name} context={c} />
          ))}
        </ul>
      )}
    </Panel>
  );
}
