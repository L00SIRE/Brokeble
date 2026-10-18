import { createHmac } from "node:crypto";
import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  env: { ELEVENLABS_API_KEY: "xi-test", ELEVENLABS_AGENT_ID: "agent_1", ELEVENLABS_PHONE_NUMBER_ID: "pn_1", ELEVENLABS_WEBHOOK_SECRET: "whsec-test-secret-0123" },
  notify: vi.fn(async () => "sent"),
  getPlan: vi.fn(),
  getParticipant: vi.fn(),
  listMembers: vi.fn(),
  getUser: vi.fn(),
}));
vi.mock("../src/env", () => ({ env: m.env }));
vi.mock("../src/log", () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }, errInfo: (e: unknown) => ({ err: String(e) }) }));
vi.mock("../src/notify/notify", () => ({ notify: m.notify, tplKey: (...a: unknown[]) => `tpl:${a.join(":")}` }));
vi.mock("../src/repo/plans", () => ({ getPlan: m.getPlan }));
vi.mock("../src/repo/participants", () => ({ getParticipant: m.getParticipant, listMembers: m.listMembers }));
vi.mock("../src/repo/users", () => ({ getUser: m.getUser }));
vi.mock("../src/repo/bundles", () => ({ getBundle: vi.fn(async () => null) }));
vi.mock("../src/plan/decision", () => ({ bundleTitle: () => "x" }));

import { startOutboundCall, voiceNudgeJob } from "../src/voice/call";
import { mountVoiceHook, verifyElevenLabsSignature } from "../src/voice/hook";

const PLAN = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const plan = { id: PLAN, state: "APPROVING", version: 2, title: "Fri night", chosen_bundle_id: null, deadlines: { approve_at: "2026-10-18T04:40:00Z" } };
const sign = (body: string, ts = Math.floor(Date.now() / 1000)) => `t=${ts},v0=${createHmac("sha256", m.env.ELEVENLABS_WEBHOOK_SECRET).update(`${ts}.${body}`).digest("hex")}`;
const hookBody = (intent: unknown, vars: unknown = { tab_plan_id: PLAN, tab_user_id: USER }) =>
  JSON.stringify({ type: "post_call_transcription", data: { conversation_id: "conv_abc123", conversation_initiation_client_data: { dynamic_variables: vars }, analysis: { data_collection_results: { intent }, transcript_summary: "secret summary" } } });

function app() {
  const a = new Hono();
  mountVoiceHook(a);
  return a;
}

beforeEach(() => {
  vi.clearAllMocks();
  m.getPlan.mockResolvedValue(plan);
  m.getParticipant.mockResolvedValue({ plan_id: PLAN, user_id: USER, stage: "LINK_SENT" });
});

describe("verifyElevenLabsSignature", () => {
  it("accepts a valid signature and rejects tampered, stale or malformed ones", () => {
    const now = 1_800_000_000;
    expect(verifyElevenLabsSignature("{}", sign("{}", now), m.env.ELEVENLABS_WEBHOOK_SECRET, now)).toBe(true);
    expect(verifyElevenLabsSignature("{ }", sign("{}", now), m.env.ELEVENLABS_WEBHOOK_SECRET, now)).toBe(false);
    expect(verifyElevenLabsSignature("{}", sign("{}", now - 31 * 60), m.env.ELEVENLABS_WEBHOOK_SECRET, now)).toBe(false);
    expect(verifyElevenLabsSignature("{}", "garbage", m.env.ELEVENLABS_WEBHOOK_SECRET, now)).toBe(false);
    expect(verifyElevenLabsSignature("{}", undefined, m.env.ELEVENLABS_WEBHOOK_SECRET, now)).toBe(false);
  });
});

describe("POST /voice/hook", () => {
  it("401 without a valid signature", async () => {
    const res = await app().request("/voice/hook", { method: "POST", body: hookBody({ value: "in" }), headers: { "elevenlabs-signature": "t=1,v0=00" } });
    expect(res.status).toBe(401);
    expect(m.notify).not.toHaveBeenCalled();
  });

  it.each([
    ["in", "T_VOICE_RECAP_IN", { title: "Fri night" }],
    ["later", "T_VOICE_RECAP_LATER", { title: "Fri night" }],
    ["out", "T_VOICE_RECAP_OUT", {}],
  ])("intent %s → %s template only (never the ElevenLabs summary)", async (intent, tpl, vars) => {
    const body = hookBody({ value: intent });
    const res = await app().request("/voice/hook", { method: "POST", body, headers: { "elevenlabs-signature": sign(body) } });
    expect(res.status).toBe(200);
    expect(m.notify).toHaveBeenCalledWith(USER, tpl, expect.objectContaining(vars), expect.objectContaining({ planId: PLAN, key: expect.stringContaining("conv_abc123") }));
    expect(JSON.stringify(m.notify.mock.calls)).not.toContain("secret summary");
  });

  it("ignores unusable payloads and plans no longer APPROVING", async () => {
    for (const body of [hookBody({ value: "maybe" }), hookBody({ value: "in" }, { tab_plan_id: "x", tab_user_id: USER })]) {
      expect((await app().request("/voice/hook", { method: "POST", body, headers: { "elevenlabs-signature": sign(body) } })).status).toBe(200);
    }
    m.getPlan.mockResolvedValue({ ...plan, state: "CONFIRMED" });
    const body = hookBody({ value: "in" });
    await app().request("/voice/hook", { method: "POST", body, headers: { "elevenlabs-signature": sign(body) } });
    expect(m.notify).not.toHaveBeenCalled();
  });
});

describe("voice nudge", () => {
  it("startOutboundCall posts the documented body with xi-api-key", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ success: true, conversation_id: "conv_1" }), { status: 200 }));
    const r = await startOutboundCall("+13105550101", { first_name: "Ana", title: "t", deadline: "9:40 PM", tab_plan_id: PLAN, tab_user_id: USER }, f as unknown as typeof fetch);
    expect(r.conversationId).toBe("conv_1");
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.elevenlabs.io/v1/convai/sip-trunk/outbound-call");
    expect((init.headers as Record<string, string>)["xi-api-key"]).toBe("xi-test");
    expect(JSON.parse(init.body as string)).toMatchObject({ agent_id: "agent_1", agent_phone_number_id: "pn_1", to_number: "+13105550101", conversation_initiation_client_data: { dynamic_variables: { first_name: "Ana" } } });
  });

  it("calls only when exactly one LINK_SENT holdout remains", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ success: true, conversation_id: "c" })));
    m.getUser.mockResolvedValue({ id: USER, phone_e164: "+13105550101", first_name: "Ana" });
    m.listMembers.mockResolvedValue([{ user_id: "a", stage: "HELD" }, { user_id: USER, stage: "LINK_SENT" }]);
    await voiceNudgeJob({ plan_id: PLAN, payload: { version: 2 } } as never);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    m.listMembers.mockResolvedValue([{ user_id: "a", stage: "GATED" }, { user_id: USER, stage: "HELD" }]);
    await voiceNudgeJob({ plan_id: PLAN, payload: { version: 2 } } as never);
    m.listMembers.mockResolvedValue([{ user_id: "a", stage: "LINK_SENT" }, { user_id: USER, stage: "LINK_SENT" }]);
    await voiceNudgeJob({ plan_id: PLAN, payload: { version: 2 } } as never);
    await voiceNudgeJob({ plan_id: PLAN, payload: { version: 1 } } as never); // stale version
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    fetchSpy.mockRestore();
  });
});
