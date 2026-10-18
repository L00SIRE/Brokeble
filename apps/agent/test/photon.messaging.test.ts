import { ApiError, Photon, TransportError } from "@photon-ai/api";
import { describe, expect, it, vi } from "vitest";
import { problemAction, problemCode, retryAfterMs } from "../src/photon/errors";
import { findAssignmentByHandle, PhotonMessaging } from "../src/photon/messaging";

const PROJECT = "pho_prj_test";
const to = { userId: "u1", spaceId: "spc_1", agentUserId: "usr_agent" };

type Call = { method: string; path: string; headers: Headers; body: unknown; query: URLSearchParams };
const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": status >= 400 ? "application/problem+json" : "application/json", ...headers } });

/** A real SDK client over a scripted fetch, so tests pin the actual wire format (paths, header casing, bodies). */
function fake(respond: (c: Call) => Response) {
  const calls: Call[] = [];
  const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const req = new Request(input, init);
    const url = new URL(req.url);
    const text = await req.text();
    const c: Call = { method: req.method, path: url.pathname, headers: req.headers, body: text ? JSON.parse(text) : undefined, query: url.searchParams };
    calls.push(c);
    return respond(c);
  });
  const client = new Photon({ baseUrl: "http://photon.test", fetch: fetchImpl as typeof fetch, retry: false });
  return { client, calls };
}

const T = "2026-10-17T20:00:00.000Z";
const message = (id: string, content: Record<string, unknown> = { type: "text", format: "plain", text: "x" }) => ({
  id, platform: "imessage", status: "dispatched", projectId: PROJECT, createdAt: T, updatedAt: T, metadata: {}, content,
  timestamps: { dispatchedAt: T },
  sentBy: { id: "usr_agent", platform: "imessage", projectId: PROJECT, handle: "+13105550100", kind: "agent", details: {}, metadata: {} },
  space: { id: "spc_1", platform: "imessage", projectId: PROJECT, kind: "direct", details: {}, metadata: {}, participantIds: ["usr_agent", "usr_peer"] },
});
const assignment = (id: string, handle: string, extra: Record<string, unknown> = {}) => ({
  assignmentId: id, assignedPhoneNumber: "+13105550100", handle, platform: "imessage", projectId: PROJECT,
  createdAt: "2026-10-17T20:00:00.000Z", updatedAt: "2026-10-17T20:00:00.000Z", ...extra,
});
const problem = (status: number, code: string) => ({ type: `https://photon.codes/docs/problems/${code.toLowerCase()}`, title: code, status, code });

