// MESSAGING_MODE=photon: the real MessagingPort (PLAN §9/§10, A plan T1). The Integrate stage repoints
// ports/index.ts here. Header casing differs by operation (TypeScript enforces it): sendMessage/markMessageRead take
// "idempotency-key"; assignments.create takes idempotencyKey; setSpaceTyping takes none. Owner A.
import { type Photon, ResponseValidationError } from "@photon-ai/api";
import type { InboundEvent } from "@tab/shared";
import type { DmAddress, MessagingPort } from "../ports";
import { photonClient, projectId } from "./client";
import { type ConsumerDeps, createPhotonConsumer, type PhotonConsumer } from "./consumer";

export type Seat = { assignmentId: string; assignedPhoneNumber: string };

/**
 * The SDK strictly validates 2xx bodies against the (beta) contract. For calls whose result we discard, a
 * ResponseValidationError still means the server accepted the request, so it is not a failure.
 */
async function acceptedIgnoringBody(p: Promise<unknown>): Promise<void> {
  try {
    await p;
  } catch (e) {
    if (!(e instanceof ResponseValidationError)) throw e;
  }
}

type Options = {
  client?: Photon;
  consumer?: (deps: ConsumerDeps) => PhotonConsumer;
  /** Defaults to PHOTON_PROJECT_ID (tests inject one). */
  projectId?: string;
};

export class PhotonMessaging implements MessagingPort {
  #consumer: PhotonConsumer | undefined;

  /** `client` defaults to photonClient(); `consumer` defaults to createPhotonConsumer (tests inject both). */
  constructor(readonly o: Options = {}) {}

  // Resolved per call so constructing the adapter never throws; env validation makes these present in photon mode.
  get #client(): Photon {
    return this.o.client ?? photonClient();
  }
  get #id(): string {
    return this.o.projectId ?? projectId();
  }

  /** Starts the Socket.IO consumer with `onInbound` (cursor + dedupe semantics in consumer.ts). Idempotent. */
  async start(onInbound: (e: InboundEvent) => Promise<void>): Promise<void> {
    if (this.#consumer) return;
    this.#consumer = (this.o.consumer ?? createPhotonConsumer)({ onInbound });
    await this.#consumer.start();
  }

  /** projects.sendMessage({spaceId, senderId: agentUserId, parentMessageId?, content:{type:"text",format:"plain",text}}) → 202 Message.id. */
  async sendText(to: DmAddress, text: string, o: { idempotencyKey: string; replyTo?: string }): Promise<{ messageId: string }> {
    const m = await this.#client.projects.sendMessage({
      path: { id: this.#id },
      headers: { "idempotency-key": o.idempotencyKey },
      body: {
        spaceId: to.spaceId,
        senderId: to.agentUserId,
        ...(o.replyTo ? { parentMessageId: o.replyTo } : {}),
        content: { type: "text", format: "plain", text },
      },
    });
    // Message is an open union (an UNKNOWN-platform variant has no typed id); a resend with the same key replays safely.
    if (typeof m.id !== "string") throw new Error("Photon sendMessage response carried no message id");
    return { messageId: m.id };
  }

  /** projects.setSpaceTyping; `true` starts or refreshes (callers own the refresh cadence, TYPING_REFRESH_MS). Unkeyed, so sent once. */
  async setTyping(to: DmAddress, on: boolean): Promise<void> {
    await acceptedIgnoringBody(
      this.#client.projects.setSpaceTyping({
        path: { id: this.#id, spaceId: to.spaceId },
        body: { senderId: to.agentUserId, typing: on },
      }),
    );
  }

  /** projects.markMessageRead({path:{id, messageId}, headers:{"idempotency-key"}}). */
  async markRead(messageId: string, idempotencyKey: string): Promise<void> {
    await acceptedIgnoringBody(
      this.#client.projects.markMessageRead({ path: { id: this.#id, messageId }, headers: { "idempotency-key": idempotencyKey } }),
    );
  }

  /** platforms.imessage.assignments.create → 201 {assignmentId, assignedPhoneNumber}. Throws ApiError (see errors.ts). */
  async assign(handle: string, firstName: string, idempotencyKey: string): Promise<Seat> {
    const name = firstName.trim();
    const a = await this.#client.projects.platforms.imessage.assignments.create({
      path: { id: this.#id },
      headers: { idempotencyKey },
      body: { handle, ...(name ? { firstName: name } : {}) },
    });
    return { assignmentId: a.assignmentId, assignedPhoneNumber: a.assignedPhoneNumber };
  }

  /** platforms.imessage.assignments.release: DELETE …/assignments/{id} → 200 with releasedAt; repeat-safe. */
  async release(assignmentId: string): Promise<void> {
    await this.#client.projects.platforms.imessage.assignments.release({ path: { id: this.#id, assignmentId } });
  }
}

/**
 * ASSIGNMENT_EXISTS recovery (photon mode only): pages assignments.list({query:{pageSize:100, pageToken}}) and
 * returns the active seat whose handle equals `handle`, or null.
 */
export async function findAssignmentByHandle(
  handle: string,
  o: { client?: Photon; projectId?: string } = {},
): Promise<Seat | null> {
  const client = o.client ?? photonClient();
  const id = o.projectId ?? projectId();
  const seen = new Set<string>();
  let pageToken: string | undefined;
  do {
    const page = await client.projects.platforms.imessage.assignments.list({
      path: { id },
      query: { pageSize: 100, ...(pageToken ? { pageToken } : {}) },
    });
    const hit = page.assignments.find((a) => a.handle === handle && !a.releasedAt);
    if (hit) return { assignmentId: hit.assignmentId, assignedPhoneNumber: hit.assignedPhoneNumber };
    pageToken = page.nextPageToken;
    if (pageToken && seen.has(pageToken)) break; // defensive: a repeated token would loop forever
    if (pageToken) seen.add(pageToken);
  } while (pageToken);
  return null;
}
