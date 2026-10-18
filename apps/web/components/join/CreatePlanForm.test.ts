import { describe, expect, it, vi } from "vitest";
import { submitCreatePlan } from "./CreatePlanForm";

const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};
const ok = {
  code: "4821",
  join_url: "https://tab-web-ten.vercel.app/j/4821",
  assigned_number: "+12135550147",
  sms_body: "Hey SquadTab! Let's get planning.",
  sms_href: "sms:+12135550147&body=x",
  status_token: "tok.sig",
  handoff_url: "https://tab-web-ten.vercel.app/t/tok.sig",
  handoff_qr_svg: "<svg/>",
};

describe("submitCreatePlan (10.4 fallback)", () => {
  it("posts Dinner + show tonight, 5:30 to 11 PM, with a blank organizer name", async () => {
    const f = vi.fn(() => json(ok));
    const out = await submitCreatePlan({ phoneE164: "+13105550123", form: form({ area: " Santa Monica ", party_target: "4" }) }, "2026-10-18", f as unknown as typeof fetch);
    expect(out).toMatchObject({ kind: "ok", data: { code: "4821", status_token: "tok.sig" } });
    const init = (f.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(JSON.parse(String(init.body))).toEqual({
      title: "Dinner + show",
      area: "Santa Monica",
      date: "2026-10-18",
      time_start: "17:30",
      time_end: "23:00",
      party_target: 4,
      organizer: { phone_e164: "+13105550123", first_name: "" },
    });
  });

  it("validates where and how many before any request", async () => {
    const f = vi.fn(() => json(ok));
    const out = await submitCreatePlan({ phoneE164: "+13105550123", form: form({ area: "x", party_target: "9" }) }, "2026-10-18", f as unknown as typeof fetch);
    expect(out).toMatchObject({ kind: "invalid", errors: { area: expect.any(String), party_target: expect.any(String) } });
    expect(f).not.toHaveBeenCalled();
  });

  it("maps server 422 issues onto the two fields", async () => {
    const f = () => json({ error: "invalid", issues: [{ path: "area", message: "Too small" }] }, 422);
    const out = await submitCreatePlan({ phoneE164: "+13105550123", form: form({ area: "Westwood", party_target: "4" }) }, "2026-10-18", f as unknown as typeof fetch);
    expect(out).toMatchObject({ kind: "invalid", errors: { area: expect.any(String) } });
  });
});
