import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ create: vi.fn(), ctor: vi.fn(), e: { LOG_LEVEL: "silent", NOTION_TOKEN: "ntn_x" as string | undefined, NOTION_PARENT_PAGE_ID: "parent-id" as string | undefined } }));
vi.mock("@notionhq/client", () => ({
  Client: class {
    pages = { create: m.create };
    constructor(o: unknown) { m.ctor(o); }
  },
}));
vi.mock("../src/env", () => ({ env: m.e }));

import { createNotionPage } from "../src/creao/notionFallback";

const it0 = { title: "Dinner at A → Show at B", date: "2026-10-17", stops: [{ kind: "dinner" as const, name: "A", address: "1 Main St", time: "18:30", notes: "" }] };

beforeEach(() => {
  m.create.mockReset();
  m.e.NOTION_TOKEN = "ntn_x";
  m.e.NOTION_PARENT_PAGE_ID = "parent-id";
});

describe("createNotionPage", () => {
  it("creates a child page and returns its url", async () => {
    m.create.mockResolvedValue({ id: "a-b", url: "https://www.notion.so/x" });
    expect(await createNotionPage(it0)).toBe("https://www.notion.so/x");
    const arg = m.create.mock.calls[0]![0];
    expect(arg.parent).toEqual({ page_id: "parent-id" });
    expect(arg.properties.title.title[0].text.content).toBe(it0.title);
    expect(arg.children).toHaveLength(2);
    expect(JSON.stringify(arg.children)).toContain("18:30 · A · 1 Main St");
  });
  it("derives the url from the id for partial page responses", async () => {
    m.create.mockResolvedValue({ id: "ab-cd-ef" });
    expect(await createNotionPage(it0)).toBe("https://www.notion.so/abcdef");
  });
  it("returns null without credentials, without calling Notion", async () => {
    m.e.NOTION_TOKEN = undefined;
    expect(await createNotionPage(it0)).toBeNull();
    expect(m.create).not.toHaveBeenCalled();
  });
  it("returns null on any Notion failure", async () => {
    m.create.mockRejectedValue(new Error("boom"));
    expect(await createNotionPage(it0)).toBeNull();
  });
});
