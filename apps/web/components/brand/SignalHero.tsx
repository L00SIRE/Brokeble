"use client";

import { useCallback, useEffect, useRef, useState, type FocusEvent, type ReactNode } from "react";
import { HoldRings, type HoldRingsHandle } from "@/components/brand/HoldRings";
import { MotionToggle } from "@/components/brand/MotionToggle";
import { PriceMark, type PriceMarkFrame } from "@/components/brand/PriceMark";
import { Ticket } from "@/components/brand/Ticket";
import { Wordmark } from "@/components/brand/Wordmark";
import { useMotion } from "@/lib/motion/MotionProvider";
import { SEAT_COUNT, dollars, heroFrame, seatLabel, type HeroCopy } from "@/lib/motion/heroScript";

type SignalHeroProps = {
  /** Price per person in dollars (the plan's real price when there is one). */
  price?: number;
  /** Four first names, in seat order. The last one is the friend who drops in the replay. */
  seats?: readonly string[];
  /** The ticket's stub: W1's start flow (phone step on phones, desktop scan on desktop). */
  stub: ReactNode;
};

const DEMO_SEATS = ["Maya", "Leo", "Sam", "Priya"] as const;
/** Change detection only: a frame's key never depends on the copy. */
const KEY_COPY: HeroCopy = { price: 42, seats: DEMO_SEATS };
/** Rings start from the seat lamps, in seat order. */
const SEAT_LAMPS = ".seat .lamp";

/** Review links freeze the replay: `/?t=2.4` (design-system §0). Read once, client-only. */
function frozenTime(): number | null {
  const raw = new URLSearchParams(window.location.search).get("t");
  if (raw === null || raw.trim() === "") return null;
  const t = Number(raw);
  return Number.isFinite(t) ? t : null;
}

function seatNames(seats: readonly string[]): string[] {
  return Array.from({ length: SEAT_COUNT }, (_, i) => seats[i]?.trim() || DEMO_SEATS[i]!);
}

const isNumberField = (el: EventTarget): el is HTMLInputElement => el instanceof HTMLInputElement && el.type === "tel";

/**
 * The landing hero: sodium field, headline, and the plan as an ink ticket whose price is made of
 * private numbers (design-system §1, §4). A 21 s scripted replay drives the mark, the seats, the
 * status and the rings from one clock (the mark's). The stub is the start action, passed in.
 *
 * It renders the whole first viewport, header to Pause motion, because the rings span all of it
 * and must be kept off every line of copy.
 */
