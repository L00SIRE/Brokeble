// Notion page from code when the Concierge connector did not create one (B plan T11; @notionhq/client@5.27.1, UNVERIFIED
// U17). Requires NOTION_TOKEN + NOTION_PARENT_PAGE_ID; otherwise returns null. Owner B.
import { Client } from "@notionhq/client";
import type { Itinerary } from "@tab/shared";
import { env } from "../env";
import { errInfo, log } from "../log";

const text = (content: string) => [{ text: { content: content.slice(0, 2000) } }];

/**
 * notion.pages.create({parent: {page_id: NOTION_PARENT_PAGE_ID}, properties: {title: {title: [{text: {content: title}}]}},
 * children: one paragraph per stop}) → page url (or https://www.notion.so/<id without dashes>). Any failure → null.
 */
export async function createNotionPage(itinerary: Pick<Itinerary, "title" | "date" | "stops">): Promise<string | null> {
  if (!env.NOTION_TOKEN || !env.NOTION_PARENT_PAGE_ID) return null;
  try {
    const notion = new Client({ auth: env.NOTION_TOKEN, timeoutMs: 10_000 });
    const page = await notion.pages.create({
      parent: { page_id: env.NOTION_PARENT_PAGE_ID },
      properties: { title: { title: text(itinerary.title) } },
      children: [
        { paragraph: { rich_text: text(itinerary.date) } },
        ...itinerary.stops.map((s) => ({ paragraph: { rich_text: text(`${s.time} · ${s.name} · ${s.address}`) } })),
      ],
    });
    return "url" in page ? page.url : `https://www.notion.so/${page.id.replaceAll("-", "")}`;
  } catch (err) {
    log.warn(errInfo(err), "notion fallback failed"); // errInfo only: SDK errors can carry request details
    return null;
  }
}
