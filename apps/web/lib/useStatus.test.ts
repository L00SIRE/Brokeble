import { describe, expect, it } from "vitest";
import type { StatusResponse } from "./agentSchemas";
import { statusEvent } from "./useStatus";

const data: StatusResponse = { phase: "texted", role: "organizer", phone_last4: "0123", assigned_number: "+12135550147", sms_body: "hi", first_name: null, plan: null, steps: null };

describe("statusEvent", () => {
  it("maps every /status outcome onto a reducer event", () => {
    expect(statusEvent({ kind: "ok", data })).toEqual({ type: "ok", data });
    expect(statusEvent({ kind: "expired" })).toEqual({ type: "expired" });
    expect(statusEvent({ kind: "rate_limited" })).toEqual({ type: "rate_limited" });
    expect(statusEvent({ kind: "failed" })).toEqual({ type: "failed" });
  });
});
