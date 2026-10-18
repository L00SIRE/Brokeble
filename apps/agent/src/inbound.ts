// The one inbound entry point the MessagingPort calls (Photon consumer or /dev/inbound). Never log or emit `e.text` (P7).
import type { InboundEvent } from "@tab/shared";
import { route } from "./router/route";

export async function handleInbound(e: InboundEvent): Promise<void> {
  await route(e);
}
