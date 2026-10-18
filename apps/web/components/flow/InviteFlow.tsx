"use client";

// The friend's flow (ux-flow §4.4 → §4.2 → §4.3, §4.5; design-system 6.3, 8). Composes W1's Flow compound:
//   InviteFlow     /j/[code]: the real plan, one phone field, "Join in iMessage", then the live status.
//   TokenHandoff   /t/[token]: the phone side of the desktop QR. The same live status, from the token alone.
// Privacy: the web asks only for a phone number. No names, no budgets; the plan shows counts, never who joined.
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { DotIcon } from "@/components/brand/DotIcon";
import { Lamp } from "@/components/brand/Lamps";
import { PlanTicket } from "@/components/brand/Ticket";
import { Wordmark } from "@/components/brand/Wordmark";
import type { PlanPreview, StatusPlan } from "@/lib/agent";
import { fetchStatus, joinPlan, type Rejected } from "@/lib/agentRequest";
import { CODE_RE, type FailureCopy, type JoinFailure, androidCopy, joinFailureCopy, toJoinFailure, validateJoinPhone, type PreviewResult, TOKEN_RE } from "@/lib/joinForm";
import { isDesktop } from "@/lib/platform";
import { type FlowSession, joinSessionKey, loadSession, ORGANIZER_SESSION_KEY, saveSession } from "@/lib/session";
import { displayNumber } from "@/lib/sms";
import { useStatus } from "@/lib/useStatus";
import { primaryButton, stubTitle, textButton } from "./classes";
import { DesktopScan } from "./DesktopScan";
import { Flow, type SubmitInput, type SubmitResult, useFlow } from "./Flow";
import { useSeatText } from "./FlowContext";
import { PhaseHeading } from "./PhaseHeading";
import { InvitePlanCard } from "./PlanCard";
import { ShareInvite } from "./ShareInvite";

const CONSENT = "By joining, you agree SquadTab can text you about this plan. Text “forget me” anytime.";

const PROMISES = [
  { icon: "chat", text: "Tell SquadTab what you’re into, by text." },
  { icon: "lock", text: "Your budget stays between you and SquadTab." },
  { icon: "card", text: "Nobody fronts the bill, and nobody pays until everyone’s in." },
] as const;

// ---------------------------------------------------------------------------------------------------------------
// Page frame: paper for the invite, ink once you're in (design-system 1). Copy never changes ground mid-screen.

function Page({ ground, wide = false, children }: { ground: "paper" | "ink"; wide?: boolean; children: ReactNode }) {
  return (
    <main data-ground={ground} className="min-h-dvh">
      <div
        className={`mx-auto flex min-h-dvh w-full flex-col gap-[22px] px-4 pt-[max(22px,env(safe-area-inset-top))] pb-[max(32px,env(safe-area-inset-bottom))] sm:px-[22px] ${
          wide ? "max-w-[440px] lg:max-w-[1120px]" : "max-w-[440px]"
        }`}
      >
        <header>
          <a href="/" aria-label="SquadTab home" className="inline-flex min-h-11 items-center text-current no-underline">
            <Wordmark className="text-[19px]" />
          </a>
        </header>
        {children}
      </div>
    </main>
  );
}

function Promises() {
  return (
    <ul className="m-0 grid list-none gap-3.5 p-0 lg:gap-4">
      {PROMISES.map((p) => (
        <li key={p.icon} className="grid grid-cols-[22px_1fr] items-start gap-3 text-[15.5px] leading-[1.4] text-pretty lg:text-[17px]">
          <DotIcon name={p.icon} />
          {p.text}
        </li>
      ))}
    </ul>
  );
}

/**
 * Desktop scale for the page's own ticket (the shared .plan-ticket rules are sized for a 390px column): a 48px title at
 * 1440, larger eyebrow, meta and count. Utilities win over the brand kit's `@layer components` rules.
 */
const TICKET_LG =
  "lg:px-7 lg:pt-7 lg:pb-9 lg:[&_.count]:text-[17px] lg:[&_.eyebrow]:text-[17px] lg:[&_.meta]:text-[14px] lg:[&_.title]:text-[clamp(2.5rem,3.4vw,3rem)]";

/**
 * The plan as the page heading. When the preview is unavailable the header is generic and the form still works.
 * A full plan drops the "k of n in" lamps: the cap counts invited seats too, so "1 of 3 in" beside "It already has 8
 * people" would contradict itself.
 */
