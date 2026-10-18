import { describe, expect, it, vi } from "vitest";
import { createPlan, joinPlan } from "./agentRequest";

const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
const joinBody = { code: "4821", phone_e164: "+13105550123", first_name: "Leo", consent: true } as const;

describe("agentRequest", () => {
  it("returns the parsed body on 200 and posts JSON without credentials", async () => {
    const f = vi.fn(() => json({ assigned_number: "+13105559999", sms_href: "sms:+13105559999&body=JOIN%204821", join_text: "JOIN 4821" }));
    const out = await joinPlan(joinBody, f as unknown as typeof fetch);
    expect(out).toMatchObject({ kind: "ok", data: { join_text: "JOIN 4821" } });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/join");
    expect(init).toMatchObject({ method: "POST", credentials: "omit" });
  });

  it.each([
    [404, "not_found"],
    [409, "plan_closed"],
    [429, "rate_limited"],
    [503, "capacity"],
  ] as const)("surfaces status %i as %s", async (status, error) => {
    const out = await joinPlan(joinBody, (() => json({ error }, status)) as unknown as typeof fetch);
    expect(out).toEqual({ kind: "rejected", status, error, issues: [] });
  });

  it("keeps 422 issues", async () => {
    const issues = [{ path: "phone_e164", message: "Invalid" }];
    const out = await joinPlan(joinBody, (() => json({ error: "invalid", issues }, 422)) as unknown as typeof fetch);
    expect(out).toMatchObject({ kind: "rejected", error: "invalid", issues });
  });

  it("treats a thrown fetch as a network failure", async () => {
    const out = await joinPlan(joinBody, (() => Promise.reject(new TypeError("offline"))) as unknown as typeof fetch);
    expect(out).toEqual({ kind: "network" });
  });

  it("treats a non-JSON error body or a malformed 200 as an unknown rejection", async () => {
    const html = (() => Promise.resolve(new Response("<html>", { status: 502 }))) as unknown as typeof fetch;
    expect(await joinPlan(joinBody, html)).toMatchObject({ kind: "rejected", status: 502, error: "unknown" });
    const bad = (() => json({ nope: true })) as unknown as typeof fetch;
    expect(await createPlan({ title: "t", area: "aa", date: "2026-10-18", time_start: "18:00", time_end: "22:00", party_target: 4, organizer: { phone_e164: "+13105550123", first_name: "M" } }, bad)).toMatchObject({
      kind: "rejected",
      error: "unknown",
    });
  });
});
