import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Spinner } from "@/components/join/ui";
import { MotionProvider } from "@/lib/motion/MotionProvider";
import { DotIcon } from "./DotIcon";
import { FirstText } from "./FirstText";
import { DOT_GLYPHS, DOT_ICON_NAMES, dotCentres } from "./icons";
import { Lamp, Lamps } from "./Lamps";
import { MotionToggle } from "./MotionToggle";
import { isSafeQrSvg, ScanCard } from "./ScanCard";
import { PlanTicket, Ticket } from "./Ticket";
import { BrandSymbols, Wordmark } from "./Wordmark";

const html = (node: ReactNode) => renderToStaticMarkup(node);
const count = (s: string, needle: string) => s.split(needle).length - 1;

describe("icons", () => {
  it("every glyph is 7x7 of 0/1", () => {
    for (const rows of Object.values(DOT_GLYPHS)) {
      expect(rows).toHaveLength(7);
      for (const r of rows) expect(r).toMatch(/^[01]{7}$/);
    }
  });

  it("DotIcon draws one circle per lit cell, hidden from assistive tech", () => {
    for (const name of DOT_ICON_NAMES) {
      const out = html(<DotIcon name={name} />);
      expect(out).toContain('aria-hidden="true"');
      expect(out).toContain('focusable="false"');
      if (name === "lock") {
        expect(count(out, "<circle")).toBe(0);
        expect(out).toContain("<path");
        expect(out).toContain("<rect");
      } else {
        expect(count(out, "<circle")).toBe(dotCentres(name).length);
      }
    }
  });

  it("DotIcon takes a color and extra classes", () => {
    const out = html(<DotIcon name="check" color="var(--color-sodium)" className="size-5" />);
    expect(out).toContain('fill="var(--color-sodium)"');
    expect(out).toContain('class="di size-5"');
  });
});

describe("Wordmark", () => {
  it("uses the single ticket symbol and lowercase name", () => {
    const sym = html(<BrandSymbols />);
    expect(count(sym, "<symbol")).toBe(1);
    const id = /<symbol id="([^"]+)"/.exec(sym)?.[1];
    const mark = html(<Wordmark />);
    expect(mark).toContain(`href="#${id}"`);
    expect(mark).toContain("squadtab");
    expect(mark).toContain('translate="no"');
  });
});

describe("Lamps", () => {
  it("Lamp exposes the state for styling and stays decorative", () => {
    expect(html(<Lamp state="HELD" />)).toBe('<span aria-hidden="true" data-state="HELD" class="lamp"></span>');
    expect(html(<Lamp state="BUDGET_LOCKED" className="size-4" />)).toContain('class="lamp size-4"');
  });

  it("Lamps clamps filled into [0, total]", () => {
    expect(count(html(<Lamps filled={1} total={4} />), "data-on")).toBe(1);
    expect(count(html(<Lamps filled={9} total={4} />), "data-on")).toBe(4);
    expect(count(html(<Lamps filled={-2} total={4} />), "data-on")).toBe(0);
    expect(count(html(<Lamps filled={2} total={4} />), "<i")).toBe(4);
    expect(count(html(<Lamps filled={0} total={0} />), "<i")).toBe(0);
  });
});

