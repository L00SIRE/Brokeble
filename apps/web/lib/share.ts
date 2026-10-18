// Invite sharing (ux-flow §3.5): the native share sheet, with the clipboard as the fallback. Call only from a click
// handler, because navigator.share needs a user gesture.

export type ShareResult = "shared" | "copied" | "cancelled" | "failed";
export type ShareInput = { title: string; dateLabel: string; url: string };

type ShareNavigator = Pick<Navigator, "share" | "clipboard"> | Partial<Pick<Navigator, "share" | "clipboard">>;

/** The URL sits inside `text`: iOS copies `text`, not `url`, when both are set (adactio.com/journal/15972). */
export const inviteText = (p: ShareInput): string => `${p.title}, ${p.dateLabel}. Tap to join: ${p.url}`;

export async function shareInvite(p: ShareInput, nav: ShareNavigator = navigator): Promise<ShareResult> {
  if (typeof nav.share === "function") {
    try {
      await nav.share({ title: p.title, text: inviteText(p) });
      return "shared";
    } catch (e) {
      return (e as DOMException | undefined)?.name === "AbortError" ? "cancelled" : "failed";
    }
  }
  return copyText(p.url, nav);
}

export async function copyText(value: string, nav: ShareNavigator = navigator): Promise<"copied" | "failed"> {
  try {
    if (!nav.clipboard) return "failed";
    await nav.clipboard.writeText(value);
    return "copied";
  } catch {
    return "failed";
  }
}
