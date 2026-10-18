// MESSAGING_MODE=mock: inbound comes from POST /dev/inbound; outbound is recorded in memory (GET /dev/outbox)
// instead of logged, because texts can carry that member's own budget and pino logs must never hold it (P7).
import { createHash, randomUUID } from "node:crypto";
import type { InboundEvent } from "@tab/shared";
import type { DmAddress, MessagingPort } from "./types";

export type OutboxEntry =
  | { kind: "text"; at: string; to: DmAddress; text: string; idempotencyKey: string; replyTo: string | null; messageId: string }
  | { kind: "typing"; at: string; to: DmAddress; on: boolean }
  | { kind: "read"; at: string; messageId: string; idempotencyKey: string }
  | { kind: "assign"; at: string; handle: string; firstName: string; idempotencyKey: string; assignmentId: string; assignedPhoneNumber: string }
  | { kind: "release"; at: string; assignmentId: string };

const hex = (s: string, n: number) => createHash("sha256").update(s).digest("hex").slice(0, n);

export class MockMessaging implements MessagingPort {
  readonly outbox: OutboxEntry[] = [];
  private onInbound: ((e: InboundEvent) => Promise<void>) | null = null;
  private readonly byKey = new Map<string, OutboxEntry>(); // Photon semantics: same idempotency key → same result

  async start(onInbound: (e: InboundEvent) => Promise<void>): Promise<void> {
    this.onInbound = onInbound;
  }

  /** Feed one inbound event through the registered handler, as the Photon consumer would. */
  async inject(e: InboundEvent): Promise<void> {
    if (!this.onInbound) throw new Error("MockMessaging.start() has not been called");
    await this.onInbound(e);
  }

  async sendText(to: DmAddress, text: string, o: { idempotencyKey: string; replyTo?: string }): Promise<{ messageId: string }> {
    const prior = this.byKey.get(o.idempotencyKey);
    if (prior?.kind === "text") return { messageId: prior.messageId };
    const entry: OutboxEntry = {
      kind: "text", at: new Date().toISOString(), to, text, idempotencyKey: o.idempotencyKey,
      replyTo: o.replyTo ?? null, messageId: `pho_msg_mock_${hex(o.idempotencyKey, 16)}`,
    };
    this.record(entry, o.idempotencyKey);
    return { messageId: entry.messageId };
  }

  async setTyping(to: DmAddress, on: boolean): Promise<void> {
    this.record({ kind: "typing", at: new Date().toISOString(), to, on });
  }

  async markRead(messageId: string, idempotencyKey: string): Promise<void> {
    if (this.byKey.has(idempotencyKey)) return;
    this.record({ kind: "read", at: new Date().toISOString(), messageId, idempotencyKey }, idempotencyKey);
  }

  async assign(handle: string, firstName: string, idempotencyKey: string) {
    const prior = this.byKey.get(idempotencyKey);
    if (prior?.kind === "assign") return { assignmentId: prior.assignmentId, assignedPhoneNumber: prior.assignedPhoneNumber };
    // 555-0100..0199 is reserved for fiction, so a mock number can never reach a real phone.
    const assignedPhoneNumber = `+1310555${String(100 + (parseInt(hex(handle, 4), 16) % 100)).padStart(4, "0")}`;
    const entry = { kind: "assign" as const, at: new Date().toISOString(), handle, firstName, idempotencyKey, assignmentId: `asg_mock_${randomUUID()}`, assignedPhoneNumber };
    this.record(entry, idempotencyKey);
    return { assignmentId: entry.assignmentId, assignedPhoneNumber };
  }

  async release(assignmentId: string): Promise<void> {
    this.record({ kind: "release", at: new Date().toISOString(), assignmentId });
  }

  private record(entry: OutboxEntry, key?: string): void {
    this.outbox.push(entry);
    if (key) this.byKey.set(key, entry);
    if (this.outbox.length > 5000) this.outbox.splice(0, 1000);
  }
}