export function SignalHero({ price = 42, seats = DEMO_SEATS, stub }: SignalHeroProps) {
  const { paused } = useMotion();
  const names = seatNames(seats);
  // Only the clock time of the last discrete change is state. The frame and its copy are derived
  // during render, so a new price or name shows even while motion is paused.
  const [shownT, setShownT] = useState(0);
  const frame = heroFrame(shownT, { price, seats: names });
  const keyRef = useRef(frame.key);
  const [calm, setCalm] = useState(false);
  const [freezeAt, setFreezeAt] = useState<number | null>(null);
  const ringsRef = useRef<HoldRingsHandle>(null);

  useEffect(() => setFreezeAt(frozenTime()), []);

  const onFrame = useCallback((t: number, state: PriceMarkFrame) => {
    const key = heroFrame(t, KEY_COPY).key;
    if (key !== keyRef.current) {
      keyRef.current = key;
      setShownT(t);
    }
    // Rings are motion: none under reduced motion or on the calm frame.
    if (state.reduced || state.calm) ringsRef.current?.clear();
    else ringsRef.current?.draw(t);
  }, []);

  // The ticket yields to the task: the calm all-held frame holds only while a number field has
  // focus (design-system §4.4). After submit the replay resumes, so the ticket never claims
  // "Booking now." while the organizer is only texting.
  const stubRef = useRef<HTMLDivElement>(null);
  const onFocusCapture = useCallback((e: FocusEvent<HTMLDivElement>) => {
    if (isNumberField(e.target)) setCalm(true);
  }, []);
  const onBlurCapture = useCallback((e: FocusEvent<HTMLDivElement>) => {
    if (isNumberField(e.target)) setCalm(false);
  }, []);
  // A focused field that unmounts (the stub swaps to the hand-off) fires no blur in every browser.
  useEffect(() => {
    const stub = stubRef.current;
    if (!calm || !stub) return;
    const check = () => {
      const active = document.activeElement;
      if (!(active && isNumberField(active) && stub.contains(active))) setCalm(false);
    };
    const mo = new MutationObserver(check);
    mo.observe(stub, { childList: true, subtree: true });
    return () => mo.disconnect();
  }, [calm]);

  const priceLabel = dollars(price);

  return (
    <section aria-label="SquadTab" className="relative isolate min-h-svh overflow-hidden bg-sodium text-ink">
      <HoldRings ref={ringsRef} seatSelector={SEAT_LAMPS} className="pointer-events-none absolute inset-0 z-0 size-full" />
      {/* Rows 2 and 5 are spacers: on a tall screen (1920x1080) the lede and ticket sit centred between header and footer. */}
      <div className="relative z-[1] mx-auto grid min-h-svh max-w-[1440px] grid-rows-[auto_minmax(0,1fr)_auto_auto_minmax(0,1fr)_auto] pt-[22px] pr-[max(48px,env(safe-area-inset-right))] pb-[max(18px,env(safe-area-inset-bottom))] pl-[max(48px,env(safe-area-inset-left))] max-[899px]:grid-rows-[auto_0_auto_auto_0_auto] max-[899px]:pt-3.5 max-[899px]:pr-[max(16px,env(safe-area-inset-right))] max-[899px]:pb-[max(16px,env(safe-area-inset-bottom))] max-[899px]:pl-[max(16px,env(safe-area-inset-left))]">
        {HEADER}
        {LEDE}

        <Ticket torn={frame.torn} data-ring-center="" aria-label={`Example plan: dinner and a show, ${priceLabel} each`} className={TICKET_CLASS}>
          <Ticket.Main>
            <Ticket.Top
              eyebrow={
                <span className="min-[900px]:whitespace-nowrap">
                  <b>Tonight</b> · Dinner + show · Santa Monica
                </span>
              }
              flag={frame.status.flag}
              flagMode={frame.status.mode}
            />
            <div className={PRICE_ROW_CLASS}>
              <span className="cur" aria-hidden="true">
                $
              </span>
              <PriceMark price={price} paused={paused || calm} calm={calm} freezeAt={freezeAt} onFrame={onFrame} className={MARK_CLASS} />
              <p className={EACH_CLASS}>
                <span className="each">each</span>
                <span className="fits">fits all 4 budgets. Nobody saw anyone’s number.</span>
              </p>
            </div>
            {/* Four seats plus the status need ~680px; below a 1240px viewport they stack (phones stack via .t-foot). */}
            <div className="t-foot min-[900px]:max-[1239px]:grid-cols-1 min-[900px]:max-[1239px]:gap-y-3.5">
              <Ticket.Seats aria-hidden="true">
                {names.map((name, f) => {
                  const state = frame.states[f] ?? "VOTED";
                  return <Ticket.Seat key={f} name={name} state={state} label={seatLabel(state, price)} />;
                })}
              </Ticket.Seats>
              <Ticket.Status
                title={frame.status.big}
                detail={frame.status.small}
                className="min-[900px]:max-[1239px]:justify-self-start min-[900px]:max-[1239px]:text-left"
              />
            </div>
          </Ticket.Main>
          <Ticket.Perf />
          <Ticket.Stub>
            <div ref={stubRef} onFocusCapture={onFocusCapture} onBlurCapture={onBlurCapture} className="contents">
              {stub}
            </div>
          </Ticket.Stub>
        </Ticket>

        <footer data-ring-avoid className="row-start-6 flex items-center justify-between gap-4 pt-3.5 text-[14.5px] max-[899px]:flex-wrap max-[899px]:pt-4 max-[899px]:text-sm">
          <p>
            Got an invite from a friend? <span className="font-[650]">Just tap their link.</span>
          </p>
          <MotionToggle />
        </footer>
      </div>
      <p className="sr-only">
        Animation: a ticket priced at {priceLabel} each. Four friends place card holds one by one, and the plan is booked only when all four
        are in. If anyone drops, every hold is released and nobody pays.
      </p>
    </section>
  );
}

