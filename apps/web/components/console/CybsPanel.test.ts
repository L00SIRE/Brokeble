import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CybsRow } from "@/lib/agent";
import { CybsView, submitted, type CybsState } from "./CybsPanel";

const txn = { operation: "Capture", status: "PENDING", message: null, reason_code: "100", amount: "21.00", currency: "USD", card_type: "Visa", card_last4: "1111", submit_time: "2026-10-18T14:03:22Z", processor: "visanet", merchant_id: "testrest" };
const row = (o: Partial<CybsRow> = {}): CybsRow => ({ seq: 1, op: "capture", attempt: 1, recorded: "ok", cybs_id: "7423519283746501", lookup: "live", txn, ...o });
const ready = (rows: CybsRow[]): CybsState => ({
  kind: "ready",
  data: { available: true, order_id: "ord_abcdefghij", fetched_at: "2026-10-18T14:03:30Z", source: { id: "testrest", label: "Cybersource sandbox · shared public test merchant" }, environment: "apitest.cybersource.com", rows },
});
const html = (s: CybsState) => renderToStaticMarkup(createElement(CybsView, { state: s }));

describe("CybsView", () => {
  it("shows what Cybersource reports, labelled fetched live", () => {
    const h = html(ready([row()]));
    for (const s of ["fetched live from Cybersource", "7423519283746501", "Capture", "PENDING", "reason 100", "$21.00", "Visa ···· 1111", "14:03:22 UTC", "visanet", "apitest.cybersource.com", "merchant testrest"]) expect(h).toContain(s);
  });
  it("degrades a row whose lookup failed, keeping the recorded id", () => {
    const h = html(ready([row({ lookup: "unavailable", txn: null })]));
    expect(h).toContain("Lookup unavailable");
    expect(h).toContain("7423519283746501");
  });
  it("explains the empty and unavailable states", () => {
    expect(html({ kind: "nokey" })).toContain("operator key");
    expect(html({ kind: "unavailable", reason: "venue_simulated" })).toContain("simulated");
    expect(html(ready([]))).toContain("No payments recorded");
  });
  it("formats submit times", () => {
    expect(submitted("2026-10-18T09:01:02.000Z")).toBe("09:01:02 UTC");
    expect(submitted(null)).toBe("·");
  });
});
