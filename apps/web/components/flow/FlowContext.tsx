"use client";

// The one state owner for the chat-first flow (ux-flow §9.7): phone step → hand-off → live status. StartFlow (organizer)
// and InviteFlow (friend) both mount a FlowProvider and compose the same parts; only the provider knows how a seat is
// requested, stored and polled. Parts read it through useFlow().
import { createContext, type ReactNode, type RefObject, use, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { Outcome, Rejected } from "@/lib/agentRequest";
import { normalizePhone } from "@/lib/normalizePhone";
import { detectPlatform, type Platform } from "@/lib/platform";
import { clearSession, type FlowSession, last4, loadSession, saveSession } from "@/lib/session";
import { smsHref } from "@/lib/sms";
import { LONG_WAIT_MS, type ViewPhase, viewPhase } from "@/lib/statusPhase";
import { type StatusPoll, useStatus } from "@/lib/useStatus";

/** What every seat-issuing endpoint returns that the flow needs (StartResponse, JoinResponse, CreatePlanResponse). */
export type SeatResponse = { assigned_number: string; sms_body: string; status_token: string; handoff_qr_svg?: string; code?: string };

/** A submit either fails client-side validation (field → message), or reaches the agent. */
export type SubmitResult = Outcome<SeatResponse> | { kind: "invalid"; errors: Record<string, string> };
export type SubmitInput = { phoneE164: string; form: FormData };

export type ErrorCopy = { title: string; body: string };
export type FlowRole = FlowSession["role"];

export const PHONE_ERROR = "That doesn’t look like a US mobile number. Try 10 digits, like (310) 555-0123.";

/** Organizer copy (ux-flow §4.4 error table, minus the plan-specific rows). InviteFlow passes its own table. */
export function defaultErrorCopy(o: Rejected | { kind: "network" }): ErrorCopy {
  if (o.kind === "network") return { title: "Couldn’t reach SquadTab", body: "Check your connection and try again. Nothing was sent." };
  if (o.error === "capacity") return { title: "SquadTab is packed right now", body: "Every line is busy. Try again in a few minutes." };
  if (o.error === "rate_limited") return { title: "Too many tries", body: "Wait a minute, then try again." };
  return { title: "Something went wrong on our side", body: "Nothing was sent. Please try again." };
}

/** Auto-open Messages only if the response came back fast enough that Safari still treats it as the tap (ux-flow §3.4). */
const AUTO_OPEN_WINDOW_MS = 4_000;

export type FlowState = {
  /** The seat this device holds; null on the phone step. */
  session: FlowSession | null;
  /** Prefill for the phone field ("Wrong number? Fix it" puts the typed number back, selected). Memory only. */
  draft: string;
  submitting: boolean;
  fieldErrors: Record<string, string>;
  banner: ErrorCopy | null;
  /** Null on the phone step. */
  phase: ViewPhase | null;
  /** A seat resumed from storage whose first /status poll hasn't landed: show neither "waiting" nor the form. */
  resuming: boolean;
  status: StatusPoll;
};

export type FlowActions = {
  submit: (form: FormData) => Promise<void>;
  /** Back to the phone step with the number prefilled and selected. The mistyped seat is released by the agent later. */
  fixNumber: () => void;
  /** Forget this device's seat and show the phone step (closed plan, expired token, "Start a plan"). */
  startOver: () => void;
  /** Drop one field's error once the person edits that field. */
  clearFieldError: (name: string) => void;
};

export type FlowMeta = {
  role: FlowRole;
  /** Null until mounted: the server render and first client render use the phone layout (ux-flow §3.1). */
  platform: Platform | null;
  /** The `sms:` link for this seat on this platform, or null (no seat, desktop, unlinkable number). */
  smsLink: string | null;
  /** Focus a phase heading only after the person acted here, not on a cold resume from storage. */
  focusOnPhaseChange: RefObject<boolean>;
  /** Set when the phone field should select its prefilled value on mount. */
  selectDraft: RefObject<boolean>;
};

export type FlowContextValue = { state: FlowState; actions: FlowActions; meta: FlowMeta };

const FlowContext = createContext<FlowContextValue | null>(null);

export function useFlow(): FlowContextValue {
  const ctx = use(FlowContext);
  if (!ctx) throw new Error("useFlow must be used inside <Flow.Provider>");
  return ctx;
}

const noopSubscribe = () => () => {};
const getPlatform = () => detectPlatform(navigator.userAgent, navigator.maxTouchPoints ?? 0);
const getServerPlatform = () => null;

/** Client-only platform; null during SSR and hydration, so both renders match and the phone layout shows first. */
export function usePlatform(): Platform | null {
  return useSyncExternalStore(noopSubscribe, getPlatform, getServerPlatform);
}

/** True once `issuedAt + 45 s` has passed: the "Not seeing your text yet" help. */
function useLongWait(issuedAt: number | null): boolean {
  const [longFor, setLongFor] = useState<number | null>(null);
  useEffect(() => {
    if (issuedAt === null) return;
    const remaining = issuedAt + LONG_WAIT_MS - Date.now();
    const id = setTimeout(() => setLongFor(issuedAt), Math.max(0, remaining));
    return () => clearTimeout(id);
  }, [issuedAt]);
  return issuedAt !== null && longFor === issuedAt;
}

export function FlowProvider({
  role,
  storageKey,
  submit,
  describeError = defaultErrorCopy,
  initialSession = null,
  children,
}: {
  role: FlowRole;
  /** localStorage key: ORGANIZER_SESSION_KEY or joinSessionKey(code). */
  storageKey: string;
  submit: (input: SubmitInput) => Promise<SubmitResult>;
  describeError?: (o: Rejected | { kind: "network" }) => ErrorCopy;
  /** A session the page already has (e.g. /t/[token]); skips the storage lookup. */
  initialSession?: FlowSession | null;
  children: ReactNode;
}) {
  const platform = usePlatform();
  const [session, setSession] = useState<FlowSession | null>(initialSession);
  const [draft, setDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState<ErrorCopy | null>(null);
  const [resumed, setResumed] = useState(initialSession !== null);
  const focusOnPhaseChange = useRef(false);
  const selectDraft = useRef(false);

  // Resume a stored seat after mount (storage is client-only; the first render is the phone step).
  useEffect(() => {
    if (initialSession) return;
    const stored = loadSession(storageKey);
    if (!stored) return;
    setResumed(true);
    setSession(stored);
  }, [storageKey, initialSession]);

  const status = useStatus(session?.token ?? null);
  const longWait = useLongWait(session?.issued_at ?? null);
  const phase = session ? viewPhase(status.data, longWait ? LONG_WAIT_MS : 0) : null;
  const resuming = resumed && session !== null && status.data === null && status.failures === 0 && !status.expired;

  // A 401 means the token is invalid or past its TTL: forget it and start fresh.
  useEffect(() => {
    if (!status.expired) return;
    clearSession(storageKey);
    setSession(null);
  }, [status.expired, storageKey]);

  // Remember the plan code once /status reveals it, so /j/[code] can recognize its organizer (ux-flow §4.4).
  const revealedCode = status.data?.plan?.code;
  useEffect(() => {
    if (!revealedCode || !session || session.code === revealedCode) return;
    const next = { ...session, code: revealedCode };
    saveSession(storageKey, next);
    setSession(next);
  }, [revealedCode, session, storageKey]);

  const doSubmit = useCallback(
    async (form: FormData) => {
      if (submitting) return;
      const raw = String(form.get("phone") ?? "");
      const phoneE164 = normalizePhone(raw);
      setBanner(null);
      if (!phoneE164) {
        setFieldErrors({ phone: PHONE_ERROR });
        return;
      }
      setFieldErrors({});
      setSubmitting(true);
      const t0 = Date.now();
      let out: SubmitResult;
      try {
        out = await submit({ phoneE164, form });
      } catch {
        out = { kind: "network" };
      }
      setSubmitting(false);
      if (out.kind === "invalid") return setFieldErrors(out.errors);
      if (out.kind === "network") return setBanner(describeError(out));
      if (out.kind === "rejected") {
        if (out.error === "invalid" && out.issues.some((i) => i.path === "phone_e164" || i.path === "organizer.phone_e164")) {
          return setFieldErrors({ phone: PHONE_ERROR });
        }
        return setBanner(describeError(out));
      }
      const seat = out.data;
      const next: FlowSession = {
        v: 1,
        token: seat.status_token,
        role,
        ...(seat.code && /^\d{4}$/.test(seat.code) ? { code: seat.code } : {}),
        phone_last4: last4(phoneE164),
        assigned_number: seat.assigned_number,
        sms_body: seat.sms_body,
        ...(seat.handoff_qr_svg ? { handoff_qr_svg: seat.handoff_qr_svg } : {}),
        issued_at: Date.now(),
      };
      saveSession(storageKey, next);
      setDraft(raw);
      focusOnPhaseChange.current = true;
      setResumed(false);
      setSession(next);
      // iOS only, once, and only inside the gesture window. UNVERIFIED on iOS 26 (device test 11.3b); the large
      // "Text SquadTab" button is always rendered as the fallback.
      const href = platform === "ios" ? smsHref(seat.assigned_number, seat.sms_body, platform) : null;
      if (href && Date.now() - t0 < AUTO_OPEN_WINDOW_MS) window.location.href = href;
    },
    [submitting, submit, describeError, role, storageKey, platform],
  );

  const fixNumber = useCallback(() => {
    clearSession(storageKey);
    selectDraft.current = true;
    focusOnPhaseChange.current = true;
    setBanner(null);
    setFieldErrors({});
    setSession(null);
  }, [storageKey]);

  const startOver = useCallback(() => {
    clearSession(storageKey);
    setDraft("");
    setBanner(null);
    setFieldErrors({});
    setSession(null);
  }, [storageKey]);

  const clearFieldError = useCallback((name: string) => {
    setFieldErrors((prev) => {
      if (!(name in prev)) return prev;
      const { [name]: _cleared, ...rest } = prev;
      return rest;
    });
  }, []);

  // /status carries the number and first text too; prefer it (the seat may have been re-issued), else the stored copy.
  const number = status.data ? status.data.assigned_number : (session?.assigned_number ?? null);
  const body = status.data?.sms_body ?? session?.sms_body ?? "";
  const smsLink = session && platform && number ? smsHref(number, body, platform) : null;

  const value = useMemo<FlowContextValue>(
    () => ({
      state: { session, draft, submitting, fieldErrors, banner, phase, resuming, status },
      actions: { submit: doSubmit, fixNumber, startOver, clearFieldError },
      meta: { role, platform, smsLink, focusOnPhaseChange, selectDraft },
    }),
    [session, draft, submitting, fieldErrors, banner, phase, resuming, status, doSubmit, fixNumber, startOver, clearFieldError, role, platform, smsLink],
  );

  return <FlowContext value={value}>{children}</FlowContext>;
}

/** The number and first text to show for this seat (status first, then the stored copy). */
export function useSeatText(): { number: string | null; body: string; last4: string } {
  const { state } = useFlow();
  const d = state.status.data;
  return {
    number: d ? d.assigned_number : (state.session?.assigned_number ?? null),
    body: d?.sms_body ?? state.session?.sms_body ?? "",
    last4: d?.phone_last4 ?? state.session?.phone_last4 ?? "",
  };
}