function InviteTicket({ plan }: { plan: PlanPreview | null }) {
  if (!plan) {
    return <PlanTicket eyebrow="You’re invited" title="Join the plan" meta="Dinner and a show, planned by text" filled={0} total={0} titleAs="h1" className={TICKET_LG} />;
  }
  const full = plan.status === "full";
  return (
    <PlanTicket
      eyebrow={plan.organizer_first_name ? `${plan.organizer_first_name} invited you` : "You’re invited"}
      title={plan.title}
      meta={`${plan.date_label} · ${plan.time_label} · ${plan.area}`}
      filled={full ? 0 : plan.joined}
      total={full ? 0 : plan.party_target}
      titleAs="h1"
      className={TICKET_LG}
    />
  );
}

/** The organizer opened their own link (ux-flow §4.4): their plan-ready ticket, not a friend's "{name} invited you". */
function OwnerTicket({ plan }: { plan: StatusPlan }) {
  return (
    <PlanTicket
      eyebrow={`${plan.date_label} · ${plan.time_label}`}
      title={plan.title}
      meta={`${plan.area} · ${plan.party_target} people`}
      filled={plan.joined}
      total={plan.party_target}
      titleAs="h1"
      className={TICKET_LG}
    />
  );
}

/**
 * A dead link (unknown code, expired token): the page heading on a ghost of the plan ticket, with a dashed outline,
 * dashed lamps and a mono flag, because ghost means released (design-system 10). Then one line and the way forward.
 */
function DeadLink({ flag, title, body }: { flag: string; title: string; body: string }) {
  return (
    <>
      <div className="rounded-t-2xl border-2 border-dashed border-held-line-paper px-5 pt-4 pb-5">
        <p aria-hidden="true" className="mono mb-3 text-[12.5px] text-on-paper-2">
          {flag}
        </p>
        <h1 className="m-0 font-display text-[40px] leading-[0.92] font-[780] tracking-[-0.05em] text-balance">{title}</h1>
        <div aria-hidden="true" className="mt-[18px] flex gap-[7px] border-t-2 border-dotted border-rule-paper pt-3.5 [--lamp-off-edge:var(--color-held-line-paper)]">
          {[0, 1, 2, 3].map((i) => (
            <Lamp key={i} state="RELEASED" />
          ))}
        </div>
      </div>
      <div className="grid gap-3.5">
        <p className="text-[15px] text-muted text-pretty">{body}</p>
        <StartPlanLink />
      </div>
    </>
  );
}

/** The way forward from every dead end. */
function StartPlanLink() {
  return (
    <a href="/" className={primaryButton}>
      Start a plan
      <span className="arrow" aria-hidden="true">
        →
      </span>
    </a>
  );
}

