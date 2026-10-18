"use client";

// The organizer flow on "/" (ux-flow §4.1 → §4.2 → §4.3, design-system 6.3). app/page.tsx renders
//   <StartFlowProvider mode> <StartScreen hero={<SignalHero stub={<StartFlow scanSvg/>} />} /> </StartFlowProvider>
// The stub holds the phone step, the hand-off and the early status; once the plan exists the hero gives way to the
// plan-ready page (paper), and a guest seat to "You're in" (ink).
import { createContext, type ReactNode, use, useState } from "react";
import { FirstText } from "@/components/brand/FirstText";
import { Wordmark } from "@/components/brand/Wordmark";
import { CreatePlanFields, FALLBACK_FIRST_TEXT, submitCreatePlan } from "@/components/join/CreatePlanForm";
import { startOrganizer } from "@/lib/agentRequest";
import { isDesktop } from "@/lib/platform";
import { ORGANIZER_SESSION_KEY } from "@/lib/session";
import { textButton } from "./classes";
import { DesktopScan } from "./DesktopScan";
import { FlowProvider, type SubmitInput, type SubmitResult, useFlow } from "./FlowContext";
import { LiveStatus } from "./LiveStatus";
import { Legal, PhoneField, PhoneStep, SubmitButton } from "./PhoneStep";
import { ShareNoteContext } from "./ShareInvite";

export const START_FIRST_TEXT = "Hey SquadTab! Help me plan a night out.";
const CONSENT = "By continuing, you agree SquadTab can text you about your plans. Text “forget me” anytime.";

/** "chat": POST /start, the plan is made in iMessage. "form": the 10.4 fallback, POST /plans with where + how many. */
export type StartMode = "chat" | "form";

const StartModeContext = createContext<StartMode>("chat");

/** The fallback's first text gets a welcome, not the join link, so the page is where the link lives. */
const FORM_SHARE_NOTE = "Send it to your group chat so your friends can join.";

const submitStart = ({ phoneE164 }: SubmitInput): Promise<SubmitResult> => startOrganizer({ phone_e164: phoneE164, consent: true });

export function StartFlowProvider({ mode, children }: { mode: StartMode; children: ReactNode }) {
  return (
    <FlowProvider role="organizer" storageKey={ORGANIZER_SESSION_KEY} submit={mode === "form" ? submitCreatePlan : submitStart}>
      <StartModeContext value={mode}>
        {mode === "form" ? <ShareNoteContext value={FORM_SHARE_NOTE}>{children}</ShareNoteContext> : children}
      </StartModeContext>
    </FlowProvider>
  );
}

/**
 * The stub's phone step: "Text SquadTab from", then Start in iMessage. `children` go between the field and the button:
 * the phone layout passes the first text typed out; on desktop that preview belongs on the phone after the scan, so
 * the disclosure stays inside the stub's height.
 */
function PhoneStart({ label, submitLabel, children }: { label: string; submitLabel: string; children?: ReactNode }) {
  const mode = use(StartModeContext);
  return (
    <PhoneStep aria-label="Start a plan in iMessage">
      {mode === "form" ? <CreatePlanFields /> : null}
      <PhoneField label={label} />
      {children}
      <SubmitButton busy="Getting your line…">{submitLabel}</SubmitButton>
      <Legal>{CONSENT}</Legal>
    </PhoneStep>
  );
}

/** "Your first text, typed for you": what Messages will open with. */
function StartFirstText() {
  const mode = use(StartModeContext);
  return <FirstText text={mode === "form" ? FALLBACK_FIRST_TEXT : START_FIRST_TEXT} />;
}

/** Phones: the number, the first text, one tap into Messages. */
function PhoneLayout() {
  return (
    <PhoneStart label="Text SquadTab from" submitLabel="Start in iMessage">
      <StartFirstText />
    </PhoneStart>
  );
}

/**
 * Desktop and Mac: scan first; the number is the secondary path. Without a QR (it failed to render on the server), the
 * number field shows directly.
 */
function DesktopLayout({ scanSvg }: { scanSvg: string | null }) {
  const start = <PhoneStart label="Your iPhone number" submitLabel="Continue on your iPhone" />;
  return scanSvg ? <DesktopScan svg={scanSvg}>{start}</DesktopScan> : start;
}

/** Android: SquadTab lives in iMessage. Detected before any POST, so no seat is spent; "I'm on an iPhone" overrides. */
function AndroidNotice({ onOverride }: { onOverride: () => void }) {
  return (
    <div className="grid gap-3">
      <h2 className="stub-title mb-0">SquadTab lives in iMessage.</h2>
      <p className="text-[15px] text-muted text-pretty">Open this page on an iPhone, iPad or Mac to start a plan.</p>
      <button type="button" onClick={onOverride} className={`${textButton} justify-self-start`}>
        I’m on an iPhone
      </button>
    </div>
  );
}

/** Everything inside the ticket's stub. `scanSvg` is the server-rendered QR of "/" (lib/qr.ts), null if it failed. */
export function StartFlow({ scanSvg }: { scanSvg: string | null }) {
  const { state, meta } = useFlow();
  const [androidOverride, setAndroidOverride] = useState(false);

  if (state.session) return <LiveStatus />;
  if (meta.platform === "android" && !androidOverride) return <AndroidNotice onOverride={() => setAndroidOverride(true)} />;
  if (meta.platform) return isDesktop(meta.platform) ? <DesktopLayout scanSvg={scanSvg} /> : <PhoneLayout />;
  // Server render and hydration (platform is client-only): both layouts, chosen by CSS, so a laptop's first paint is
  // already the scan and a phone's is already the number. A wide screen with a mouse approximates isDesktop(); only
  // the matching layout stays mounted once the platform is known.
  return (
    <>
      <div className="hidden min-[900px]:pointer-fine:contents">
        <DesktopLayout scanSvg={scanSvg} />
      </div>
      <div className="contents min-[900px]:pointer-fine:hidden">
        <PhoneLayout />
      </div>
    </>
  );
}

/** A calm full page (design-system 5: "one task, keep it calm") for plan-ready (paper) and "You're in" (ink). */
function PageSurface({ ground }: { ground: "paper" | "ink" }) {
  return (
    <main data-ground={ground} className="min-h-dvh">
      <div className="@container mx-auto flex min-h-dvh max-w-[440px] flex-col gap-[22px] pt-[max(22px,env(safe-area-inset-top))] pr-[max(16px,env(safe-area-inset-right))] pb-[max(32px,env(safe-area-inset-bottom))] pl-[max(16px,env(safe-area-inset-left))] sm:pr-[max(22px,env(safe-area-inset-right))] sm:pl-[max(22px,env(safe-area-inset-left))] lg:max-w-[1040px]">
        <header>
          <a href="/" aria-label="SquadTab home" className="inline-flex min-h-11 items-center no-underline">
            <Wordmark className="text-[19px]" />
          </a>
        </header>
        {/* On a laptop or the booth projector the status sits in the middle of the screen, not under the wordmark. */}
        <div className="lg:my-auto lg:pb-[8vh]">
          <LiveStatus />
        </div>
      </div>
    </main>
  );
}

/** Swaps the hero for a full page once the status says the plan is ready (or this seat is a guest who's in). */
export function StartScreen({ hero }: { hero: ReactNode }) {
  const { state } = useFlow();
  if (state.phase === "plan_ready" && state.status.data?.plan) return <PageSurface ground="paper" />;
  if (state.phase === "joined") return <PageSurface ground="ink" />;
  return <main>{hero}</main>;
}
