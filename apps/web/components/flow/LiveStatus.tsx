"use client";

// The live status (ux-flow §4.3): one component per phase, chosen from /status. Every phase change is announced in a
// polite live region and its heading takes focus. Plan details render only once /status carries them, which the
// agent allows only after the number's owner has texted (the proof-of-possession gate, ux-flow §7.2).
import { DotIcon } from "@/components/brand/DotIcon";
import { Lamps } from "@/components/brand/Lamps";
import type { StatusPlan } from "@/lib/agentSchemas";
import type { ViewPhase } from "@/lib/statusPhase";
import { Checklist } from "./Checklist";
import { primaryButton, textButton } from "./classes";
import { useFlow } from "./FlowContext";
import { Handoff, SeatReleased, WaitingLong } from "./Handoff";
import { PhaseHeading } from "./PhaseHeading";
import { PlanCard } from "./PlanCard";
import { ShareInvite } from "./ShareInvite";

const ANNOUNCE: Record<ViewPhase, string> = {
  waiting: "Hit send in Messages.",
  waiting_long: "Not seeing your text yet.",
  texted: "Got it. Keep chatting in Messages.",
  plan_ready: "Your plan is ready.",
  joined: "You’re in.",
  closed: "This plan’s wrapped up.",
};

/** "Got it. Keep chatting in Messages." The organizer's text landed; the plan is being set up in chat. */
export function Texted() {
  return (
    <div className="grid gap-3.5">
      <PhaseHeading>Got it. Keep chatting in Messages.</PhaseHeading>
      <Checklist
        label="Your progress"
        items={[
          { label: "Texted SquadTab", done: true },
          { label: "Plan set", done: false },
          { label: "Friends invited", done: false },
        ]}
      />
      <OpenMessages />
    </div>
  );
}

/**
 * Two columns once the page is wide (a laptop or the booth projector, ux-flow 4.2): the plan on the left, what to do
 * next on the right. A container query, so the same parts stay one column in a phone-width page.
 */
const SPLIT = "flex flex-col @min-[760px]:grid @min-[760px]:grid-cols-[minmax(0,1fr)_minmax(0,400px)] @min-[760px]:items-start @min-[760px]:gap-x-14";

/** Organizer plan-ready (design-system 6.3): already in, budgets stay private, one tap to invite. */
export function PlanReady({ plan, firstName }: { plan: StatusPlan; firstName: string | null }) {
  return (
    <div className={`${SPLIT} gap-[22px]`}>
      <div className="flex flex-col gap-[22px]">
        <PhaseHeading className="font-display text-[38px] font-[760] leading-[.95] tracking-[-0.05em] text-balance outline-none @min-[760px]:text-[56px]">
          Your plan is ready{firstName ? `, ${firstName}` : ""}.
        </PhaseHeading>
        <PlanCard plan={plan} />
      </div>
      <div className="flex flex-col gap-[22px] @min-[760px]:pt-2">
        <p className="flex items-center gap-2.5 rounded-control border-2 border-current px-3.5 py-3 text-[15px] font-semibold">
          <DotIcon name="check" />
          You’re already in. Nothing else to fill in.
        </p>
        <p className="text-[15px] text-muted text-pretty">
          SquadTab asks each friend for their budget in private, by text. Nobody sees anyone else’s number, not even you.
        </p>
        <ShareInvite plan={plan} />
      </div>
    </div>
  );
}

