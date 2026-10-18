import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { parseEnv } from "../src/env";
import { createLogger } from "../src/log";

const DB = "postgres://u@127.0.0.1:5432/db";

describe("parseEnv", () => {
  it("defaults every mode to mock and treats blank values as unset", () => {
    const e = parseEnv({ DATABASE_URL: DB, PORT: "", LLM_MODE: " ", DEMO_TIMERS: "1" });
    expect([e.MESSAGING_MODE, e.LLM_MODE, e.PLANNER_MODE, e.VENUE_MODE]).toEqual(["mock", "mock", "mock", "mock"]);
    expect(e.PORT).toBe(8080);
    expect(e.DEMO_TIMERS).toBe(true);
  });

  it("requires each real mode's secrets, naming keys but never echoing values", () => {
    expect(() => parseEnv({ DATABASE_URL: DB, MESSAGING_MODE: "photon" })).toThrow(/PHOTON_API_KEY[\s\S]*PHOTON_PROJECT_ID|PHOTON_PROJECT_ID[\s\S]*PHOTON_API_KEY/);
    expect(() => parseEnv({ DATABASE_URL: DB, VENUE_MODE: "live" })).toThrow(/TAP_PRIVATE_KEY_PEM_B64/);
    const secret = "capi_short";
    try {
      parseEnv({ DATABASE_URL: DB, PLANNER_MODE: "live", CREAO_API_KEY: secret, CREAO_HOOK_SECRET: "too-short-secret-value" });
      expect.unreachable();
    } catch (e) {
      expect(String(e)).toMatch(/CREAO_HOOK_SECRET/);
      expect(String(e)).not.toContain("too-short-secret-value");
    }
  });

  it("requires DATABASE_URL", () => {
    expect(() => parseEnv({})).toThrow(/DATABASE_URL/);
  });

  it("mock mode boots with every optional var missing, using the PLAN §11 defaults", () => {
    const e = parseEnv({ DATABASE_URL: DB });
    expect(e.OWNER_DATABASE_URL).toBeUndefined();
    expect(e.TEST_DATABASE_URL).toBeUndefined();
    expect(e.AGENT_API_ALLOW_TEST_REF).toBe(false);
    expect(e.DEMO_TEAM).toEqual([]);
    expect(e.DEMO_CODE).toBe("4821");
    expect(e.TYPING_REFRESH_MS).toBe(5000);
    expect(e.VOICE_ENABLED).toBe(false);
  });

  it("parses the new vars", () => {
    const e = parseEnv({
      DATABASE_URL: DB, OWNER_DATABASE_URL: DB, TEST_DATABASE_URL: DB, AGENT_API_ALLOW_TEST_REF: "1", DEMO_CODE: "1234",
      TYPING_REFRESH_MS: "8000", DEMO_TEAM: '[{"phone_e164":"+13105550101","first_name":"Ana"}]',
    });
    expect(e.AGENT_API_ALLOW_TEST_REF).toBe(true);
    expect(e.DEMO_CODE).toBe("1234");
    expect(e.TYPING_REFRESH_MS).toBe(8000);
    expect(e.DEMO_TEAM).toEqual([{ phone_e164: "+13105550101", first_name: "Ana" }]);
    expect(() => parseEnv({ DATABASE_URL: DB, DEMO_CODE: "48a1" })).toThrow(/DEMO_CODE/);
  });

  it("DEMO_TEAM errors name the key but never echo the PII value", () => {
    for (const bad of ["[{phone_e164:+13105550199}", '[{"phone_e164":"3105550199","first_name":"Zed"}]']) {
      try {
        parseEnv({ DATABASE_URL: DB, DEMO_TEAM: bad });
        expect.unreachable();
      } catch (e) {
        expect(String(e)).toMatch(/DEMO_TEAM/);
        expect(String(e)).not.toContain("3105550199");
        expect(String(e)).not.toContain("Zed");
      }
    }
  });

  it("VOICE_ENABLED=1 requires the ElevenLabs set", () => {
    expect(() => parseEnv({ DATABASE_URL: DB, VOICE_ENABLED: "1" })).toThrow(/ELEVENLABS_API_KEY[\s\S]*ELEVENLABS_WEBHOOK_SECRET/);
    const e = parseEnv({
      DATABASE_URL: DB, VOICE_ENABLED: "1", ELEVENLABS_API_KEY: "k", ELEVENLABS_AGENT_ID: "a", ELEVENLABS_PHONE_NUMBER_ID: "p", ELEVENLABS_WEBHOOK_SECRET: "s",
    });
    expect(e.VOICE_ENABLED).toBe(true);
  });
});

describe("logger redaction", () => {
  it("censors message text, budgets, phones, pay links and auth headers", () => {
    const lines: string[] = [];
    const sink = new Writable({ write: (chunk, _enc, cb) => (lines.push(String(chunk)), cb()) });
    const log = createLogger(sink);
    log.level = "info";
    log.info({ text: "honestly 30 tops", e: { target_pp_cents: 3117, phone_e164: "+13105550123" }, pay_url: "https://v/pay/x", headers: { authorization: "Bearer s" }, lane: 2 }, "x");
    const out = lines.join("");
    for (const leak of ["30 tops", "3117", "+13105550123", "/pay/x", "Bearer s"]) expect(out).not.toContain(leak);
    expect(out).toContain('"lane":2');
  });
});
