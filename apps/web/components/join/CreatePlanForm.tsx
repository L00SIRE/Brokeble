"use client";

// Fallback "/" (ux-flow §10.4 cut line): if start-by-chat isn't green, the stub asks where and how many plus the phone,
// and posts to POST /plans, which seats the organizer. Everything after the submit is the shared hand-off and live
// status (components/flow), so there is still no QR on phones and no copy-only link. Date defaults to today, 7 to 11 PM.
import { useId, useState } from "react";
import { phoneInput } from "@/components/flow/classes";
import { type SubmitInput, type SubmitResult, useFlow } from "@/components/flow/FlowContext";
import { createPlan } from "@/lib/agentRequest";

export const FALLBACK_FIRST_TEXT = "Hey SquadTab! Let's get planning.";

const AREA_ERROR = "Enter a neighborhood or city, like Santa Monica.";
const PARTY_ERROR = "Pick 2 to 8 people, counting you.";
const MIN_PARTY = 2;
const MAX_PARTY = 8;
/** Same window as a chat plan with no time (apps/agent/src/plan/defaults.ts): the evening shows research finds fit it. */
const PLAN_START = "17:30";
const PLAN_END = "23:00";

/** Local "YYYY-MM-DD" (en-CA formats as ISO). */
const localToday = (now = new Date()): string => now.toLocaleDateString("en-CA");

/** FlowProvider `submit` for the fallback: validates the two extra fields, then POST /plans. */
export async function submitCreatePlan({ phoneE164, form }: SubmitInput, today = localToday(), f?: typeof fetch): Promise<SubmitResult> {
  const area = String(form.get("area") ?? "").trim();
  const party = Number(form.get("party_target"));
  const errors: Record<string, string> = {};
  if (area.length < 2 || area.length > 60) errors.area = AREA_ERROR;
  if (!Number.isInteger(party) || party < MIN_PARTY || party > MAX_PARTY) errors.party_target = PARTY_ERROR;
  if (Object.keys(errors).length > 0) return { kind: "invalid", errors };

  const out = await createPlan(
    { title: "Dinner + show", area, date: today, time_start: PLAN_START, time_end: PLAN_END, party_target: party, organizer: { phone_e164: phoneE164, first_name: "" } },
    f,
  );
  if (out.kind === "rejected" && out.error === "invalid") {
    const mapped: Record<string, string> = {};
    for (const { path } of out.issues) {
      if (path === "area") mapped.area = AREA_ERROR;
      if (path === "party_target") mapped.party_target = PARTY_ERROR;
    }
    if (Object.keys(mapped).length > 0) return { kind: "invalid", errors: mapped };
  }
  return out;
}

/** Where + how many, rendered inside <PhoneStep> before the phone field. */
export function CreatePlanFields() {
  const { state } = useFlow();
  const areaId = useId();
  const areaError = state.fieldErrors.area;
  return (
    <>
      <div className="grid gap-2">
        <label htmlFor={areaId} className="text-[15px] font-[650]">
          Where?
        </label>
        <input
          id={areaId}
          name="area"
          type="text"
          autoComplete="off"
          autoCapitalize="words"
          maxLength={60}
          placeholder="Santa Monica"
          aria-invalid={areaError ? true : undefined}
          aria-describedby={areaError ? `${areaId}-error` : undefined}
          className={phoneInput}
        />
        {areaError ? (
          <p id={`${areaId}-error`} className="text-[15px] font-semibold">
            {areaError}
          </p>
        ) : null}
      </div>
      <PartyStepper error={state.fieldErrors.party_target} />
    </>
  );
}

function PartyStepper({ error }: { error?: string }) {
  const [n, setN] = useState(4);
  const labelId = useId();
  const step =
    "inline-flex size-11 touch-manipulation items-center justify-center rounded-control border-2 border-ink bg-white text-xl font-bold text-ink disabled:opacity-40";
  return (
    <div className="grid gap-2" role="group" aria-labelledby={labelId}>
      <span id={labelId} className="text-[15px] font-[650]">
        How many of you, counting you?
      </span>
      <div className="flex items-center gap-3">
        <button type="button" className={step} onClick={() => setN((v) => Math.max(MIN_PARTY, v - 1))} disabled={n <= MIN_PARTY} aria-label="Fewer people">
          −
        </button>
        <output aria-live="polite" className="mono min-w-[9ch] text-center text-[17px]">
          {n} people
        </output>
        <button type="button" className={step} onClick={() => setN((v) => Math.min(MAX_PARTY, v + 1))} disabled={n >= MAX_PARTY} aria-label="More people">
          +
        </button>
        <input type="hidden" name="party_target" value={n} />
      </div>
      {error ? <p className="text-[15px] font-semibold">{error}</p> : null}
    </div>
  );
}
