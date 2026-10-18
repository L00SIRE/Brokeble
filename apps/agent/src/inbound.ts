// The one inbound entry point the MessagingPort calls (Photon consumer or /dev/inbound).
// Foundation default: mark read and emit a system event. Owner A replaces the body with `route(e)` (A plan T3).
// Never log or emit `e.text` (P7).
import type { InboundEvent } from "@tab/shared";
import { emit } from "./events";
import { ports } from "./ports";

export async function handleInbound(e: InboundEvent): Promise<void> {
  await ports.messaging.markRead(e.message_id, `read:${e.message_id}`);
  await emit({ type: "system", level: "info", msg: `inbound ${e.content_type} …${e.message_id.slice(-6)} (router not wired)` });
}
