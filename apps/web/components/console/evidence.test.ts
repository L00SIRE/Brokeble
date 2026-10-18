import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CreaoRunView } from "@/lib/consoleReducer";
import { CreaoLane, elapsedFor, formatElapsed } from "./CreaoLane";
import { stepRows, TapPanel } from "./TapPanel";
import { formatPreview, sortContexts, XrayPanel } from "./Xray";

const run = (o: Partial<CreaoRunView> = {}): CreaoRunView => ({
  run_id: "abcdef1234567890",
  kind: "scout",
  category: "dinner",
  status: "running",
  elapsed_ms: 4000,
  source: "live",
  share_url: null,
  first_seen_at: 1000,
  ...o,
});

describe("xray", () => {
  it("never renders a locked preview", () => {
    const html = renderToStaticMarkup(createElement(XrayPanel, { contexts: [{ name: "delegate:lane-2", locked: true, preview: "SECRET-BUDGET" }] }));
    expect(html).toContain("Locked");
    expect(html).not.toContain("SECRET-BUDGET");
  });
  it("orders scout, fanout, delegates and pretty-prints JSON", () => {
    const names = sortContexts([
      { name: "delegate:lane-1", locked: true, preview: null },
      { name: "fanout", locked: false, preview: "x" },
      { name: "scout_input:show", locked: false, preview: "{}" },
    ]).map((c) => c.name);
    expect(names).toEqual(["scout_input:show", "fanout", "delegate:lane-1"]);
    expect(formatPreview('{"a":1}')).toBe('{\n  "a": 1\n}');
    expect(formatPreview("not json")).toBe("not json");
  });
});

describe("creao lane", () => {
  it("formats and ticks elapsed; terminal runs freeze", () => {
    expect(formatElapsed(65_000)).toBe("1:05");
    expect(elapsedFor(run(), 11_000)).toBe(10_000);
    expect(elapsedFor(run(), 1_500)).toBe(4000);
    expect(elapsedFor(run({ status: "completed" }), 999_999)).toBe(4000);
  });
  it("shows run chip, cached badge, Open Run only with a share url, and progress", () => {
    const html = renderToStaticMarkup(
      createElement(CreaoLane, {
        runs: [run({ source: "cached", share_url: "https://agent.creao.ai/share/x" })],
        progress: [{ id: 1, run_id: "r", kind: "scout", category: "dinner", step: "Searching venues" }],
      }),
    );
    expect(html).toContain("abcdef12");
    expect(html).toContain("cached");
    expect(html).toContain("Open Run");
    expect(html).toContain("Searching venues");
    expect(renderToStaticMarkup(createElement(CreaoLane, { runs: [run()], progress: [] }))).not.toContain("Open Run");
  });
});

describe("tap panel", () => {
  const report = {
    route: "/checkout",
    tag: "agent-payer-auth",
    steps: [
      { n: 1 as const, name: "tag" as const, ok: true, detail: "ok" },
      { n: 2 as const, name: "params" as const, ok: false, detail: "bad created" },
    ],
    business: null,
    accepted: false,
    reason: "params",
    signature_base: '"@method": POST',
  };
  it("always lists six steps, unreached ones marked", () => {
    const rows = stepRows(report.steps);
    expect(rows).toHaveLength(6);
    expect(rows[2]?.step).toBeNull();
  });
  it("renders rejection, mock directory label, signature base and buttons only with a handler", () => {
    const props = { signed: null, verify: { order_id: "o", report } };
    const html = renderToStaticMarkup(createElement(TapPanel, { ...props, onTapTest: async () => {} }));
    expect(html).toContain("Rejected by merchant");
    expect(html).toContain("Key directory: mock");
    expect(html).toContain("@method");
    expect(html).toContain("Wrong Tag");
    expect(html).not.toContain("Visa-verified");
    expect(renderToStaticMarkup(createElement(TapPanel, props))).not.toContain("Wrong Tag");
  });
  it("labels an accepted report as verified by merchant", () => {
    const html = renderToStaticMarkup(createElement(TapPanel, { signed: null, verify: { order_id: "o", report: { ...report, accepted: true, reason: null } } }));
    expect(html).toContain("Verified by merchant");
  });
});
