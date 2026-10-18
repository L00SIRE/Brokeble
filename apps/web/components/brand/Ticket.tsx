import type { ComponentProps, ReactNode } from "react";
import { Lamp, type LampState, Lamps } from "./Lamps";

/*
 * The ticket (design-system 6.4). Server-safe and stateless: no "use client", so it renders in server components and
 * inside client ones (SignalHero) alike. Layout switches by CSS media at 900px, never by props. Styles live in
 * app/globals.css under "Brand kit" (class names follow docs/design/prototype.html).
 */

function cx(base: string, extra: string | undefined) {
  return extra ? `${base} ${extra}` : base;
}

type TicketProps = ComponentProps<"article"> & {
  /** The capture tear: a ground-colored strip opens along the perforation (0.7s, ease-snap) and `$`/"each" turn paper. */
  torn?: boolean;
};

/**
 * Hero ticket on the sodium field: `[main | 22px perforation | 372px stub]`, stacked on phones. Give it an
 * `aria-label` describing the plan ("Example plan: Dinner and a show, 42 dollars each").
 */
function TicketRoot({ torn = false, className, children, ...rest }: TicketProps) {
  return (
    <article {...rest} data-torn={torn ? "true" : "false"} className={cx("ticket-hero", className)}>
      {children}
    </article>
  );
}

/** The ink part: top row, price row, foot. */
function TicketMain({ className, children, ...rest }: ComponentProps<"div">) {
  return (
    <div {...rest} data-ground="ink" className={cx("t-main", className)}>
      {children}
    </div>
  );
}

/** Punched holes in the ground color every 15px, two 30px notches, and the tear strip. Purely visual. */
function TicketPerf() {
  return (
    <div className="t-perf" aria-hidden="true">
      <i className="tear" />
    </div>
  );
}

/** The paper stub: the start action. Its children inherit the paper ground (ink buttons, sodium labels). */
function TicketStub({ className, children, ...rest }: ComponentProps<"div">) {
  return (
    <div {...rest} data-ground="paper" className={cx("t-stub", className)}>
      {children}
    </div>
  );
}

/** Top row of the main part: the eyebrow on the left and a mono flag on the right. */
function TicketTop({ eyebrow, flag, flagMode = "open" }: { eyebrow: ReactNode; flag?: ReactNode; flagMode?: "open" | "booked" }) {
  return (
    <div className="t-top">
      <p className="eyebrow">{eyebrow}</p>
      {flag ? (
        <p className="t-flag" data-mode={flagMode}>
          {flag}
        </p>
      ) : null}
    </div>
  );
}

/** The four seats in the foot. The hero hides them from assistive tech (it is a replay); the sr-only sentence speaks for it. */
function TicketSeats({ className, children, ...rest }: ComponentProps<"ul">) {
  return (
    <ul {...rest} className={cx("seats", className)}>
      {children}
    </ul>
  );
}

/** One seat: lamp, name in display type, state in mono ("Held $42"). HELD and CAPTURED tint the state label. */
function TicketSeat({ name, state, label }: { name: string; state: LampState; label: string }) {
  return (
    <li className="seat" data-s={state}>
      <Lamp state={state} />
      <span className="nm">{name}</span>
      <span className="st">{label}</span>
    </li>
  );
}

/** The status sentence: a bold line in display type and a quieter second line. `aria-live` defaults to "off" (a replay is not news). */
function TicketStatus({ title, detail, ...rest }: Omit<ComponentProps<"p">, "children" | "title"> & { title: ReactNode; detail?: ReactNode }) {
  return (
    <p aria-live="off" {...rest} className={cx("t-status", rest.className)}>
      <b>{title}</b>
      {detail ? <span>{detail}</span> : null}
    </p>
  );
}

export const Ticket = Object.assign(TicketRoot, {
  Main: TicketMain,
  Perf: TicketPerf,
  Stub: TicketStub,
  Top: TicketTop,
  Seats: TicketSeats,
  Seat: TicketSeat,
  Status: TicketStatus,
});

/**
 * The paper-page form (join, organizer): a sodium block with a scalloped bottom edge, eyebrow, title, mono meta,
 * a dotted rule, the lamps and "k of n in" in type. Its count is the only social proof on the web: no names (ux-flow 4.3).
 * `titleAs="h1"` when the ticket title is the page heading (the friend's invite).
 */
export function PlanTicket({
  eyebrow,
  title,
  meta,
  filled,
  total,
  titleAs: Title = "h2",
  className,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
  filled: number;
  total: number;
  titleAs?: "h1" | "h2" | "h3";
  className?: string;
}) {
  const showCount = Number.isFinite(total) && total > 0;
  const k = Math.min(Math.max(0, Math.floor(filled)), Math.floor(total));
  return (
    <div className={cx("plan-ticket", className)}>
      {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
      <Title className="title">{title}</Title>
      {meta ? <p className="meta">{meta}</p> : null}
      {showCount ? (
        <div className="count-row">
          <Lamps filled={k} total={total} />
          <span className="count">
            {k} of {Math.floor(total)} in
          </span>
        </div>
      ) : null}
    </div>
  );
}
