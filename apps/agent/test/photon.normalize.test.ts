import { describe, expect, it, vi } from "vitest";
import { deliveryEventId, normalizeDelivery } from "../src/photon/normalize";

const received = (over: Record<string, unknown> = {}, objOver: Record<string, unknown> = {}) => ({
  id: "evt_1",
  type: "message.received",
  apiVersion: "2026-07-01",
  source: "imessage.photon",
  timestamp: "2026-10-17T20:00:01Z",
  data: {
    projectId: "pho_prj_x",
    object: {
      id: "pho_msg_abcdef123456",
      projectId: "pho_prj_x",
      platform: "imessage",
      status: "received",
      space: { id: "spc_1", kind: "direct", platform: "imessage" },
      sentBy: { id: "usr_human", handle: "+13105550100", kind: "human", platform: "imessage" },
      receivedBy: { id: "usr_agent", handle: "+13105550199", kind: "agent", platform: "imessage" },
      content: { type: "text", format: "plain", text: "JOIN 4821" },
      timestamps: { receivedAt: "2026-10-17T20:00:00Z" },
      ...objOver,
    },
  },
  ...over,
});

const noLookup = vi.fn(async () => null);

describe("normalizeDelivery", () => {
  it("maps message.received to InboundEvent", async () => {
    const r = await normalizeDelivery(received(), 42, noLookup);
    expect(r).toEqual({
      kind: "message",
      event: {
        event_id: "evt_1",
        seq: 42,
        message_id: "pho_msg_abcdef123456",
        platform: "imessage",
        from_handle: "+13105550100",
        from_user_id: "usr_human",
        agent_user_id: "usr_agent",
        space_id: "spc_1",
        space_kind: "direct",
        content_type: "text",
        text: "JOIN 4821",
        parent_message_id: null,
        received_at: "2026-10-17T20:00:00Z",
      },
    });
    expect(noLookup).not.toHaveBeenCalled();
  });

  it("falls back to the dm_routes lookup when receivedBy is missing", async () => {
    const lookup = vi.fn(async (id: string) => (id === "usr_human" ? "usr_agent_db" : null));
    const r = await normalizeDelivery(received({}, { receivedBy: undefined, parentMessageId: "pho_msg_parent" }), 1, lookup);
    expect(r.kind === "message" && r.event.agent_user_id).toBe("usr_agent_db");
    expect(r.kind === "message" && r.event.parent_message_id).toBe("pho_msg_parent");
    expect(await normalizeDelivery(received({}, { receivedBy: undefined }), 1, noLookup)).toEqual({ kind: "ignore", reason: "no_agent_user_id" });
  });

  it("nulls text for non-text content", async () => {
    const r = await normalizeDelivery(received({}, { content: { type: "attachment", attachmentId: "att_1" } }), 1, noLookup);
    expect(r.kind === "message" && [r.event.content_type, r.event.text]).toEqual(["attachment", null]);
  });

  it("drops non-human, group and non-iMessage senders", async () => {
    const human = received().data.object.sentBy;
    expect(await normalizeDelivery(received({}, { sentBy: { ...human, kind: "agent" } }), 1, noLookup)).toEqual({ kind: "ignore", reason: "not_human" });
    expect(await normalizeDelivery(received({}, { space: { id: "spc_g", kind: "group" } }), 1, noLookup)).toEqual({ kind: "ignore", reason: "not_direct" });
    expect(await normalizeDelivery(received({}, { platform: "sms" }), 1, noLookup)).toEqual({ kind: "ignore", reason: "not_imessage" });
  });

  it("classifies delivery status events", async () => {
    for (const s of ["accepted", "dispatched", "delivered", "failed"] as const) {
      const ev = { id: `evt_${s}`, type: `message.${s}`, data: { projectId: "p", object: { id: "pho_msg_out1", status: s } } };
      expect(await normalizeDelivery(ev, 2, noLookup)).toEqual({ kind: "status", messageId: "pho_msg_out1", status: s });
    }
  });

  it("ignores unknown and malformed events", async () => {
    expect(await normalizeDelivery({ id: "e", type: "space.typing.updated", data: { object: {} } }, 1, noLookup)).toEqual({ kind: "ignore", reason: "unknown_type" });
    expect(await normalizeDelivery(null, 1, noLookup)).toEqual({ kind: "ignore", reason: "malformed" });
    expect(await normalizeDelivery(received({}, { timestamps: {} }), 1, noLookup)).toEqual({ kind: "ignore", reason: "malformed" });
    expect(await normalizeDelivery(received({}, { timestamps: { receivedAt: "not-a-date" } }), 1, noLookup)).toEqual({ kind: "ignore", reason: "malformed" });
  });

  it("extracts event ids", () => {
    expect(deliveryEventId(received())).toBe("evt_1");
    expect(deliveryEventId({})).toBeNull();
  });
});