describe("Ticket", () => {
  it("compound parts render in order, with grounds and the tear flag", () => {
    const out = html(
      <Ticket torn aria-label="Example plan">
        <Ticket.Main>
          <Ticket.Top eyebrow="Tonight" flag="Booked · $168 charged" flagMode="booked" />
          <Ticket.Seats aria-hidden="true">
            <Ticket.Seat name="Maya" state="CAPTURED" label="Paid $42" />
          </Ticket.Seats>
          <Ticket.Status title="Everyone’s in. Booked." detail="$168 charged, $42 each." />
        </Ticket.Main>
        <Ticket.Perf />
        <Ticket.Stub>stub</Ticket.Stub>
      </Ticket>,
    );
    expect(out).toMatch(/^<article aria-label="Example plan" data-torn="true" class="ticket-hero">/);
    expect(out).toContain('data-ground="ink" class="t-main"');
    expect(out).toContain('<div class="t-perf" aria-hidden="true"><i class="tear"></i></div>');
    expect(out).toContain('data-ground="paper" class="t-stub"');
    expect(out).toContain('data-mode="booked"');
    expect(out).toContain('<li class="seat" data-s="CAPTURED">');
    expect(out).toContain('aria-live="off"');
    expect(out.indexOf("t-main")).toBeLessThan(out.indexOf("t-perf"));
    expect(out.indexOf("t-perf")).toBeLessThan(out.indexOf("t-stub"));
    expect(html(<Ticket>x</Ticket>)).toContain('data-torn="false"');
  });

  it("PlanTicket shows k of n in, and no count without a total", () => {
    const out = html(<PlanTicket eyebrow="Alex invited you" title="Dinner + show" meta="Sat, Oct 24 · 7:00 PM" filled={2} total={4} titleAs="h1" />);
    expect(out).toContain('<h1 class="title">Dinner + show</h1>');
    expect(out).toContain("2 of 4 in");
    expect(count(out, "data-on")).toBe(2);
    const generic = html(<PlanTicket title="A SquadTab plan" filled={0} total={0} />);
    expect(generic).toContain('<h2 class="title">');
    expect(generic).not.toContain("count-row");
    expect(html(<PlanTicket title="t" filled={7} total={4} />)).toContain("4 of 4 in");
  });
});

describe("ScanCard", () => {
  const qr = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 29 29" shape-rendering="crispEdges"><path fill="#f6f1e6" d="M0 0h29v29H0z"/><path stroke="#100e0a" d="M0 0.5h7"/></svg>\n';

  it("accepts qrcode SVG output and rejects anything executable", () => {
    expect(isSafeQrSvg(qr)).toBe(true);
    expect(isSafeQrSvg('<svg onload="alert(1)"></svg>')).toBe(false);
    expect(isSafeQrSvg("<svg><script>alert(1)</script></svg>")).toBe(false);
    expect(isSafeQrSvg('<svg><a href="javascript:alert(1)">x</a></svg>')).toBe(false);
    expect(isSafeQrSvg('<svg><foreignObject><div/></foreignObject></svg>')).toBe(false);
    expect(isSafeQrSvg('<svg><use href="data:x"/></svg>')).toBe(false);
    expect(isSafeQrSvg("<img src=x onerror=alert(1)>")).toBe(false);
  });

  it("renders the QR as a labelled image and the fallback disclosure", () => {
    const out = html(
      <ScanCard title="Scan to start on your iPhone" svg={qr} body="Point your camera here.">
        <ScanCard.More>
          <form />
        </ScanCard.More>
      </ScanCard>,
    );
    expect(out).toContain('<p class="stub-kicker">Your seat</p>');
    expect(out).toContain('<h2 class="stub-title">Scan to start on your iPhone</h2>');
    expect(out).toContain('role="img" aria-label="QR code that opens this page on your iPhone"');
    expect(out).toContain("shape-rendering");
    expect(out).toContain('<details class="or-number"><summary>Or enter your number here</summary>');
  });

  it("drops an unsafe svg instead of injecting it", () => {
    const out = html(<ScanCard title="t" svg='<svg onload="x()"></svg>' body="b" />);
    expect(out).not.toContain("onload");
    expect(out).not.toContain('role="img"');
  });
});

describe("FirstText, Spinner, MotionToggle", () => {
  it("FirstText shows the exact body as a quotation", () => {
    const out = html(<FirstText text="Hey SquadTab! Help me plan a night out." />);
    expect(out).toContain("<q>Hey SquadTab! Help me plan a night out.</q>");
    expect(out).toContain("Your first text, typed for you");
  });

  it("Spinner is three decorative dots", () => {
    const out = html(<Spinner />);
    expect(out).toContain('aria-hidden="true"');
    expect(count(out, "<i>")).toBe(3);
  });

  it("MotionToggle is an aria-pressed toggle with one stable name", () => {
    const out = html(
      <MotionProvider>
        <MotionToggle />
      </MotionProvider>,
    );
    expect(out).toContain('type="button"');
    expect(out).toContain('aria-pressed="false"');
    expect(out).toContain("Pause motion");
  });

  it("MotionToggle outside the provider fails loudly", () => {
    expect(() => html(<MotionToggle />)).toThrow(/MotionProvider/);
  });
});
