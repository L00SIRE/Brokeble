// MESSAGING_MODE=photon. Owner A: implement here or in src/photon/messaging.ts and re-export it from this file
// (PLAN §10 Photon facts; docs/plans/A-platform-conversation.md T1/T2).
import type { InboundEvent } from "@tab/shared";
import type { DmAddress, MessagingPort } from "./types";
import { notImplemented } from "./notImplemented";

export class PhotonMessaging implements MessagingPort {
  async start(_onInbound: (e: InboundEvent) => Promise<void>): Promise<void> {
    notImplemented("PhotonMessaging.start", "A");
  }
  async sendText(_to: DmAddress, _text: string, _o: { idempotencyKey: string; replyTo?: string }): Promise<{ messageId: string }> {
    return notImplemented("PhotonMessaging.sendText", "A");
  }
  async setTyping(_to: DmAddress, _on: boolean): Promise<void> {
    notImplemented("PhotonMessaging.setTyping", "A");
  }
  async markRead(_messageId: string, _idempotencyKey: string): Promise<void> {
    notImplemented("PhotonMessaging.markRead", "A");
  }
  async assign(_handle: string, _firstName: string, _idempotencyKey: string): Promise<{ assignmentId: string; assignedPhoneNumber: string }> {
    return notImplemented("PhotonMessaging.assign", "A");
  }
  async release(_assignmentId: string): Promise<void> {
    notImplemented("PhotonMessaging.release", "A");
  }
}