/** "You're in, Leo." on ink (design-system 8): the count, the person's own steps, and back to Messages. */
export function Joined({ plan, firstName, steps }: { plan: StatusPlan | null; firstName: string | null; steps: { budget: boolean; prefs: boolean } | null }) {
  return (
    <div className={SPLIT}>
      <div className="flex flex-col">
        <PhaseHeading className="mb-4 font-display text-[52px] font-[760] leading-[.9] tracking-[-0.055em] text-balance outline-none @min-[760px]:text-[72px]">
          You’re in{firstName ? `, ${firstName}` : ""}
          <span className="text-sodium">.</span>
        </PhaseHeading>
        <p className="text-base text-muted text-pretty">SquadTab is texting you now. Finish up in Messages, it takes about a minute.</p>
        {plan ? (
          <div className="mt-[30px] mb-1.5 flex items-end justify-between border-b border-rule-night pb-[18px]">
            <div>
              <p className="font-display text-[44px] font-[760] leading-none tracking-[-0.045em] text-sodium">
                {Math.min(plan.joined, plan.party_target)} of {plan.party_target}
              </p>
              <p className="mt-1.5 text-sm text-muted">in for {plan.title}</p>
            </div>
            <Lamps filled={plan.joined} total={plan.party_target} className="text-paper" />
          </div>
        ) : null}
      </div>
      <div className="flex flex-col @min-[760px]:pt-3">
        <Checklist
          label="Your steps"
          items={[
            { label: "Joined", done: true },
            { label: "Budget", done: steps?.budget ?? false, note: "Just between you and SquadTab" },
            { label: "What you’re into", done: steps?.prefs ?? false },
          ]}
        />
        <div className="mt-7">
          <OpenMessages />
        </div>
      </div>
    </div>
  );
}

/** Terminal: cancelled, confirmed or past voting. */
export function Closed() {
  const { actions } = useFlow();
  return (
    <div className="grid gap-3.5">
      <PhaseHeading>This plan’s wrapped up</PhaseHeading>
      <p className="text-[15px] text-muted">Want to start your own?</p>
      <a
        href="/"
        className={primaryButton}
        onClick={(e) => {
          actions.startOver();
          if (window.location.pathname === "/") e.preventDefault();
        }}
      >
        Start a plan
        <span className="arrow" aria-hidden="true">
          →
        </span>
      </a>
    </div>
  );
}

/** Back to the conversation. Nothing on Windows/Linux, where `sms:` does nothing. */
function OpenMessages() {
  const { meta } = useFlow();
  if (!meta.smsLink) return null;
  return (
    <a href={meta.smsLink} className={primaryButton}>
      Open Messages
      <span className="arrow" aria-hidden="true">
        →
      </span>
    </a>
  );
}

/** Polling stopped after 15 minutes (privacy, ux-flow §7.2); one tap opens a new window. */
function PausedNote() {
  const { state } = useFlow();
  if (!state.status.stopped) return null;
  return (
    <p className="mt-3 flex flex-wrap items-center gap-x-2 text-[13.5px] text-muted">
      Updates paused.
      <button type="button" onClick={state.status.restart} className={`${textButton} text-[13.5px]`}>
        Check again
      </button>
    </p>
  );
}

function Phase({ phase }: { phase: ViewPhase }) {
  const { state } = useFlow();
  const d = state.status.data;
  switch (phase) {
    case "waiting":
      // A released seat (untexted for 15 min) has no number left to text.
      return d && d.assigned_number === null ? <SeatReleased /> : <Handoff />;
    case "waiting_long":
      return d && d.assigned_number === null ? <SeatReleased /> : <WaitingLong />;
    case "texted":
      return <Texted />;
    case "plan_ready":
      return d?.plan ? <PlanReady plan={d.plan} firstName={d.first_name} /> : <Texted />;
    case "joined":
      return <Joined plan={d?.plan ?? null} firstName={d?.first_name ?? null} steps={d?.steps ?? null} />;
    case "closed":
      return <Closed />;
  }
}

/** The whole live status for the current seat. Renders nothing on the phone step. */
export function LiveStatus() {
  const { state } = useFlow();
  if (!state.phase) return null;
  if (state.resuming) {
    return (
      <p aria-busy="true" className="py-2 text-[15px] text-muted">
        Checking for your text…
      </p>
    );
  }
  return (
    <section aria-label="Your plan status">
      <Phase phase={state.phase} />
      <PausedNote />
      <p aria-live="polite" className="sr-only">
        {ANNOUNCE[state.phase]}
      </p>
    </section>
  );
}
