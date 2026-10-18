import { afterEach, describe, expect, it, vi } from "vitest";

const base = {
  VENUE_PUBLIC_URL: "http://localhost:3001", VENUE_PUBLIC_HOST: "localhost:3001", DATABASE_URL: "postgres://x", CYBS_MODE: "mock",
  TAP_KEY_DIRECTORY_JSON: "{}", AGENT_HOOK_URL: "http://localhost:9/h", VENUE_HOOK_SECRET: "h".repeat(16), VENUE_OPS_KEY: "o".repeat(16),
  CYBS_MERCHANT_ID: "m", CYBS_KEY_ID: "k", CYBS_SECRET_KEY: "s",
};
async function load(extra: Record<string, string> = {}) {
  vi.resetModules();
  for (const k of ["CYBS_RUN_ENV", "CYBS_AUTH_TYPE"]) delete process.env[k];
  Object.assign(process.env, base, extra);
  return import("../src/cybs/config");
}
afterEach(() => vi.resetModules());

describe("cybsConfig", () => {
  it("defaults to JWT shared-secret on apitest (unchanged behaviour)", async () => {
    const { cybsConfig } = await load();
    expect(cybsConfig()).toMatchObject({ authenticationType: "jwt", jwtKeyType: "SHARED_SECRET", runEnvironment: "apitest.cybersource.com", merchantID: "m", merchantKeyId: "k", merchantsecretKey: "s" });
  });
  it("supports http_signature on testrest with the same key id and secret", async () => {
    const { cybsConfig } = await load({ CYBS_AUTH_TYPE: "http_signature", CYBS_RUN_ENV: "testrest.cybersource.com" });
    const c = cybsConfig() as Record<string, unknown>;
    expect(c).toMatchObject({ authenticationType: "http_signature", runEnvironment: "testrest.cybersource.com", merchantKeyId: "k", merchantsecretKey: "s" });
    expect("jwtKeyType" in c).toBe(false);
  });
  it("only test hosts count as sandbox", async () => {
    const { isSandboxHost } = await load();
    expect(isSandboxHost("apitest.cybersource.com")).toBe(true);
    expect(isSandboxHost("testrest.cybersource.com")).toBe(true);
    expect(isSandboxHost("api.cybersource.com")).toBe(false);
  });
});