/** A link-level failure (dead code, closed or full plan): it replaces the form. There is no red (design-system 3.1). */
function Terminal({ copy, headingLevel = "h2", children }: { copy: FailureCopy; headingLevel?: "h1" | "h2"; children?: ReactNode }) {
  const H = headingLevel;
  return (
    <div className="grid gap-3.5">
      <H className={stubTitle}>{copy.title}</H>
      <p className="text-[15px] text-muted text-pretty">{copy.body}</p>
      <StartPlanLink />
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// /j/[code]

/**
 * `preview` comes from the server (GET /plans/:code). `scanSvg` is the server-rendered QR of this page's own URL for
 * the desktop scan-first view; null if it couldn't be made (the number field is then the only path).
 */
export function InviteFlow({ code, preview, scanSvg }: { code: string; preview: PreviewResult; scanSvg: string | null }) {
  const plan = preview.kind === "ok" ? preview.plan : null;
  const organizer = plan?.organizer_first_name ?? null;
  // Set by a submit; read by the body. Kept here because the submit closure is handed to the provider.
  const [terminal, setTerminal] = useState<JoinFailure | null>(null);
  const [joined, setJoined] = useState<{ already: boolean; plan: PlanPreview } | null>(null);

  const submit = useCallback(
    async ({ phoneE164 }: SubmitInput): Promise<SubmitResult> => {
      const checked = validateJoinPhone(code, phoneE164);
      if (!checked.ok) return { kind: "invalid", errors: { phone: checked.error } };
      const out = await joinPlan(checked.body);
      if (out.kind === "ok") setJoined({ already: out.data.already_joined, plan: out.data.plan });
      else if (out.kind === "rejected") {
        const failure = toJoinFailure(out.error);
        if (joinFailureCopy(failure, organizer).terminal) setTerminal(failure);
      }
      return out;
    },
    [code, organizer],
  );

  const describeError = useCallback(
    (o: Rejected | { kind: "network" }) => {
      const c = joinFailureCopy(o.kind === "network" ? "network" : toJoinFailure(o.error), organizer);
      return { title: c.title, body: c.body };
    },
    [organizer],
  );

  if (preview.kind === "not_found") {
    const copy = joinFailureCopy("not_found", null);
    return (
      <Page ground="paper">
        <DeadLink flag={CODE_RE.test(code) ? `Plan ${code} · not found` : "Plan not found"} title={copy.title} body={copy.body} />
      </Page>
    );
  }

  return (
    <Flow.Provider role="guest" storageKey={joinSessionKey(code)} submit={submit} describeError={describeError}>
      <InviteBody code={code} plan={joined?.plan ?? plan} organizer={organizer} scanSvg={scanSvg} terminal={terminal} alreadyJoined={joined?.already ?? false} />
    </Flow.Provider>
  );
}

function InviteBody({
  code,
  plan,
  organizer,
  scanSvg,
  terminal,
  alreadyJoined,
}: {
  code: string;
  plan: PlanPreview | null;
  organizer: string | null;
  scanSvg: string | null;
  terminal: JoinFailure | null;
  alreadyJoined: boolean;
}) {
  const { state } = useFlow();
  const owner = useOwnerStatus(code, state.session === null);
  const ownPlan = state.session === null ? (owner?.plan ?? null) : null;
  const live = state.status.data?.plan ?? owner?.plan ?? null;
  // The freshest count we have: the person's own /status, then the organizer's, then the join response or preview.
  const shown = live ?? plan;

  // You're in: lights down (design-system 8). W1's Joined renders the count, the person's own steps and Open Messages.
  if (state.session && state.phase === "joined") {
    return (
      <Page ground="ink">
        <h1 className="sr-only">{plan ? plan.title : "Your plan"}</h1>
        <Flow.LiveStatus />
      </Page>
    );
  }

  return (
    <Page ground="paper" wide>
      {/* Desktop: two top-anchored columns that only grow downward, so opening the number field, an error or the
          hand-off never moves what is already on screen. */}
      <div className="grid gap-[22px] lg:mt-[clamp(32px,10vh,96px)] lg:grid-cols-[minmax(0,560px)_minmax(0,440px)] lg:justify-between lg:gap-14">
        <div className="grid content-start gap-[22px] lg:gap-8">
          {ownPlan ? <OwnerTicket plan={ownPlan} /> : <InviteTicket plan={shown} />}
          {ownPlan ? null : <Promises />}
        </div>
        <div className="grid content-start gap-[22px] lg:border-l lg:border-rule-paper lg:pl-14">
          <Action code={code} plan={shown} organizer={organizer} scanSvg={scanSvg} terminal={terminal} alreadyJoined={alreadyJoined} owner={owner} />
        </div>
      </div>
    </Page>
  );
}

type OwnerStatus = { plan: StatusPlan } | null;

/**
 * "This is your plan" (ux-flow §4.4): if this device holds the organizer's token for this code, follow its status.
 * Only polls when the stored organizer session already names this code (StartFlow saves it once /status reveals it),
 * so a friend's device never polls anything here.
 */
function useOwnerStatus(code: string, enabled: boolean): OwnerStatus | undefined {
  const [token, setToken] = useState<string | null>(null);
  useEffect(() => {
    const s = enabled ? loadSession(ORGANIZER_SESSION_KEY) : null;
    setToken(s?.role === "organizer" && s.code === code ? s.token : null);
  }, [code, enabled]);
  const poll = useStatus(token);
  if (!token) return null;
  if (!poll.data && !poll.expired && poll.failures === 0) return undefined; // first poll in flight
  const d = poll.data;
  return d && d.role === "organizer" && d.phase === "plan_ready" && d.plan?.code === code ? { plan: d.plan } : null;
}

function Action({
  code,
  plan,
  organizer,
  scanSvg,
  terminal,
  alreadyJoined,
  owner,
}: {
  code: string;
  plan: PlanPreview | null;
  organizer: string | null;
  scanSvg: string | null;
  terminal: JoinFailure | null;
  alreadyJoined: boolean;
  owner: OwnerStatus | undefined;
}) {
  const { state, meta } = useFlow();
  const [androidOverride, setAndroidOverride] = useState(false);

  if (state.session) {
    // already_joined is the server's word that this number is in; until a fresh text lands, say so plainly.
    if (alreadyJoined && (state.phase === "waiting" || state.phase === "waiting_long")) return <AlreadyIn />;
    return <Flow.LiveStatus />;
  }
  if (terminal) return <Terminal copy={joinFailureCopy(terminal, organizer)} />;
  if (owner === undefined) {
    return (
      <p aria-busy="true" className="text-[15px] text-muted">
        Checking your plan…
      </p>
    );
  }
  if (owner?.plan) return <YourPlan plan={owner.plan} />;
  if (plan?.status === "full") {
    // A member on a new device still gets back in: the agent lets existing participants past the cap
    // (already_joined). A newcomer who submits gets the agent's plan_full and the terminal above.
    return (
      <Terminal copy={joinFailureCopy("plan_full", organizer)}>
        <details className="or-number mt-2">
          <summary>Already in this plan?</summary>
          <div>
            <JoinStep submitLabel="Open my plan" />
          </div>
        </details>
      </Terminal>
    );
  }
  if (plan?.status === "closed") return <Terminal copy={joinFailureCopy("plan_closed", organizer)} />;

  if (meta.platform === "android" && !androidOverride) {
    const copy = androidCopy(organizer);
    return (
      <div className="grid gap-3">
        <h2 className={stubTitle}>{copy.title}</h2>
        <p className="text-[15px] text-muted text-pretty">{copy.body}</p>
        <button type="button" onClick={() => setAndroidOverride(true)} className={`${textButton} justify-self-start`}>
          I’m on an iPhone
        </button>
      </div>
    );
  }

  if (!scanSvg) return <JoinStep submitLabel="Join in iMessage" />;
  if (meta.platform === null) {
    // Before hydration the platform is unknown, so CSS picks: a laptop's first paint is already scan-first and a phone's
    // is the field. Only one branch is ever displayed, and display:none keeps the other out of the a11y tree.
    return (
      <>
        <div className="hidden min-[900px]:pointer-fine:block">
          <InviteScan code={code} svg={scanSvg} />
        </div>
        <div className="min-[900px]:pointer-fine:hidden">
          <JoinStep submitLabel="Join in iMessage" />
        </div>
      </>
    );
  }
  return isDesktop(meta.platform) ? <InviteScan code={code} svg={scanSvg} /> : <JoinStep submitLabel="Join in iMessage" />;
}

/** Desktop scan-first (ux-flow §4.2): the 200px QR of this page, then the number field behind a disclosure. */
function InviteScan({ code, svg }: { code: string; svg: string }) {
  return (
    <div className="flex flex-col lg:[&_.scan]:grid-cols-[200px_minmax(0,1fr)] lg:[&_.scan-qr]:size-[200px] lg:[&_.stub-title]:text-[32px] [&_.or-number]:mt-6">
      <DesktopScan svg={svg} title="Scan to join on your iPhone" qrLabel={`QR code that opens this invite (plan ${code}) on your iPhone`}>
        <JoinStep submitLabel="Continue on your iPhone" />
      </DesktopScan>
    </div>
  );
}

/** The one field (ux-flow §4.4). The pre-filled text is the server's `sms_body`, shown after the submit. */
function JoinStep({ submitLabel }: { submitLabel: string }) {
  return (
    <Flow.PhoneStep aria-label="Join this plan in iMessage">
      <Flow.PhoneField label="Your iPhone number" />
      <Flow.Submit busy="Saving your spot…">{submitLabel}</Flow.Submit>
      <Flow.Legal>{CONSENT}</Flow.Legal>
    </Flow.PhoneStep>
  );
}

/** "You're already in." (ux-flow §4.4, §6): the server confirmed the number is in this plan. */
function AlreadyIn() {
  const { meta } = useFlow();
  const { number } = useSeatText();
  const desktop = meta.platform !== null && isDesktop(meta.platform);
  return (
    <div className="grid gap-3.5">
      <PhaseHeading>You’re already in.</PhaseHeading>
      <p className="text-[15px] text-muted text-pretty">Pick up where you left off in Messages.</p>
      <Flow.TextSquadTab>Open Messages</Flow.TextSquadTab>
      {desktop && number ? (
        <p className="text-[15px] text-muted">
          Text <b className="mono font-semibold whitespace-nowrap text-fg">{displayNumber(number)}</b> from your iPhone.
        </p>
      ) : null}
    </div>
  );
}

/** The organizer opened their own link (ux-flow §4.4): counts only, and one tap to the share sheet. */
function YourPlan({ plan }: { plan: StatusPlan }) {
  const k = Math.min(plan.joined, plan.party_target);
  return (
    <div className="grid gap-3.5">
      <h2 className={stubTitle}>This is your plan.</h2>
      <p className="text-[15px] text-pretty">
        <b className="font-semibold">
          {k} of {plan.party_target} in.
        </b>{" "}
        <span className="text-muted">SquadTab asks each friend for their budget in private, by text.</span>
      </p>
      <ShareInvite plan={plan} />
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// /t/[token]

/** Provider key for a guest whose plan code is not known yet. Never persisted. */
const HANDOFF_KEY = "squadtab.handoff.v1";

type Handoff = { kind: "loading" } | { kind: "expired" } | { kind: "failed" } | { kind: "ready"; session: FlowSession; storageKey: string };

/**
 * The phone side of the desktop QR (ux-flow §4.5). One /status read builds the seat (number, first text, role), then the
 * shared provider takes over: the Text SquadTab button, then the same live status the laptop shows.
 */
export function TokenHandoff({ token }: { token: string }) {
  const valid = TOKEN_RE.test(token);
  const [h, setH] = useState<Handoff>(valid ? { kind: "loading" } : { kind: "expired" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!valid) return;
    const ac = new AbortController();
    void fetchStatus(token, { signal: ac.signal }).then((out) => {
      if (ac.signal.aborted) return;
      if (out.kind === "expired") return setH({ kind: "expired" });
      if (out.kind !== "ok") return setH({ kind: "failed" });
      const d = out.data;
      const code = d.plan?.code;
      // issued_at is this phone's clock: the 45 s help counts from when the person got here, not from the laptop.
      const session: FlowSession = {
        v: 1,
        token,
        role: d.role,
        ...(code ? { code } : {}),
        phone_last4: d.phone_last4,
        assigned_number: d.assigned_number ?? "",
        sms_body: d.sms_body,
        issued_at: Date.now(),
      };
      // Organizer: "/" on this phone resumes the same status. Guest: the invite page for the plan, once known.
      const storageKey = d.role === "organizer" ? ORGANIZER_SESSION_KEY : code ? joinSessionKey(code) : HANDOFF_KEY;
      // The provider skips storage when handed a session, so save it here. A guest with no plan code yet has no page
      // that would read it back.
      if (storageKey !== HANDOFF_KEY) saveSession(storageKey, session);
      setH({ kind: "ready", session, storageKey });
    });
    return () => ac.abort();
  }, [token, valid, attempt]);

  if (h.kind === "loading") {
    return (
      <Page ground="paper">
        <p aria-busy="true" className="text-[15px] text-muted">
          Getting your first text ready…
        </p>
      </Page>
    );
  }
  if (h.kind === "expired") return <Expired />;
  if (h.kind === "failed") {
    return (
      <Page ground="paper">
        <div className="grid gap-3.5">
          <h1 className={stubTitle}>Couldn’t reach SquadTab</h1>
          <p className="text-[15px] text-muted">Check your connection and try again. Nothing was sent.</p>
          <button type="button" className={primaryButton} onClick={() => (setH({ kind: "loading" }), setAttempt((n) => n + 1))}>
            Try again
          </button>
        </div>
      </Page>
    );
  }
  return (
    <Flow.Provider role={h.session.role} storageKey={h.storageKey} submit={noSubmit} initialSession={h.session}>
      <TokenBody />
    </Flow.Provider>
  );
}

/** /t has no phone step: a fresh seat always starts on the page that showed the QR. */
const noSubmit = async (): Promise<SubmitResult> => ({ kind: "network" });

function TokenBody() {
  const { state } = useFlow();
  const plan = state.status.data?.plan ?? null;
  if (!state.session) return <StartAgain />;
  if (state.phase === "joined") {
    return (
      <Page ground="ink">
        <h1 className="sr-only">{plan ? plan.title : "Your plan"}</h1>
        <Flow.LiveStatus />
      </Page>
    );
  }
  return (
    <Page ground="paper">
      {/* Plan details appear only once /status carries them (after the owner's text, ux-flow §7.2). */}
      {plan && state.phase !== "plan_ready" ? <InvitePlanCard plan={plan} /> : <h1 className="sr-only">Continue in Messages</h1>}
      <Flow.LiveStatus />
    </Page>
  );
}

/** Invalid or past its 7-day TTL (ux-flow §4.5). */
function Expired() {
  return (
    <Page ground="paper">
      <DeadLink flag="Link expired" title="This link expired." body="Start again on squadtab." />
    </Page>
  );
}

/** After "Wrong number? Fix it" or a closed plan's "Start a plan" on the phone side. */
function StartAgain() {
  return (
    <Page ground="paper">
      <div className="grid gap-3.5">
        <h1 className={stubTitle}>Start again on your laptop</h1>
        <p className="text-[15px] text-muted text-pretty">Enter your number on the page that showed the QR code, then scan the new one.</p>
        <a href="/" className={textButton}>
          Or start a new plan here
        </a>
      </div>
    </Page>
  );
}