/* Static parts, hoisted so frame updates never rebuild them. */

/*
 * Layout between the reference viewports. The base .t-price/.t-top rules (globals.css) are tuned
 * for 1440x900 and the 390px phone; these utilities keep the composition at the widths and heights
 * judges actually project (1024x768, 1280x720, 1920x1080). Utilities sit in a later cascade layer,
 * so they win over the component rules without !important.
 *
 * - The flag drops to its own line before the eyebrow wraps (no orphaned "· Santa Monica").
 * - 900–1179px (`max-[1180px]` is `width < 1180px`): "each" and its sentence move under the mark as one line, so the mark gets the whole
 *   row and the sentence is never squeezed into a 98px column. The mark gives back that line's height.
 * - 1180px up: "each" keeps a readable column; the mark narrows and keeps its proportions.
 */
// Class names are spelled out in full: Tailwind finds utilities by scanning source text.
const TICKET_CLASS = "row-start-4 min-[900px]:[&_.t-top]:flex-wrap min-[900px]:[&_.t-top]:gap-y-1";
const PRICE_ROW_CLASS =
  "t-price grid-cols-[auto_minmax(0,max-content)_minmax(10.5rem,1fr)] max-[1180px]:grid-cols-[auto_minmax(0,1fr)]";
const MARK_CLASS = [
  "price max-w-full",
  // Height follows the (possibly narrowed) width, so the box always hugs the digits.
  "min-[900px]:h-auto min-[900px]:aspect-[1.62]",
  // Below 1180px the mark gives back the height of the "each" line under it, so the footer stays in view.
  "min-[900px]:max-[1180px]:[--ph:clamp(180px,calc(100svh-610px),400px)]",
].join(" ");
const EACH_CLASS = [
  "t-each",
  "min-[900px]:max-[1180px]:col-span-full min-[900px]:max-[1180px]:flex min-[900px]:max-[1180px]:items-baseline",
  "min-[900px]:max-[1180px]:gap-3 min-[900px]:max-[1180px]:self-auto min-[900px]:max-[1180px]:pt-1 min-[900px]:max-[1180px]:pb-3",
  "min-[900px]:max-[1180px]:[&_.each]:text-[34px] min-[900px]:max-[1180px]:[&_.fits]:max-w-none",
].join(" ");

const HEADER = (
  <header data-ring-avoid className="row-start-1 flex items-center justify-between">
    <a href="/" aria-label="SquadTab home" className="inline-flex min-h-11 items-center transition-opacity hover:opacity-75">
      <Wordmark />
    </a>
    <a href="/console" className="group inline-flex min-h-11 items-center">
      <span className="border-b-2 border-current py-1.5 text-[15px] font-[650] transition-colors group-hover:text-on-sodium-2">Trust console</span>
    </a>
  </header>
);

/** The tagline and sub are desktop-only: on phones the ticket's own copy carries the message (§8). */
const LEDE = (
  <div className="row-start-3 grid grid-cols-[minmax(0,1.25fr)_minmax(0,0.75fr)] items-end gap-x-12 pt-[34px] pb-[26px] min-[900px]:[@media(max-height:779px)]:pt-5 min-[900px]:[@media(max-height:779px)]:pb-4 max-[899px]:grid-cols-1 max-[899px]:pt-[22px] max-[899px]:pb-[18px]">
    <h1
      data-ring-avoid
      className="m-0 text-balance font-display text-[clamp(46px,6.6vw,100px)] font-[770] leading-[0.88] tracking-[-0.055em] max-[899px]:text-[clamp(42px,12.6vw,60px)]"
    >
      Plan the night in one text.
    </h1>
    <div data-ring-avoid className="grid gap-2.5 pb-2 max-[899px]:hidden">
      <p className="font-display text-[clamp(19px,1.6vw,24px)] font-[680] leading-[1.12] tracking-[-0.03em]">
        The friend who knows everyone’s budget and tells no one.
      </p>
      <p className="max-w-[28em] text-[16.5px] leading-[1.45] text-on-sodium-2">
        SquadTab plans dinner and a show with your friends, keeps everyone’s budget private, and nobody fronts the bill.
      </p>
    </div>
  </div>
);
