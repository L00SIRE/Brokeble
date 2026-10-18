// Photon delivery → InboundEvent (A plan T2 field table). Never logs text. Owner A.
// Shapes verified against the Beta OpenAPI: ImessageMessageReceivedEvent {id, type, source, data:{projectId, object}},
// ReceivedImessageMessage {id, platform, space{id,kind}, sentBy{id,handle,kind}, receivedBy?, content, parentMessageId?,
// timestamps{receivedAt}}; message.accepted|dispatched|delivered|failed carry the Message as data.object.
import { InboundEvent } from "@tab/shared";
import * as z from "zod";

export type DeliveryStatus = "accepted" | "dispatched" | "delivered" | "failed";

export type DeliveryClass =
  | { kind: "message"; event: InboundEvent } // message.received from a human in a direct iMessage space
  | { kind: "status"; messageId: string; status: DeliveryStatus } // message.accepted|dispatched|delivered|failed
  | { kind: "ignore"; reason: "not_human" | "not_direct" | "not_imessage" | "no_agent_user_id" | "unknown_type" | "malformed" };

const STATUS_TYPES: Readonly<Record<string, DeliveryStatus>> = {
  "message.accepted": "accepted",
  "message.dispatched": "dispatched",
  "message.delivered": "delivered",
  "message.failed": "failed",
};

const id = z.string().min(1);
const Envelope = z.looseObject({ id, type: z.string(), data: z.looseObject({ object: z.looseObject({}) }) });
const StatusObject = z.looseObject({ id });
const User = z.looseObject({ id, handle: z.string(), kind: z.string() });
const Received = z.looseObject({
  id,
  platform: z.string(),
  space: z.looseObject({ id, kind: z.string() }),
  sentBy: User,
  receivedBy: z.looseObject({ id }).optional(),
  content: z.looseObject({ type: z.string(), text: z.unknown().optional() }),
  parentMessageId: z.string().optional(),
  timestamps: z.looseObject({ receivedAt: z.string() }),
});

/** Event id when the delivery carries one; the consumer dedupes on it before (and independently of) classification. */
export function deliveryEventId(event: unknown): string | null {
  const r = z.looseObject({ id }).safeParse(event);
  return r.success ? r.data.id : null;
}

/**
 * Classifies one `delivery` event. For message.received: drops sentBy.kind ≠ "human", space.kind ≠ "direct" and
 * non-iMessage; agent_user_id = receivedBy?.id ?? await lookupAgentUserId(sentBy.id) (null → ignore
 * "no_agent_user_id"); text only when content.type === "text"; received_at = timestamps.receivedAt.
 */
export async function normalizeDelivery(
  event: unknown,
  seq: number,
  lookupAgentUserId: (photonUserId: string) => Promise<string | null>,
): Promise<DeliveryClass> {
  const env = Envelope.safeParse(event);
  if (!env.success) return { kind: "ignore", reason: "malformed" };
  const { type, data } = env.data;

  const status = STATUS_TYPES[type];
  if (status) {
    const o = StatusObject.safeParse(data.object);
    return o.success ? { kind: "status", messageId: o.data.id, status } : { kind: "ignore", reason: "malformed" };
  }
  if (type !== "message.received") return { kind: "ignore", reason: "unknown_type" };

  const m = Received.safeParse(data.object);
  if (!m.success) return { kind: "ignore", reason: "malformed" };
  const o = m.data;
  if (o.platform !== "imessage") return { kind: "ignore", reason: "not_imessage" };
  if (o.sentBy.kind !== "human") return { kind: "ignore", reason: "not_human" };
  if (o.space.kind !== "direct") return { kind: "ignore", reason: "not_direct" };

  const agentUserId = o.receivedBy?.id ?? (await lookupAgentUserId(o.sentBy.id));
  if (!agentUserId) return { kind: "ignore", reason: "no_agent_user_id" };

  const parsed = InboundEvent.safeParse({
    event_id: env.data.id,
    seq,
    message_id: o.id,
    platform: "imessage",
    from_handle: o.sentBy.handle,
    from_user_id: o.sentBy.id,
    agent_user_id: agentUserId,
    space_id: o.space.id,
    space_kind: o.space.kind,
    content_type: o.content.type,
    text: o.content.type === "text" && typeof o.content.text === "string" ? o.content.text : null,
    parent_message_id: o.parentMessageId ?? null,
    received_at: o.timestamps.receivedAt,
  });
  return parsed.success ? { kind: "message", event: parsed.data } : { kind: "ignore", reason: "malformed" };
}
