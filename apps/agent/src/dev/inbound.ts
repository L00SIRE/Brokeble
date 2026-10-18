// Dev-only routes, mounted when MESSAGING_MODE=mock outside production (PLAN §15 backup: drive flows without Photon).
//   POST /dev/inbound                     simulate one iMessage DM → InboundEvent → the registered inbound handler
//   GET  /dev/outbox?since=n              what the mock MessagingPort "sent" (texts, typing, reads, assignments)
//   POST /dev/venue/authorize/:shareId    VENUE_MODE=mock: simulate a hold, then post the HMAC-signed VenueEvent to /venue/hook
import { createHmac, randomUUID } from "node:crypto";
import { Hono } from "hono";
import * as z from "zod";
import { InboundEvent } from "@tab/shared";
import { env } from "../env";
import { MockMessaging, MockVenue, type Ports } from "../ports";

/** Body of POST /dev/inbound: only `from_handle` is required; everything else gets a stable mock default. */
export const DevInboundBody = z.strictObject({
  from_handle: z.e164(),
  text: z.string().max(2000).nullable().default(null),
  content_type: z.string().default("text"),
  from_user_id: z.string().optional(),
  space_id: z.string().optional(),
  agent_user_id: z.string().optional(),
  message_id: z.string().optional(),
  event_id: z.string().optional(),
  parent_message_id: z.string().nullable().default(null),
});
export type DevInboundBody = z.input<typeof DevInboundBody>;

let seq = 0;
export function toInboundEvent(b: z.output<typeof DevInboundBody>): InboundEvent {
  const digits = b.from_handle.replace(/\D/g, "");
  return InboundEvent.parse({
    event_id: b.event_id ?? `evt_mock_${randomUUID()}`,
    seq: ++seq,
    message_id: b.message_id ?? `pho_msg_mock_${randomUUID()}`,
    platform: "imessage",
    from_handle: b.from_handle,
    from_user_id: b.from_user_id ?? `mock_usr_${digits}`,
    agent_user_id: b.agent_user_id ?? "mock_usr_tab_agent",
    space_id: b.space_id ?? `mock_spc_${digits}`,
    space_kind: "direct",
    content_type: b.content_type,
    text: b.content_type === "text" ? b.text : null,
    parent_message_id: b.parent_message_id,
    received_at: new Date().toISOString(),
  });
}

/** PLAN §18 venue → agent hook signature: sha256=<hex HMAC(VENUE_HOOK_SECRET, ts + "." + body)>, ts in unix seconds. */
export function signVenueHook(body: string, secret: string, ts = Math.floor(Date.now() / 1000)): Record<string, string> {
  const sig = createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex");
  return { "content-type": "application/json", "x-tab-timestamp": String(ts), "x-tab-signature": `sha256=${sig}` };
}

export function devRoutes(p: Ports): Hono {
  const app = new Hono();
  const messaging = p.messaging;
  if (!(messaging instanceof MockMessaging)) throw new Error("dev routes require MESSAGING_MODE=mock");

  app.post("/dev/inbound", async (c) => {
    const parsed = DevInboundBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ ok: false, error: z.prettifyError(parsed.error) }, 400);
    const event = toInboundEvent(parsed.data);
    await messaging.inject(event); // errors surface as 500 via app.onError, like a failed Photon delivery
    return c.json({ ok: true, event_id: event.event_id, message_id: event.message_id, seq: event.seq });
  });

  app.get("/dev/outbox", (c) => {
    const since = Math.max(0, Number(c.req.query("since") ?? 0) || 0);
    return c.json({ entries: messaging.outbox.slice(since), next: messaging.outbox.length });
  });

  const venue = p.venue;
  if (venue instanceof MockVenue) {
    app.post("/dev/venue/authorize/:shareId", async (c) => {
      const body = z.object({ outcome: z.enum(["authorized", "declined"]).default("authorized") }).parse(await c.req.json().catch(() => ({})));
      const event = venue.authorize(c.req.param("shareId"), body.outcome);
      if (!env.VENUE_HOOK_SECRET) return c.json({ ok: true, event, hook_status: null, note: "VENUE_HOOK_SECRET unset; hook not called" });
      const raw = JSON.stringify(event);
      const res = await fetch(new URL("/venue/hook", c.req.url), { method: "POST", headers: signVenueHook(raw, env.VENUE_HOOK_SECRET), body: raw });
      return c.json({ ok: true, event, hook_status: res.status });
    });
  }
  return app;
}
