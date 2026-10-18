import { describe, expect, it } from "vitest";
import { clearSession, type FlowSession, joinSessionKey, last4, loadSession, ORGANIZER_SESSION_KEY, SESSION_TTL_MS, saveSession } from "./session";

function memoryStore() {
  const m = new Map<string, string>();
  return {
    m,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
}

const NOW = 1_800_000_000_000;
const session: FlowSession = { v: 1, token: "tok.sig", role: "organizer", phone_last4: "0123", assigned_number: "+12135550147", sms_body: "Hey SquadTab! Help me plan a night out.", issued_at: NOW };

describe("session", () => {
  it("round-trips and never stores the full phone number", () => {
    const s = memoryStore();
    saveSession(ORGANIZER_SESSION_KEY, session, s);
    expect(loadSession(ORGANIZER_SESSION_KEY, NOW + 1000, s)).toEqual(session);
    const raw = s.m.get(ORGANIZER_SESSION_KEY) ?? "";
    expect(raw).not.toContain("3105550123");
    expect(Object.keys(JSON.parse(raw))).not.toContain("phone_e164");
  });

  it("drops expired, future-dated and malformed entries", () => {
    const s = memoryStore();
    saveSession("k", session, s);
    expect(loadSession("k", NOW + SESSION_TTL_MS + 1, s)).toBeNull();
    expect(s.m.has("k")).toBe(false);
    s.m.set("k", JSON.stringify({ ...session, issued_at: NOW + 3_600_000 }));
    expect(loadSession("k", NOW, s)).toBeNull();
    s.m.set("k", "{not json");
    expect(loadSession("k", NOW, s)).toBeNull();
    s.m.set("k", JSON.stringify({ ...session, phone_last4: "+13105550123" }));
    expect(loadSession("k", NOW, s)).toBeNull();
  });

  it("survives a storage that throws or is missing", () => {
    const throwing = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceeded");
      },
      removeItem: () => {
        throw new Error("SecurityError");
      },
    };
    expect(loadSession("k", NOW, throwing)).toBeNull();
    expect(() => saveSession("k", session, throwing)).not.toThrow();
    expect(() => clearSession("k", throwing)).not.toThrow();
    expect(loadSession("k", NOW, null)).toBeNull();
  });

  it("keys friend sessions per plan code and takes the last 4 digits", () => {
    expect(joinSessionKey("4821")).toBe("squadtab.join.v1.4821");
    expect(last4("+13105550123")).toBe("0123");
  });
});
