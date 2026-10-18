import { describe, expect, it, vi } from "vitest";
import { createPlan, fetchStatus, joinPlan, startOrganizer } from "./agentRequest";

const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
const asFetch = (f: unknown) => f as typeof fetch;

const handoff = {
  assigned_number: "+12135550147",
  sms_body: "Hey SquadTab! Help me plan a night out.",
  sms_href: "sms:+12135550147&body=Hey%20SquadTab!%20Help%20me%20plan%20a%20night%20out.",
  status_token: "eyJ1IjoidSJ9.sig",
  handoff_url: "https://tab-web-ten.vercel.app/t/eyJ1IjoidSJ9.sig",
  handoff_qr_svg: '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h7"/></svg>',
};
const preview = { code: "4821", title: "Dinner + show", date_label: "Sat, Oct 24", time_label: "7:00 PM", area: "Santa Monica", organizer_first_name: "Maya", joined: 2, party_target: 4, status: "open" };
const joinBody = { code: "4821", phone_e164: "+13105550123", consent: true } as const;
const status = { phase: "waiting", role: "organizer", phone_last4: "0123", assigned_number: "+12135550147", sms_body: handoff.sms_body, first_name: null, plan: null, steps: null };

describe("POST wrappers", () => {
  it("starts an organizer seat with phone + consent only, without credentials", async () => {
    const f = vi.fn(() => json(handoff));
    const out = await startOrganizer({ phone_e164: "+13105550123", consent: true }, asFetch(f));
    expect(out).toEqual({ kind: "ok", data: handoff });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/start");
    expect(init).toMatchObject({ method: "POST", credentials: "omit" });
    expect(JSON.parse(String(init.body))).toEqual({ phone_e164: "+13105550123", consent: true });
  });

  it("parses the extended join response (no first name, no budget sent)", async () => {
    const f = vi.fn(() => json({ ...handoff, join_text: "I'm in for Dinner + show!", already_joined: false, plan: preview }));
    const out = await joinPlan(joinBody, asFetch(f));
    expect(out).toMatchObject({ kind: "ok", data: { already_joined: false, plan: { code: "4821" } } });
  });

  it.each([
    [404, "not_found"],
    [409, "plan_closed"],
    [409, "plan_full"],
    [429, "rate_limited"],
    [503, "capacity"],
  ] as const)("surfaces status %i as %s", async (code, error) => {
    const out = await joinPlan(joinBody, asFetch(() => json({ error }, code)));
    expect(out).toEqual({ kind: "rejected", status: code, error, issues: [] });
  });

  it("keeps 422 issues", async () => {
    const issues = [{ path: "phone_e164", message: "Invalid" }];
    const out = await startOrganizer({ phone_e164: "+13105550123", consent: true }, asFetch(() => json({ error: "invalid", issues }, 422)));
    expect(out).toMatchObject({ kind: "rejected", error: "invalid", issues });
  });

  it("treats a thrown fetch as a network failure", async () => {
    const out = await joinPlan(joinBody, asFetch(() => Promise.reject(new TypeError("offline"))));
    expect(out).toEqual({ kind: "network" });
  });

  it("treats a non-JSON error body or a malformed 200 as an unknown rejection", async () => {
    expect(await joinPlan(joinBody, asFetch(() => Promise.resolve(new Response("<html>", { status: 502 }))))).toMatchObject({ kind: "rejected", status: 502, error: "unknown" });
    const body = { title: "t", area: "aa", date: "2026-10-18", time_start: "19:00", time_end: "23:00", party_target: 4, organizer: { phone_e164: "+13105550123", first_name: "" } };
    expect(await createPlan(body, asFetch(() => json({ nope: true })))).toMatchObject({ kind: "rejected", error: "unknown" });
  });

  it("accepts /plans without the deprecated qr_svg", async () => {
    const body = { title: "Dinner + show", area: "Santa Monica", date: "2026-10-18", time_start: "19:00", time_end: "23:00", party_target: 4, organizer: { phone_e164: "+13105550123", first_name: "" } };
    const out = await createPlan(body, asFetch(() => json({ ...handoff, code: "4821", join_url: "https://tab-web-ten.vercel.app/j/4821" })));
    expect(out).toMatchObject({ kind: "ok", data: { code: "4821" } });
  });
});

describe("fetchStatus", () => {
  it("GETs /status with the token encoded, no credentials and no cache", async () => {
    const f = vi.fn(() => json(status));
    const out = await fetchStatus("a+b/c", { fetchImpl: asFetch(f) });
    expect(out).toEqual({ kind: "ok", data: status });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/status?t=a%2Bb%2Fc");
    expect(init).toMatchObject({ credentials: "omit", cache: "no-store" });
  });

  it("maps 401 to expired, 429 to rate_limited and everything else to failed", async () => {
    expect(await fetchStatus("t", { fetchImpl: asFetch(() => json({}, 401)) })).toEqual({ kind: "expired" });
    expect(await fetchStatus("t", { fetchImpl: asFetch(() => json({}, 429)) })).toEqual({ kind: "rate_limited" });
    expect(await fetchStatus("t", { fetchImpl: asFetch(() => json({}, 500)) })).toEqual({ kind: "failed" });
    expect(await fetchStatus("t", { fetchImpl: asFetch(() => json({ phase: "bogus" })) })).toEqual({ kind: "failed" });
    expect(await fetchStatus("t", { fetchImpl: asFetch(() => Promise.reject(new TypeError("offline"))) })).toEqual({ kind: "failed" });
  });

  it("accepts a released seat (assigned_number null)", async () => {
    const out = await fetchStatus("t", { fetchImpl: asFetch(() => json({ ...status, assigned_number: null })) });
    expect(out).toMatchObject({ kind: "ok", data: { assigned_number: null } });
  });
});
