import { afterEach, describe, expect, it, vi } from "vitest";

const base = {
  VENUE_PUBLIC_URL: "http://localhost:3001", VENUE_PUBLIC_HOST: "localhost:3001", DATABASE_URL: "postgres://x",
  TAP_KEY_DIRECTORY_JSON: "{}", AGENT_HOOK_URL: "http://localhost:9/h", VENUE_HOOK_SECRET: "h".repeat(16), VENUE_OPS_KEY: "o".repeat(16),
};
async function load(extra: Record<string, string>) {
  vi.resetModules();
  for (const k of ["CYBS_MODE", "CYBS_MERCHANT_ID", "CYBS_KEY_ID", "CYBS_SECRET_KEY"]) delete process.env[k];
  Object.assign(process.env, base, extra);
  return { source: await import("../src/cybs/source"), live: await import("../src/cybs/live") };
}
afterEach(() => vi.resetModules());
const live = { CYBS_MODE: "live", CYBS_KEY_ID: "k", CYBS_SECRET_KEY: "s" };
const args = { code: "c", transactionId: "t", amountCents: 3000, saveCard: false, sandboxTestCard: true, billTo: { first_name: "Priya", last_name: "Shah", postal_code: "90024", email: "priya@x.com" } };

describe("cybsSource labels", () => {
  it("mock → Simulated", async () => {
    const { source } = await load({ CYBS_MODE: "mock", CYBS_MERCHANT_ID: "testrest" });
    expect(source.cybsSource()).toMatchObject({ id: "sim" });
    expect(source.cybsSource().label).toMatch(/Simulated/);
    expect(source.isSharedSandbox()).toBe(false);
  });
  it("live testrest → shared public test merchant", async () => {
    const { source } = await load({ ...live, CYBS_MERCHANT_ID: "testrest" });
    expect(source.cybsSource()).toMatchObject({ id: "testrest" });
    expect(source.isSharedSandbox()).toBe(true);
  });
  it("live other merchant → team merchant", async () => {
    const { source } = await load({ ...live, CYBS_MERCHANT_ID: "lahacksshopexp_1" });
    expect(source.cybsSource()).toMatchObject({ id: "sandbox" });
    expect(source.isSharedSandbox()).toBe(false);
  });
});

describe("authBody billing data", () => {
  it("shared public merchant never receives the typed name, ZIP or email", async () => {
    const { live: l } = await load({ ...live, CYBS_MERCHANT_ID: "testrest" });
    const body = JSON.stringify(l.authBody(args));
    expect(body).not.toMatch(/Priya|Shah|90024|priya@x\.com/);
    expect(body).toContain("94105");
  });
  it("a private merchant keeps the typed billing data", async () => {
    const { live: l } = await load({ ...live, CYBS_MERCHANT_ID: "lahacksshopexp_1" });
    const body = JSON.stringify(l.authBody(args));
    expect(body).toMatch(/Priya/);
    expect(body).toMatch(/90024/);
  });
});