describe("PhotonMessaging wire format", () => {
  it("sendText posts plain text with the idempotency key and parent message", async () => {
    const { client, calls } = fake(() => json(202, message("msg_1")));
    const m = new PhotonMessaging({ client, projectId: PROJECT });
    await expect(m.sendText(to, "hi", { idempotencyKey: "tpl:p:u:T:1", replyTo: "msg_in" })).resolves.toEqual({ messageId: "msg_1" });
    const [c] = calls;
    expect(c?.method).toBe("POST");
    expect(c?.path).toBe(`/v1/projects/${PROJECT}/messages`);
    expect(c?.headers.get("idempotency-key")).toBe("tpl:p:u:T:1");
    expect(c?.body).toEqual({ spaceId: "spc_1", senderId: "usr_agent", parentMessageId: "msg_in", content: { type: "text", format: "plain", text: "hi" } });
  });

  it("sendText omits parentMessageId without replyTo", async () => {
    const { client, calls } = fake(() => json(202, message("msg_2")));
    await new PhotonMessaging({ client, projectId: PROJECT }).sendText(to, "hi", { idempotencyKey: "k" });
    expect(calls[0]?.body).not.toHaveProperty("parentMessageId");
  });

  it("setTyping posts to the space typing endpoint without a key", async () => {
    const { client, calls } = fake(() => json(202, message("msg_t", { type: "space.typing.update", typing: true })));
    await new PhotonMessaging({ client, projectId: PROJECT }).setTyping(to, true);
    expect(calls[0]?.path).toBe(`/v1/projects/${PROJECT}/spaces/spc_1/typing`);
    expect(calls[0]?.body).toEqual({ senderId: "usr_agent", typing: true });
    expect(calls[0]?.headers.get("idempotency-key")).toBeNull();
  });

  it("markRead posts to the message read endpoint with a key", async () => {
    const { client, calls } = fake(() => json(202, message("msg_r", { type: "message.read" })));
    await new PhotonMessaging({ client, projectId: PROJECT }).markRead("msg_in", "read:evt_1");
    expect(calls[0]?.path).toBe(`/v1/projects/${PROJECT}/messages/msg_in/read`);
    expect(calls[0]?.headers.get("idempotency-key")).toBe("read:evt_1");
  });

  it("assign creates a shared-line assignment with Idempotency-Key", async () => {
    const { client, calls } = fake(() => json(201, assignment("asg_1", "+13105550199")));
    const seat = await new PhotonMessaging({ client, projectId: PROJECT }).assign("+13105550199", " Sam ", "join:p:u");
    expect(seat).toEqual({ assignmentId: "asg_1", assignedPhoneNumber: "+13105550100" });
    expect(calls[0]?.path).toBe(`/v1/projects/${PROJECT}/platforms/imessage/assignments`);
    expect(calls[0]?.headers.get("idempotency-key")).toBe("join:p:u");
    expect(calls[0]?.body).toEqual({ handle: "+13105550199", firstName: "Sam" });
  });

  it("release deletes the assignment", async () => {
    const { client, calls } = fake(() => json(200, assignment("asg_1", "+1", { releasedAt: "2026-10-17T21:00:00.000Z" })));
    await new PhotonMessaging({ client, projectId: PROJECT }).release("asg_1");
    expect(calls[0]?.method).toBe("DELETE");
    expect(calls[0]?.path).toBe(`/v1/projects/${PROJECT}/platforms/imessage/assignments/asg_1`);
  });

  it("start builds the consumer once and starts it", async () => {
    const start = vi.fn(async () => {});
    const consumer = vi.fn(() => ({ start, stop: () => {} }));
    const m = new PhotonMessaging({ client: fake(() => json(500, {})).client, projectId: PROJECT, consumer });
    const onInbound = async () => {};
    await m.start(onInbound);
    await m.start(onInbound);
    expect(consumer).toHaveBeenCalledOnce();
    expect(consumer).toHaveBeenCalledWith({ onInbound });
    expect(start).toHaveBeenCalledOnce();
  });

  it("typing and markRead treat an undecodable 2xx as accepted; sendText does not", async () => {
    const { client } = fake(() => json(202, { unexpected: true }));
    const m = new PhotonMessaging({ client, projectId: PROJECT });
    await expect(m.setTyping(to, false)).resolves.toBeUndefined();
    await expect(m.markRead("msg_in", "k")).resolves.toBeUndefined();
    const err = await m.sendText(to, "hi", { idempotencyKey: "k" }).catch((e: unknown) => e);
    expect(problemCode(err)).toBe("RESPONSE_INVALID");
  });

  it("surfaces problems as ApiError with a mappable code", async () => {
    const { client } = fake(() => json(403, problem(403, "SHARED_LINE_INBOUND_REQUIRED")));
    const err = await new PhotonMessaging({ client, projectId: PROJECT }).sendText(to, "hi", { idempotencyKey: "k" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(problemCode(err)).toBe("SHARED_LINE_INBOUND_REQUIRED");
    expect(problemAction(problemCode(err))).toBe("blocked_inbound");
  });
});

describe("findAssignmentByHandle", () => {
  it("pages until it finds the active seat for the handle", async () => {
    const { client, calls } = fake((c) =>
      c.query.get("pageToken") === "t2"
        ? json(200, { assignments: [assignment("asg_old", "+1999", { releasedAt: "2026-10-17T19:00:00.000Z" }), assignment("asg_9", "+1999")] })
        : json(200, { assignments: [assignment("asg_a", "+1000")], nextPageToken: "t2" }),
    );
    await expect(findAssignmentByHandle("+1999", { client, projectId: PROJECT })).resolves.toEqual({ assignmentId: "asg_9", assignedPhoneNumber: "+13105550100" });
    expect(calls.map((c) => c.query.get("pageSize"))).toEqual(["100", "100"]);
  });

  it("returns null when absent and stops on a repeated page token", async () => {
    const { client, calls } = fake(() => json(200, { assignments: [], nextPageToken: "same" }));
    await expect(findAssignmentByHandle("+1999", { client, projectId: PROJECT })).resolves.toBeNull();
    expect(calls).toHaveLength(2);
  });
});

describe("problem mapping", () => {
  const apiError = (status: number, body: unknown, headers: Record<string, string> = {}) =>
    new ApiError("x", { status, headers: new Headers(headers), body });

  it.each([
    ["SHARED_LINE_INBOUND_REQUIRED", "blocked_inbound"],
    ["SHARED_LINE_NOT_ASSIGNED", "not_assigned"],
    ["SHARED_LINE_CAP_EXCEEDED", "capacity"],
    ["SHARED_LINE_POOL_EXHAUSTED", "capacity"],
    ["ASSIGNMENT_EXISTS", "assignment_exists"],
    ["IDEMPOTENCY_KEY_REUSED", "bug"],
    ["UNSUPPORTED_CONTENT", "bug"],
    ["MESSAGE_TOO_LONG", "bug"],
    ["INVALID_CONTENT", "bug"],
    ["SPACE_NOT_SENDABLE", "stale_route"],
    ["SENDER_NOT_SENDABLE", "stale_route"],
    ["RATE_LIMITED", "rate_limited"],
    ["IDEMPOTENCY_REQUEST_IN_PROGRESS", "transient"],
    ["TRANSPORT", "transient"],
    ["HTTP_502", "transient"],
  ] as const)("%s → %s", (code, action) => expect(problemAction(code)).toBe(action));

  it("reads body.code, falls back to HTTP_<status>, TRANSPORT otherwise", () => {
    expect(problemCode(apiError(409, problem(409, "ASSIGNMENT_EXISTS")))).toBe("ASSIGNMENT_EXISTS");
    expect(problemCode(apiError(429, "too many"))).toBe("HTTP_429");
    expect(problemAction(problemCode(apiError(429, undefined)))).toBe("rate_limited");
    expect(problemCode(apiError(500, { code: "has spaces / url http://x" }))).toBe("HTTP_500");
    expect(problemCode(new TransportError("down"))).toBe("TRANSPORT");
    expect(problemCode(new Error("boom"))).toBe("TRANSPORT");
  });

  it("parses Retry-After seconds and HTTP dates", () => {
    const now = Date.parse("2026-10-17T20:00:00.000Z");
    expect(retryAfterMs(apiError(429, {}, { "retry-after": "90" }), now)).toBe(90_000);
    expect(retryAfterMs(apiError(429, {}, { "retry-after": "Sat, 17 Oct 2026 20:02:00 GMT" }), now)).toBe(120_000);
    expect(retryAfterMs(apiError(429, {}), now)).toBeNull();
    expect(retryAfterMs(apiError(429, {}, { "retry-after": "soon" }), now)).toBeNull();
    expect(retryAfterMs(new Error("x"), now)).toBeNull();
  });
});
