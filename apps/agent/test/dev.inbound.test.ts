import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { InboundEvent } from "@tab/shared";
import { devRoutes, signVenueHook } from "../src/dev/inbound";
import { createPorts, MockMessaging } from "../src/ports";

const mockPorts = () => createPorts({ MESSAGING_MODE: "mock", LLM_MODE: "mock", PLANNER_MODE: "mock", VENUE_MODE: "mock" });
const post = (body: unknown) => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

describe("POST /dev/inbound", () => {
  it("normalizes a minimal body into a valid InboundEvent and hands it to the inbound handler", async () => {
    const ports = mockPorts();
    const seen: InboundEvent[] = [];
    await ports.messaging.start(async (e) => void seen.push(e));
    const app = devRoutes(ports);

    const res = await app.request("/dev/inbound", post({ from_handle: "+13105550101", text: "JOIN 4821" }));
    expect(res.status).toBe(200);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ platform: "imessage", space_kind: "direct", content_type: "text", text: "JOIN 4821", from_handle: "+13105550101", space_id: "mock_spc_13105550101" });

    await app.request("/dev/inbound", post({ from_handle: "+13105550101", text: "2" }));
    expect(seen[1]!.seq).toBeGreaterThan(seen[0]!.seq);
    expect(seen[1]!.event_id).not.toBe(seen[0]!.event_id);
  });

  it("rejects a non-E.164 sender and unknown fields", async () => {
    const ports = mockPorts();
    await ports.messaging.start(async () => {});
    const app = devRoutes(ports);
    expect((await app.request("/dev/inbound", post({ from_handle: "3105550101", text: "hi" }))).status).toBe(400);
    expect((await app.request("/dev/inbound", post({ from_handle: "+13105550101", budget: 30 }))).status).toBe(400);
  });

  it("GET /dev/outbox pages the mock's recorded sends", async () => {
    const ports = mockPorts();
    const m = ports.messaging as MockMessaging;
    await m.markRead("pho_msg_1", "read:pho_msg_1");
    const app = devRoutes(ports);
    const body = (await (await app.request("/dev/outbox?since=0")).json()) as { entries: unknown[]; next: number };
    expect(body.next).toBe(1);
    expect(body.entries).toEqual([expect.objectContaining({ kind: "read", messageId: "pho_msg_1" })]);
  });
});

describe("signVenueHook (PLAN §18)", () => {
  it("signs ts + '.' + raw body with HMAC-SHA256 hex", () => {
    const h = signVenueHook('{"a":1}', "hook-secret-hook-secret", 1_760_000_000);
    expect(h["x-tab-timestamp"]).toBe("1760000000");
    expect(h["x-tab-signature"]).toBe(`sha256=${createHmac("sha256", "hook-secret-hook-secret").update('1760000000.{"a":1}').digest("hex")}`);
  });
});
