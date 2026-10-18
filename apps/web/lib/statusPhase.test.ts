import { describe, expect, it } from "vitest";
import type { StatusResponse } from "./agentSchemas";
import { FAST_POLL_MS, initialPoll, LONG_WAIT_MS, nextPollDelay, type PollState, pollReducer, SLOW_AFTER_MS, SLOW_POLL_MS, STOP_AFTER_MS, viewPhase } from "./statusPhase";

const plan = { code: "4821", title: "Dinner + show", date_label: "Sat, Oct 24", time_label: "7:00 PM", area: "Santa Monica", organizer_first_name: "Maya", joined: 1, party_target: 4, status: "open" as const, join_url: "https://tab-web-ten.vercel.app/j/4821" };
const base: StatusResponse = { phase: "waiting", role: "organizer", phone_last4: "0123", assigned_number: "+12135550147", sms_body: "Hey SquadTab! Help me plan a night out.", first_name: null, plan: null, steps: null };
const at = (s: Partial<StatusResponse>): StatusResponse => ({ ...base, ...s });

describe("viewPhase", () => {
  it("waits, then turns into the 45 s help", () => {
    expect(viewPhase(null, 0)).toBe("waiting");
    expect(viewPhase(at({}), LONG_WAIT_MS - 1)).toBe("waiting");
    expect(viewPhase(at({}), LONG_WAIT_MS)).toBe("waiting_long");
    expect(viewPhase(null, LONG_WAIT_MS)).toBe("waiting_long");
  });

  it("passes the server phases through once the text has landed", () => {
    expect(viewPhase(at({ phase: "texted" }), LONG_WAIT_MS)).toBe("texted");
    expect(viewPhase(at({ phase: "plan_ready", plan }), 0)).toBe("plan_ready");
    expect(viewPhase(at({ phase: "joined", role: "guest", plan }), 0)).toBe("joined");
    expect(viewPhase(at({ phase: "closed" }), 0)).toBe("closed");
  });

  it("never shows plan-ready without a plan in the response", () => {
    expect(viewPhase(at({ phase: "plan_ready", plan: null }), 0)).toBe("texted");
  });
});

describe("pollReducer", () => {
  it("keeps the last good data through failures and clears them on success", () => {
    let s = pollReducer(initialPoll, { type: "ok", data: at({ phase: "texted" }) });
    s = pollReducer(s, { type: "failed" });
    s = pollReducer(s, { type: "failed" });
    expect(s.data?.phase).toBe("texted");
    expect(s.failures).toBe(2);
    s = pollReducer(s, { type: "rate_limited" });
    expect(s.rateLimited).toBe(true);
    s = pollReducer(s, { type: "ok", data: at({ phase: "plan_ready", plan }) });
    expect(s).toEqual({ data: at({ phase: "plan_ready", plan }), expired: false, failures: 0, rateLimited: false });
  });

  it("marks a 401 as expired and resets cleanly", () => {
    const s = pollReducer(initialPoll, { type: "expired" });
    expect(s.expired).toBe(true);
    expect(pollReducer(s, { type: "reset" })).toEqual(initialPoll);
  });
});

describe("nextPollDelay", () => {
  const ok: PollState = { ...initialPoll, data: at({}) };

  it("polls every 2 s, then every 10 s after 2 minutes, and stops at 15 minutes", () => {
    expect(nextPollDelay(ok, 0, true)).toBe(FAST_POLL_MS);
    expect(nextPollDelay(ok, SLOW_AFTER_MS - 1, true)).toBe(FAST_POLL_MS);
    expect(nextPollDelay(ok, SLOW_AFTER_MS, true)).toBe(SLOW_POLL_MS);
    expect(nextPollDelay(ok, STOP_AFTER_MS, true)).toBeNull();
  });

  it("never polls a hidden tab, an expired token or a closed plan", () => {
    expect(nextPollDelay(ok, 0, false)).toBeNull();
    expect(nextPollDelay({ ...ok, expired: true }, 0, true)).toBeNull();
    expect(nextPollDelay({ ...ok, data: at({ phase: "closed" }) }, 0, true)).toBeNull();
  });

  it("slows down when rate limited and backs off on failures, capped at 30 s", () => {
    expect(nextPollDelay({ ...ok, rateLimited: true }, 0, true)).toBe(SLOW_POLL_MS);
    expect(nextPollDelay({ ...ok, failures: 1 }, 0, true)).toBe(4_000);
    expect(nextPollDelay({ ...ok, failures: 3 }, 0, true)).toBe(16_000);
    expect(nextPollDelay({ ...ok, failures: 9 }, 0, true)).toBe(30_000);
  });
});
