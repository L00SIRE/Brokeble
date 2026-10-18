"use client";

// The hand-off: after a submit, before the person's text lands (ux-flow §4.2, §4.3 "waiting"). Explicit variants per
// platform, built from small parts: phones get the `sms:` button, desktops get the QR to /t/<token>.
import { CopyButton } from "@/components/join/CopyButton";
import { isDesktop } from "@/lib/platform";
import { safeQrSvg } from "@/lib/qr";
import { displayNumber } from "@/lib/sms";
import { primaryButton, textButton } from "./classes";
import { useFlow, useSeatText } from "./FlowContext";
import { PhaseHeading } from "./PhaseHeading";

/** "Text SquadTab": the one-tap `sms:` link. Renders nothing where Messages can't open (Windows, Linux). */
export function TextSquadTab({ children = "Text SquadTab" }: { children?: string }) {
  const { meta } = useFlow();
  if (!meta.smsLink) return null;
  return (
    <a href={meta.smsLink} className={primaryButton}>
      {children}
      <span className="arrow" aria-hidden="true">
        →
      </span>
    </a>
  );
}

/** The number and the first text as copyable text: the fallback for in-app browsers and a dropped body. */
export function MessagesDidntOpen() {
  const { number, body } = useSeatText();
  if (!number) return null;
  return (
    <details className="legal text-[15px]">
      <summary>Messages didn’t open?</summary>
      <div className="mt-3 grid gap-3 text-fg">
        <CopyLine label="Text this number" value={number} display={displayNumber(number)} what="SquadTab’s number" mono />
        <CopyLine label="Say" value={body} display={`“${body}”`} what="first text" />
      </div>
    </details>
  );
}

function CopyLine({ label, value, display, what, mono = false }: { label: string; value: string; display: string; what: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <p className="min-w-0">
        <span className="block text-[13px] text-muted">{label}</span>
        <span translate={mono ? "no" : undefined} className={`block font-semibold break-words select-all ${mono ? "mono" : ""}`}>{display}</span>
      </p>
      <CopyButton value={value} what={what} />
    </div>
  );
}

/** The QR of /t/<token> from the agent, inserted only if it has the exact shape `qrcode` emits (lib/qr.ts). */
export function HandoffQr() {
  const { state } = useFlow();
  const svg = safeQrSvg(state.session?.handoff_qr_svg);
  if (!svg) return null;
  return (
    <div
      role="img"
      aria-label="QR code that opens SquadTab on your iPhone, with your first text ready"
      className="scan-qr"
      // biome-ignore lint/security/noDangerouslySetInnerHtml: validated against qrcode's exact SVG shape in safeQrSvg
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

/** "Or text (213) 555-0147 from your iPhone and say "…"": what to do without a camera. */
function TextInstead() {
  const { number, body } = useSeatText();
  if (!number) return null;
  return (
    <p className="text-[15px] leading-snug text-muted">
      Or text <b translate="no" className="mono font-semibold whitespace-nowrap text-fg">{displayNumber(number)}</b> from your iPhone and say “{body}”
    </p>
  );
}

/** Phone (ios, android override): Messages already opened, or one tap away. */
export function HandoffPhone() {
  return (
    <div className="grid gap-3.5">
      <PhaseHeading>Hit send in Messages</PhaseHeading>
      <p className="text-[15px] text-muted text-pretty">We’ll pick it up here the moment your text lands.</p>
      <TextSquadTab />
      <MessagesDidntOpen />
    </div>
  );
}

/** Desktop and Mac after a desktop submit: scan the QR to /t/<token>; the laptop keeps the live status. */
export function HandoffDesktop() {
  const { meta } = useFlow();
  return (
    <div className="grid gap-3.5">
      <PhaseHeading>Continue on your iPhone</PhaseHeading>
      <div className="scan">
        <HandoffQr />
        <p className="text-[15px] leading-snug text-muted">
          <b className="font-[650] text-fg">Scan with your iPhone camera.</b> It opens Messages with your first text ready to send.
        </p>
      </div>
      <TextInstead />
      {meta.platform === "mac" ? <MacMessages /> : null}
    </div>
  );
}

/** Mac only, secondary: Messages on the Mac works only if it sends from the phone number (ux-flow §6). */
function MacMessages() {
  const { meta } = useFlow();
  if (!meta.smsLink) return null;
  return (
    <p className="grid gap-0.5">
      <a href={meta.smsLink} className={textButton}>
        Open Messages on this Mac
      </a>
      <small className="text-[13px] text-muted">Send it from your phone number, not your Apple ID email.</small>
    </p>
  );
}

/** The waiting phase, by platform. Before mount (platform null) it renders the phone variant, like the rest of the flow. */
export function Handoff() {
  const { meta } = useFlow();
  return meta.platform && isDesktop(meta.platform) ? <HandoffDesktop /> : <HandoffPhone />;
}

/** 45 s and still no text: the likely causes, in the order people hit them (ux-flow §4.3). */
export function WaitingLong() {
  const { actions, meta } = useFlow();
  const { last4 } = useSeatText();
  const desktop = meta.platform !== null && isDesktop(meta.platform);
  return (
    <div className="grid gap-3.5">
      <PhaseHeading>Not seeing your text yet</PhaseHeading>
      <p className="text-[15px] text-pretty">
        It has to come from <span translate="no" className="mono whitespace-nowrap">•••• {last4}</span>.
      </p>
      {desktop ? (
        <div className="scan">
          <HandoffQr />
          <TextInstead />
        </div>
      ) : (
        <TextSquadTab />
      )}
      <button type="button" onClick={actions.fixNumber} className={`${textButton} justify-self-start`}>
        Wrong number? Fix it
      </button>
      <p className="text-[13.5px] leading-snug text-muted text-pretty">
        Texting from an email address? On your iPhone, open Settings, Apps, Messages, Send &amp; Receive, and pick your phone number under
        “Start new conversations from”.
      </p>
    </div>
  );
}

/** The agent released an untexted seat (15 min): nothing reached anyone, start again with the same number. */
export function SeatReleased() {
  const { actions } = useFlow();
  return (
    <div className="grid gap-3.5">
      <PhaseHeading>Let’s get you a new line</PhaseHeading>
      <p className="text-[15px] text-muted text-pretty">No text arrived, so SquadTab gave that line back. Getting a new one takes a second.</p>
      <button type="button" onClick={actions.fixNumber} className={primaryButton}>
        Start again
        <span className="arrow" aria-hidden="true">
          →
        </span>
      </button>
    </div>
  );
}
