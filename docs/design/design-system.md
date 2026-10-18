# SquadTab design system: "Signal"

Status: committed direction for the build (v2, "the ticket", after the 2026-10-18 critique pass).
Supersedes the "Green Light" palette in `docs/design/theme.css` and `type-color-system.md` (section 11 explains why).
Copy and flow come from `docs/design/ux-flow.md`. This doc does not change that flow, except for new console and ticket strings flagged in sections 7 and 8.
Live prototype: `scratch/design/prototype.html`. Serve it with `python -m http.server 5179` from `scratch/design/`. For review:
- `?t=<s>` freezes the hero;
- `?ct=<s>` freezes the console;
- `?theme=paper` opens the console on its paper (projector) ground.

The v1 prototype is kept at `scratch/design/prototype.v1.html` for comparison.

Screenshots (all regenerated from v2):

| File | What |
|---|---|
| `shot-desktop.png` | 1440×900, `t=2.4`, two of four held |
| `shot-desktop-captured.png` | `t=6.4`, booked: lit price, torn stub |
| `shot-desktop-full.png` | Whole page, desktop |
| `shot-mobile.png` | 390×844 at DPR 2, `t=2.4` |
| `shot-mobile-full.png` | Whole page, mobile |
| `shot-console.png` | `ct=7.6`, captured |
| `shot-reduced-motion.png` | Reduced motion: the calm all-held frame, no rings |

Per-state review frames are in `scratch/design/critique/v2-*.png`.

---

## 0. What changed after the critique, and how each fix was verified

Every critique finding is listed below with what changed and where to see it.

| # | Critique finding | Fix | Verified in |
|---|---|---|---|
| P0 | "$42" mark illegible, mostly on phones | The `$` is real type now (Funnel Display 800) and only "42" is glyph art. Digits come from 4 density classes and re-roll only inside their class, so the outline never wobbles. Tones step from rim to core (3–4 visible steps) with a top-left bevel. The mark fills the ticket's price row: 240–400px tall on desktop and 138px on phones. | `critique/v2-d-t0.3-ticket.png` (dim frame), `v2-d-t4.2.png`, `shot-mobile.png`: "42" reads in every frame, phone included |
| P0 | CAPTURED pixel-disc wash broke text (1.6:1, 1.08:1) | The wash is gone. Capture lights only the mark's own glyphs: one radial over 0.6s, from sodium to cream, inside the "42". The `$` and "each" turn paper, the stub tears off, and one ink ring crosses the field. **No copy ever changes ground**, so no mid-transition contrast pair exists. | `shot-desktop-captured.png`; `scripts/contrast-states.mjs` (38 pairs, 0 failing) |
| P0 | Layout derivative of prized.dev | The ticket is the hero object: a full-width ink ticket on the sodium field. It has a giant price, four seat lamps, a perforation with notches, and a paper stub that holds the start action. The split hero, right-column ASCII and dot lattice are gone. The two-item nav is now one link. | `shot-desktop.png` vs `Screenshot 2026-10-17 235043.png` |
| P0 | Chat-first fix not visible | **Desktop:** the stub's primary element is "Scan to start on your iPhone", a real QR of `https://tab-web-ten.vercel.app/` (generated with `qrcode@1.5.4`, the agent's pinned version), with "Or enter your number here" as a `<details>`. **Phone:** "Text SquadTab from [number]", then the first text already typed out, then **Start in iMessage**. **Organizer:** a new plan-ready screen ("You're already in", **Send invite to your group** with share-sheet icon, "Copy link instead" as secondary). | `shot-desktop.png`, `shot-mobile.png`, `critique/v2-join.png` |
| P1 | Console never shows "private budgets" | Every lane has a fixed-width redaction bar (the same width for everyone, so length leaks nothing) and the readable verdict "Budget hidden · **$42 fits**". The privacy X-ray is now a full-width band: "Budgets: hidden, and checked.", with "What the group sees" and "What only SquadTab sees" side by side, at 1.2–1.35cqw. | `critique/v2-c-ct3.6.png` |
| P1 | Console never shows "all-or-nothing" | **The gate.** Every lane ends in a feed line into one vertical bus segment, and the four segments form one bar. A connector runs into the meter: "Held so far $126 of $168 · Charged $0 · 3 of 4 holds", plus 4 cells. On capture the meter becomes "Captured, all or nothing **$168**" in go, larger than the status sentence. The capture ring is a solid band about 3 cells thick, lasts 1.2s and plays once. | `v2-c-ct3.6.png`, `v2-c-ct7.6.png` |
| P1 | RELEASED reads as failure and erases history | Amount "$0.00 charged" in the primary text color with no strike. A neutral dashed RELEASED chip. The rail stays solid through Held, then a dashed run to a "Released" end mark. DECLINED keeps Voted done. The CREAO strip freezes: "Concierge stopped. Nothing booked, nothing charged." | `v2-c-ct21.5.png` |
| P1 | Rule violations (✓, green digits, green live dot, waffle wordmark) | The ✓ is now a dot-check icon. Counters are paper dots, with go kept for CAPTURED fills. The live dot is a slow paper pulse. The wordmark is a ticket silhouette with side notches and three perforation holes. | `v2-c-ct7.6.png`, every header |
| P1 | Contrast and size failures | Chip and station outlines are night-2 (7.06:1; was 1.47). Every console label is ≥0.95cqw (≥13px at 1360px). TAP is no longer dimmed to 25%: labels show at full contrast with placeholder values. TAP is a 3-line human summary, and the 6 steps are in plain words ("Agent known, Details sealed, Not expired, Never reused, Key on file, Signature good"). No ellipsis truncation anywhere. | `scripts/contrast-states.mjs`; `v2-c-*.png` |
| P1 | Motion problems | The hero loop is 21s in two short cycles, and each starts on an **already assembled** frame. The first hold lands at 0.9s and capture at 4.7s, so a 5-second glance gets the story. Scramble runs at 2 Hz and each cell re-rolls only every 5–9 ticks (≈14% per tick). HELD and CAPTURED glyphs are **frozen**, so a still shows the difference. The fake CREAO loop is gone: the track moves only on script events (production: run events only). | `v2-d-t2.png` vs `v2-d-t4.2.png` |
| P2 | Dead band, inverted console space, templated headers, lowercase mono ticker, "Ф0" | Mark height tracks the viewport (`clamp(240px, 100svh − 525px, 400px)`), so there is no dead band at 900px. Lanes are ≈70px (were ≈120). Section headers are sentences ("Charged only at 4 of 4.", "Budgets: hidden, and checked."). Seat names are in display type and sentence case. `$` is set in type beside the dot digits. | `shot-desktop.png`, `v2-c-ct7.6.png` |
| P2 | Join-screen icons, dead gap, glitchy tally | Icons are redrawn on 7×7, and the lock is a hand-drawn shackle plus a solid body. The form follows the promises directly. The "3 of 4" tally is display type. | `v2-join.png` |
| P2 | Visa trade-dress risk on the gold field | No Visa wording on the sodium field: the rails line moved to the console header, on ink. | `shot-desktop.png` |
| P2 | Paper console not prototyped | `data-theme="paper"` on the console is a set of console-local variables, toggled with **Ink / Paper (projector)**. It passes contrast (section 3.2). Choosing between them on the real projector is still open (section 9). | `v2-c-paper-ct3.6.png` |

Still open, and not claimed as done:
- The 3-person one-second "forty-two" read test is not run. Do it at the venue.
- Real-iPhone frame timing is not measured (section 9).
- The empty-console, missing-key and error states are specified (section 7.3) but not prototyped.
- The venue pay page is owned by a teammate and not covered here.

---

## 1. The concept in one screen

**SquadTab works like a traffic signal for a group plan, and the plan is a ticket.**

- **Amber means hold.** Money is set aside, not taken. It can be reversed.
- **Green means go.** Everyone's in and the cards are captured.
- **There is no red.** If anyone drops, every hold is released. That's the promise working, not an error.

**The signature object: a ticket whose price is made of private numbers.** The fair price per person ("$42") is the ticket's price, drawn in giant digit-art inside an ink ticket.
- The digits keep re-rolling and never resolve into anyone's number.
- Each friend owns a quarter of the number. When they place a hold, their quarter turns solid sodium and stops moving.
- When the fourth hold lands, the price lights cream from the centre out and the stub tears off: booked.
- If someone drops, the lit number fades to a ghost of dots. Nobody paid.

That one object says:
- the plan is something you hold a seat in;
- each budget stays private;
- the group still gets one price;
- nobody is charged until everyone is in.

**The stub is the action.** On desktop it's the QR to start on your iPhone. On a phone it's the first line of the conversation. The thing you'd tear off a ticket is the thing you take with you.

**Why amber.** Sodium-vapor amber is the color of 1 a.m. streetlights: nightlife, going out. In signaling it already means "hold". It has high chroma at high lightness (oklch 81.7% 0.164 75.8), so ink text on it reaches 10.7:1. A saturated field can carry the copy, and green can't (section 11).

| Surface | Ground | Why |
|---|---|---|
| Landing `/` | Sodium field, ink ticket, paper stub | Loud and inviting. The ticket is the plan, and the stub is your seat. |
| Organizer plan-ready | Paper, with a sodium ticket | The plan exists and you're already in. Next: share it. |
| Join `/j/[code]` | Paper, with a sodium ticket | Calm: one field. |
| You're in | Ink | Lights down, you're on the list. |
| Trust Console | Ink (or paper on a washed-out projector) | The signal box: lanes, one gate, read from 5 m. |

**Ticket color rule.** The ticket's main part is always the contrast color of its ground: ink on sodium, sodium on paper. The shape stays the same: radius, perforation, notches, seat lamps.

---

## 2. Story beats (use these exact words in the pitch)

1. "This is the plan, a ticket. The price is $42 each, and it's made of tiny digits that never stop changing. Those are everyone's private budgets. You'll never read one."
2. "Each friend owns a piece of the price. When Maya places a card hold, her piece goes solid. Amber means held, not charged."
3. "When the fourth hold lands, the price lights up and the stub tears off. That's the capture. Booked."
4. "If one person drops, the price fades to dots. No red, no failure. Every hold is released and nobody paid."
5. On the console: "Every lane feeds one gate. Look at the meter: $126 held, $0 charged. Money moves only at 4 of 4."

---

## 3. Tokens (Tailwind v4)

All pairs were measured with WCAG 2.x relative luminance. `scratch/design/scripts/contrast-states.mjs` checks every state of v2 on both console grounds: 38 pairs, 0 failing.

### 3.1 Palette

| Token | Hex | Role | Contrast (measured) |
|---|---|---|---|
| `sodium` | `#FFB224` | Brand field, HELD fill, primary label on ink | ink on it 10.69 |
| `sodium-hi` | `#FFC65A` | Bevel highlight in the mark | ink on it 12.37 |
| `sodium-deep` | `#E59A12` | Pressed sodium | decorative |
| `on-sodium-2` | `#3A2A06` | Secondary text on sodium | 7.69 |
| `ink` | `#100E0A` | Text on light, ticket, night ground | paper on it 17.12 |
| `ink-2` | `#1A1813` | Raised night surface (rare) | paper 15.75 |
| `rule-night` | `#34302A` | Hairlines on night (decorative only, **never a state outline**) | 1.47 |
| `paper` | `#F6F1E6` | Light ground, stub, text on night | ink 17.12 |
| `paper-2` | `#EDE6D6` | Raised paper | ink 15.51 |
| `on-paper-2` | `#6B6355` | Secondary text on paper, outlines on paper | 5.26 |
| `rule-paper` | `#D8CFBC` | Hairlines on paper (decorative only) | 1.37 |
| `night-2` | `#A39C8C` | Secondary text on night, **chip and station outlines** | 7.06 |
| `night-3` | `#8C8576` | Idle feed dashes, tertiary | 5.26 |
| `go` | `#3BE38B` | CAPTURED fill, lamp, bus, captured meter | 11.52 on ink |
| `go-ink` | `#0B6B3F` | CAPTURED text and lines on paper | 5.85 on paper |
| `held-line-paper` | `#B07209` | HELD feed and bus on the paper console | 3.55 on paper |

There is **no red token**. Form errors use ink text, a 3px border and the ux-flow sentence.

### 3.2 State language (every surface)

| State | Lamp | Chip | Rail | Amount | Feed / bus |
|---|---|---|---|---|---|
| JOINED / VOTED | hollow, paper edge | outline, night-2 border, paper text | stations done to Voted | `$42.00` in night-2, "share" | dashed night-3 / rule segment |
| HELD | sodium fill | **solid** sodium, ink text | done to Voted, Held is current (sodium square, bold label) | `$42.00` paper, "held, not charged" | solid sodium |
| CAPTURED | go fill | **solid** go, ink text | all four done, go line | `$42.00`, "charged" | solid go |
| RELEASED | dashed | **dashed** outline, paper text, no strike | solid to Held, dashed to a "Released" end mark (square with a diagonal) | `$0.00`, "charged" | dashed |
| DECLINED | dashed | dashed outline | solid to Voted, dashed to a "Declined" end mark | `$0.00`, "charged" | dashed |

- Never color alone: states also differ by solid vs outline vs dashed (WCAG 1.4.1).
- On the paper console, HELD and CAPTURED lamps and chips also get a 2px ink edge. Sodium and go are below 3:1 on paper, so the ink edge carries the 3:1 for UI components (1.4.11).

### 3.3 Type

| Role | Family | Settings |
|---|---|---|
| Display | **Funnel Display** 650–800 | tracking −0.03 to −0.055em; line-height 0.88–1.05 |
| Text | **Funnel Sans** 400–700 | 17px body |
| Data | **Martian Mono** | `wdth` 87.5 for UI, 75 for tracks; tabular numerals |
| Price mark | Martian Mono 700, condensed, in canvas | sized so one advance equals one cell |
| Signal numerals | Our own 5×7 dot font (canvas) | console counters only. `$` is set in Funnel Display beside the digits, never as dots. |

- All three families are in the installed `next/font` data (`apps/web/node_modules/next/dist/compiled/@next/font/dist/google/font-data.json`): Funnel Display `wght` 300–800, Funnel Sans `wght` 300–800, Martian Mono `wdth` 75–112.5 and `wght` 100–800.
- Use sentence case everywhere. Uppercase is reserved for protocol state tokens in chips (HELD, CAPTURED, RELEASED, DECLINED, VOTED).

### 3.4 `globals.css` (replacement, see section 12 task D1)

```css
@import "tailwindcss";

@theme inline {
  --font-display: var(--font-funnel-display), ui-sans-serif, system-ui, sans-serif;
  --font-sans: var(--font-funnel-sans), ui-sans-serif, system-ui, sans-serif;
  --font-mono: var(--font-martian-mono), ui-monospace, "SF Mono", Menlo, monospace;
}

@theme static {
  --color-sodium: #ffb224; --color-sodium-hi: #ffc65a; --color-sodium-deep: #e59a12; --color-on-sodium-2: #3a2a06;
  --color-ink: #100e0a; --color-ink-2: #1a1813; --color-ink-3: #24211a; --color-rule-night: #34302a;
  --color-paper: #f6f1e6; --color-paper-2: #ede6d6; --color-on-paper-2: #6b6355; --color-rule-paper: #d8cfbc;
  --color-night-2: #a39c8c; --color-night-3: #8c8576;
  --color-go: #3be38b; --color-go-ink: #0b6b3f; --color-held-line-paper: #b07209;

  /* Legacy aliases: every existing component re-skins on day one, before its rewrite lands.
     Mapped by meaning, not by hue. No purple lock, no cyan accent, no red. */
  --color-bg: #100e0a;        /* ink */
  --color-surface: #1a1813;   /* ink-2 */
  --color-surface-2: #24211a; /* ink-3 */
  --color-border: #a39c8c;    /* night-2: today it outlines state chips, so it must pass 3:1 */
  --color-fg: #f6f1e6;        /* paper */
  --color-muted: #a39c8c;     /* night-2 */
  --color-accent: #ffb224;    /* sodium = HELD */
  --color-ok: #3be38b;        /* go = CAPTURED */
  --color-warn: #a39c8c;      /* RELEASED is neutral, never a warning */
  --color-danger: #a39c8c;    /* DECLINED is neutral too: there is no red */
  --color-lock: #ffb224;

  --text-hero: clamp(2.875rem, 6.6vw, 6.25rem); --text-hero--line-height: .88; --text-hero--letter-spacing: -.055em;
  --text-title: clamp(1.875rem, 3.4vw, 3rem);   --text-title--line-height: 1;  --text-title--letter-spacing: -.04em;
  --text-body: 1.0625rem; --text-body--line-height: 1.5;
  --text-micro: .8125rem;  --text-micro--line-height: 1.4;
  /* console scale kept for the legacy panels until D3 lands */
  --text-console-label: 1.125rem; --text-console-body: 1.375rem; --text-console-key: 2.25rem; --text-console-hero: 3.5rem;

  --radius-control: 6px; --radius-ticket: 14px; --radius-screen: 30px;
  --ease-out: cubic-bezier(.2,.8,.2,1); --ease-snap: cubic-bezier(.7,0,.2,1);
}

html { color-scheme: light dark; }
body { background: var(--color-ink); color: var(--color-paper); font-family: var(--font-sans); font-variant-numeric: tabular-nums; }

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: .01ms !important; transition-duration: .01ms !important; }
}
```

Console sizes are container-relative. The console root sets `container-type: inline-size`, and every size is in `cqw` (values in `prototype.html` under `.c-grid`). At a 1360px console:

| Element | cqw | px |
|---|---|---|
| Status sentence | 3.6 | 49 |
| Captured meter number | 4.3 | 58 |
| Lane name | 2.2 | 30 |
| Amount | 1.85 | 25 |
| Section sentences (gate, X-ray) | 1.75 | 24 |
| Chip | 1.12 | 15, bold |
| Every label, caption, step | ≥0.98 | ≥13 |

---

## 4. The signature animation

### 4.1 Engine: `GlyphField` (in-house)

It re-implements the prized technique and copies none of its code.
- A grid of `W × 2W` cells. Each (char, color) pair is drawn once into a sprite sheet.
- Only changed cells are repainted. The frame rate is capped and the time step is clamped to 100ms.
- It pauses off-screen (IntersectionObserver), in hidden tabs, under reduced motion and on **Pause motion**.

Production hardening from `scratch/design/motion/dotMatrixEngine.ts`:
- rebuild sprites after `document.fonts.ready`;
- a DPR `matchMedia` listener;
- read the font family through `getComputedStyle`, because `next/font` hashes the names.

`setPalette(fg, bg)` swaps palettes (the console's ink/paper switch) without a re-layout.

### 4.2 The price mark (`PriceMark`)

**1. Mask**
- Rasterize "42" (the plan's real per-person price when there is one) in Funnel Display 800, condensed ×0.9, into 2×4 subsamples per cell.
- Cells are 6px wide on desktop (mark height ≥200px) and 4px on phones.

**2. Density classes, so the outline never wobbles**

| Class | Rule | Glyphs |
|---|---|---|
| Rim | coverage 1–3 of 8 | `.` or `:` |
| Edge | chamfer distance to the outside ≤2 (x step 1, y step 2) | `2 7 4` |
| Body | distance ≤4 | `0 5 3` |
| Core | deeper | `8 9 6` |

- Re-rolls pick only inside the cell's class.
- Bevel: +1 tone where the cell above or to the left is outside, −1 where the cell below or to the right is outside. That gives a visible top-left light and the depth v1 lacked.

**3. Regions.** Four vertical quarters of the mark's bounding box, one per seat: the left and right halves of "4", then of "2". A hold wipes its quarter left to right over 0.3s.

**4. Looks (palette index into `MARK_FG`; tone = class tone + bevel)**

| Look | Class tones (rim, edge, body, core) | Glyphs | Meaning |
|---|---|---|---|
| dim | 1, 2, 3, 3 (max 4) | re-roll at 2 Hz, each cell every 5–9 ticks | voted, nothing held |
| held | 4, 5, 6, 6 (sodium, max 7) | **frozen** | this friend's card is held |
| lit | 7, 8, 9, 9 (cream) | frozen | captured. One radial from the mark's centre over 0.6s, with a 0.1s brighter front |
| ghost | `.` in `#2E2616` | static | released or declined; the dissolve is staggered by a per-cell hash over 0.6s |

The digits never resolve into a value. Under reduced motion there is no scramble.

### 4.3 Timeline (scripted replay of the console state machine; 21s)

**Cycle A, captured (11s).** It starts assembled and dim at "4 of 4 voted."

| t (s) | Event | Mark | Ticket | Field |
|---|---|---|---|---|
| 0.9 / 1.8 / 2.7 / 3.6 | each seat holds | that quarter wipes to held | lamp turns sodium, "Held $42", status "k of 4 held. Nobody is charged until 4 of 4." Flag "Admit 4 · k held · nothing charged" | a double ink ring (20% alpha) from that lamp, 430px/s, 2.1s |
| 4.7 | **CAPTURED** | radial to lit | lamps go, "Paid $42", "Everyone's in. Booked. $168 charged, $42 each. Nobody fronted the bill." Flag "Booked · $168 charged" in go | one ink ring (30%) from the ticket centre, 780px/s, 1.5s |
| 5.05 | tear | | the perforation opens a 6px sodium gap top to bottom (0.7s, `ease-snap`). `$` and "each" turn paper | |
| 9.6 | reset | each cell fades back to dim on a hash over 0.9s | back to "4 of 4 voted." | |

**Cycle B, released (10s).**

| t (s) | Event | Mark | Ticket | Field |
|---|---|---|---|---|
| 0.9 / 1.8 / 2.7 | three holds | as in cycle A | | rings |
| 3.8 | Priya can't make it | her quarter goes ghost | "Can't make it", "Priya can't make it. Releasing every hold now." | one **dashed** ring |
| 4.7 (+0.14 per seat) | every hold released | the other quarters go ghost | "Released", "Every hold released. Nobody paid for a plan that didn't happen." Flag "Not booked · $0 charged" | dashed rings |
| 8.6 | reset | ghost fades back to dim | | |

### 4.4 The ticket yields to the task

- Focusing either number field freezes the mark on the calm all-held frame (`t = 4.2`) and stops the rings.
- **Pause motion** (`aria-pressed`) stops every canvas (WCAG 2.2.2).
- The sr-only sentence describes the replay. The ticket's status is `aria-live="off"`, because it is a replay, not news.

---

## 5. Background motion (all surfaces)

| Surface | Background | What moves it |
|---|---|---|
| Landing | plain sodium field (**no dot lattice**) | **hold rings** from the seat lamps (double ink stroke), the capture ring, and dashed release rings. All are masked out of every text line and control. Nothing else moves. |
| Ticket | the price mark | the scramble (2 Hz, sparse) means private; freezing means held; light means booked |
| Join, organizer, you're in | static | nothing. One task, keep it calm |
| Console | ink (or paper) dot lattice, kept out of every text box | **one ring per real event**: amber from that lane's lamp on HELD (30 units/s, 2.2s); one solid go band ≈3 cells thick across the console on CAPTURED (130 units/s, 1.2s, once); a grey ring per RELEASED. No ambient loop. |

The only continuous console motion is the redaction bars re-rolling at 2 Hz. That motion means "private".

---

## 6. Components

### 6.1 Buttons

| Variant | Use | Style |
|---|---|---|
| Primary on paper or white | **Start in iMessage**, **Join in iMessage**, **Send invite to your group**, **Continue on your iPhone** | `ink` fill, `sodium` label, Funnel Sans 700 17px, 58px tall, radius 6px, `→` nudges 3px on hover, 1px press |
| Primary on ink | **Open Messages** | `sodium` fill, `ink` label |
| Text button | **Copy link instead**, secondary actions | underline 2px, offset 4px |

- No pills, gradients, glows or colored shadows.
- Full width below 900px.
- Busy state: ux-flow's label ("Getting your line…") plus a three-dot sequence at 6 Hz.

### 6.2 Inputs

- 58px tall, 2px ink border, white fill, radius 6px.
- Martian Mono 17px (≥16px, so iOS doesn't zoom).
- The label sits above, never a placeholder-as-label.
- Attributes per ux-flow 4.1: `type="tel" inputMode="tel" autoComplete="tel" enterKeyHint="go"`.
- Error state: 3px border and the ux-flow sentence in ink. No red.

### 6.3 Start, hand-off and share (answers the four complaints visibly)

- **Desktop `/` and `/j/[code]` before submit:** the stub shows "Your seat" in small mono, then **Scan to start on your iPhone** (or "Scan to join on your iPhone"), a 168px ink QR of the page's own URL on paper, and "Point your camera here. Messages opens with your first text ready. Nothing to fill in."
  - Below it is the `<details>` "Or enter your number here", holding the one field and **Continue on your iPhone**. After that submit, the post-submit QR goes to `/t/<token>` (ux-flow 4.2).
- **Phone `/`:** the stub reads as the start of a chat.
  - "Text SquadTab from", then the number field.
  - "Your first text, typed for you" with "Hey SquadTab! Help me plan a night out." on a 3px sodium left rule. It is plain text, not an Apple bubble.
  - **Start in iMessage**.
  - One legal line: "You send the first text. Details". The `<details>` holds the consent sentence.
- **Organizer plan-ready:**
  - "Your plan is ready, Alex.", then the ticket with 1 of 4 lamps lit.
  - An outlined line with a dot check: "You're already in. Nothing else to fill in." This answers the re-entry complaint.
  - "SquadTab asks each friend for their budget in private, by text. Nobody sees anyone else's number, not even you." This answers the budget-form complaint.
  - **Send invite to your group** with the dot share icon, calling `navigator.share()`.
  - Then "Copy link instead" and "SquadTab texted you the link too."
- A QR never appears on a phone, and a link is never copy-only.

### 6.4 The ticket (`Ticket`)

- **Hero form:** a horizontal grid `[main | 22px perforation | 372px stub]`.
- **Phone form:** stacked, with a horizontal perforation.
- The main part has radius 14px on its outer corners and contains:
  - a top row: eyebrow and mono flag;
  - the price row: `$`, the canvas and "each";
  - a foot: four seats, each a lamp, name and mono state, plus the status sentence.
- The perforation is punched holes in the ground color every 15px plus two 30px notches.
- `data-torn="true"` scales a 6px ground-colored strip along the perforation: the tear.
- **Paper-page form** (join, organizer): a sodium block with the scalloped bottom edge, eyebrow, title, mono meta, a dotted rule, four lamps and "k of 4 in" in type.
- The anti-AI rule still holds: no grids of identical bordered cards. The ticket is the only card, and it means something.

### 6.5 Icons

- 7×7 dot glyphs at 22px (pitch 3, dot radius 1.18): chat, card, check, box, share, wait.
- **Lock is the one exception:** a stroked shackle on a solid body. As dots it read as "a little building" in review twice.
- No Lucide, no emoji, no ✓/✗ characters.

### 6.6 Wordmark

- `squadtab` in lowercase, Funnel Display 800, −0.045em.
- Mark: a ticket silhouette (24×16) with semicircle notches on both sides and three perforation holes at x=17. It is one `<symbol>`, so every instance is a `<use>`.
- Favicon: the ink ticket on a sodium tile.
- It no longer reads as an app-launcher grid.

---

## 7. Trust Console (16:9)

### 7.1 Layout

```
┌ [ticket] squadtab  Trust console  Dinner + show · Sat 7:00 PM · Santa Monica · 4 people   Holds on Visa Cybersource  ● Live ┐
│ 3 of 4 held.                                                        │                                                      │
│ Nobody is charged until 4 of 4.                                     │ Charged only at 4 of 4.                               │
│ ● Maya  ▒▒▒ Budget hidden · $42 fits  ■─■─■─□ Joined…Captured  $42.00 held, not charged  [HELD] ──┃──── Held so far   │
│ ● Leo   …                                                                                  [HELD] ──┃     $126 of $168    │
│ ● Sam   …                                                                                  [HELD] ──┃     Charged $0 · 3 of 4 holds │
│ ○ Priya …                                                    $42.00 share                 [VOTED] ┄┄┃     ▬▬▬▭            │
│                                                                                                     │ $0 fronted by any one person │
│                                                                                                     │ 41 groups booked  118 holds released │
├ Budgets: hidden, and checked. │ What the group sees: 4 people · every budget fits · $42 each … │ What only SquadTab sees: Maya ▒▒ Locked … ┤
├ Signed agent request · Visa Trusted Agent Protocol   (3-line summary + 6 plain steps) │ CREAO research agents (3 runs + log) ┤
```

The grid is `[main 1fr | gate 27.5cqw]` with rows `head | status + gate title | lanes + gate | privacy band | proofs`. Lane columns: `lamp 1.5 | who 19.6 | rail 1fr | amount 8.6 | chip 8.4 | feed 3` (cqw).

### 7.2 Copy

**Status sentence.** New strings; check with the copy owner, since money and privacy copy is frozen per PLAN §8.

| State | Line 1 | Line 2 |
|---|---|---|
| Voted | "4 of 4 voted." | "Rooftop dinner + Largo comedy, $42 each. Holding cards now." |
| Holding | "k of 4 held." | "Nobody is charged until 4 of 4." (at 4: "Everyone's held. Booking now.") |
| Captured | "Everyone's in. Booked." | "$168.00 captured, 4 × $42.00. Nobody fronted a cent." |
| Declined | "Priya can't make it." | "Releasing every hold. Nobody pays for a plan that didn't happen." |
| Released | "Every hold released." | "Nobody paid. Holds drop off cards with no charge." |
| Empty | "Waiting for the group." | "Text SquadTab to start a plan. Lanes appear as friends join." |

**Meter**

| Mode | Label | Number | Sub |
|---|---|---|---|
| holding | "Held so far" | `$held` "of $total" | "Charged **$0** · k of 4 holds" |
| captured | "Captured, all or nothing" | `$total` in go (go-ink on paper) | "Charged **$total** · n × $share" |
| released | "Released" | "$0" "charged" | "**k** holds released · nobody paid"; cells go outline-only |

**Lane proof line**
- "Budget hidden · **$X fits**" appears only when the lane is at least BUDGET_LOCKED **and** a shortlist exists.
- This is true by construction: `computeShortlist` keeps only bundles that pass every member's private constraints (`apps/agent/src/decide/score.ts:105-111`, `filter(fitsPrefs(…), constraints)`).
- Before that: "Budget hidden". At INVITED or JOINED: "Budget not set yet".
- Never render a number from a delegate.

**TAP summary**

| Phase | Line 1 | Line 2 | Line 3 |
|---|---|---|---|
| idle | "Signed by: waiting for checkout" | "Expires: not yet signed" | "Merchant check: not yet sent" |
| signed | "Signed by {keyid} · {method} {path}" | "Expires in {n} min · nonce never reused" | "Merchant is checking the signature" |
| verified | as signed | as signed | "**Verified by merchant**" |

- The dashed chip "Key directory: mock" is always shown.
- Never write "Visa-verified" (PLAN §1).
- Plain step labels map from `STEP_NAMES`: tag → "Agent known", params → "Details sealed", timestamps → "Not expired", nonce → "Never reused", key → "Key on file", signature → "Signature good".

**CREAO**
- Each run row: "kind · category", a 22-cell track, and a status in mono ("done 0:41", "waits for 4 of 4", "booking 0:03", "stopped").
- Then one log line with the actor in bold, wrapping allowed.
- The track fills only from `creao.run` status and `creao.progress` events.

### 7.3 Empty, missing key and errors (specified; not prototyped)

- **Empty:**
  - the status shows "Waiting for the group.";
  - lanes show four hollow lamps with dashed rails at 40% opacity (the real future shape);
  - the meter reads "Held so far $0", with "of —" until amounts exist;
  - the X-ray shows "Nothing has been read yet.";
  - TAP shows the idle summary.
- **Missing operator key:** one header line in the secondary color, "Read-only. Add the console key to run tests." The live dot is hollow, never red.
- **Stream reconnecting:** the live dot stops pulsing and the label reads "Reconnecting".

### 7.4 Choreography (from real SSE frames)

| Event | Lane | Gate | Background | Status |
|---|---|---|---|---|
| `HELD` | the chip drops in (420ms), the lamp, feed and bus segment turn sodium, the rail fills to Held | meter +share, one more cell | amber ring from that lamp | "k of 4 held." |
| last `HELD` | same | connector goes sodium | same | "Everyone's held. Booking now." The TAP summary moves to signed, then steps tick 250ms apart |
| `CAPTURED` | lanes flip top to bottom 90ms apart: chips, lamps, feeds and rails turn go | meter flips to captured; groups booked +1 | one go band, once | "Everyone's in. Booked." The concierge run starts |
| `DECLINED` | dashed chip, rail kept to Voted, "Declined" end mark | | grey ring | "Name can't make it." |
| `RELEASED` | lanes go dashed 140ms apart; rail kept to Held plus a "Released" end mark; "$0.00 charged" | meter released; holds released +n | grey ring per lane | "Every hold released." Concierge "stopped" |

Under reduced motion every transition is instant and there are no rings. The state, shapes and text are unchanged.

---

## 8. Phone surfaces (390×844, measured)

**Landing `/`** (`shot-mobile.png`)
- Header, then the H1 at `clamp(42px, 12.6vw, 60px)`.
- The ticket:
  - eyebrow and flag;
  - `$` at 46px with the mark 138px tall;
  - "each · fits all 4 budgets…";
  - four seats;
  - the status line.
- Then the perforation and the chat-start stub.
- The **Start in iMessage** bottom edge sits at 810px, above the 844px fold.
- Page `scrollWidth` is 390, so there is no horizontal scroll.
- The tagline and sub are desktop-only. On phones the ticket's own copy carries the message.

**Join `/j/[code]`**
- Paper ground, a sodium ticket, three promises with dot icons.
- The form follows directly, with no pinned gap: label, field, **Join in iMessage**, one legal line plus details.

**Organizer plan-ready.** See section 6.3.

**You're in**
- Ink ground, "You're in, Leo." with a sodium period.
- "3 of 4" in display type (sodium), "in for Dinner + show", four lamps.
- Checklist: Joined (sodium dot check), Budget, What you're into.
- **Open Messages**. The heading takes focus and the region is `aria-live="polite"`.

---

## 9. Accessibility, performance, open checks

- Canvases are `aria-hidden`. Each lane has an sr-only "Maya: HELD, $42.00 held, not charged". The status sentence and the meter are `aria-live="polite"`.
- **Reduced motion:** one still frame (all held). No scramble, rings, dot flaps, or CSS transitions or animations. The console still updates its state.
- **Pause motion** appears on every page with a running canvas.
- **Contrast:** `scripts/contrast-states.mjs` finds 0 failures across 38 pairs, including both console grounds and every chip, outline and lamp. Decorative-only pairs (dim mark edges, ghost dots, the sodium rule on paper) are listed and never carry information alone.
- **Focus:** a 3px `currentColor` outline with 3px offset.
- **Targets:** ≥44px; primary controls are 58px.
- **Performance:**
  - the hero runs one small canvas (the price mark, 30 fps, diff-painted) plus one ring canvas;
  - the console runs one dot field at 24 fps plus redaction bars at 2 Hz.
- **Open, before the demo:**
  1. Real-iPhone Safari timeline, with Low Power Mode on and off.
  2. The one-second "forty-two" read test with 3 people.
  3. **Ink vs paper on the actual venue projector.** Ink is the default; switch with `data-theme="paper"` if blacks wash out.

---

## 10. Anti-AI-look rules (enforce in review)

| Category | Banned |
|---|---|
| Color and effects | purple, indigo or cyan accents; navy-plus-cyan "fintech"; gradients; glows, colored shadows, glassmorphism |
| Type | Inter, Geist, Space Grotesk, Instrument Serif/Sans; serif-italic accent words; all-caps section labels (state tokens excepted) |
| Layout | pill badge above the H1; centered-hero template; **split hero with a right-column ASCII mark** (prized's composition); bento grids; identical icon-topped cards; "Label …… small right label" panel headers; stat banners; "1-2-3" steppers |
| Imagery and icons | Lucide in rounded squares; emoji; ✓/✗ characters; stacked avatars; 3D cards; network logos; Apple iMessage bubbles; dot-grid "launcher" marks |
| Motion | fade-up-on-scroll; shimmer skeletons; "Waiting for events"; confetti; Matrix rain; green digits on black; ambient loops that mean nothing; **fake progress bars**; **color flips under copy** |
| State | red for RELEASED or any money-safe state; strike-through money for a released hold |

Required:
- One saturated field, one ink, one paper, one go.
- Every motion maps to a state. Scramble means private, frozen means held, light means booked, ghost means released.
- The product's own objects carry the design: the ticket, the stub, seat lamps, the gate, the redaction bar.
- Copy never changes ground.
- Sentences beat boxes.

---

## 11. Decisions and evidence

- **Why amber over "Green Light" emerald `#00704A`.**
  - `#00704A` is listed as "Starbucks Green" by brandpalettes.com, brandkit.pro and coloropedia.com.
  - Green tops out near 0.13 chroma where text still holds.
  - Sodium holds ink at 10.69:1 with chroma 0.164.
  - Amber is literally HOLD. Green survives as CAPTURED.
- **Brand proximity**, measured as OKLab distance ×100:

  | Brand color | Distance |
  |---|---|
  | Visa gold `#F7B600` | 2.0 |
  | Binance `#F0B90B` | 3.1 |
  | Bumble `#FFC629` | 4.8 |
  | Mastercard yellow `#F79E1B` | 5.0 |

  Mitigations in v2:
  - no Visa wording on the sodium field;
  - the field's partner is ink, never blue;
  - no network marks;
  - the brand object is the ticket, which Visa doesn't use.

  If the team still wants distance, shift toward `#FFA826` and re-measure Mastercard yellow.
- **Why the ticket.** The critique found the v1 split hero read as prized.dev, and named the ticket as our most ownable form.
  - A ticket is the literal artifact of a plan you hold a seat in.
  - Its stub gives the QR and the start action a reason to exist.
  - Its tear gives capture a physical meaning.
  - The glyph-art technique stays, but as a price printed on our object, not as a floating logo.
- **Why canvas 2D.** It's what prized ships (verified from its production code). There is no WebGL context loss, no dependencies, and a settled frame costs nothing.
- **Tried and changed** (v1 → v2):
  - ten-digit random glyphs broke the outline, so density classes replaced them;
  - the full-field wash broke copy contrast, so capture now lights only the mark;
  - the dot lock read as a building, so it became a solid lock;
  - the 3-blob noise read as mojibake, so it became a fixed-width redaction bar plus words;
  - struck amounts read as void, so released shows "$0.00 charged".

---

## 12. Implementation plan (apps/web, tonight)

### 12.1 Ownership

This plan slots into ux-flow section 10.1. W1 owns `app/page.tsx` and `components/flow/*`, W2 owns `app/j/**` and `app/t/**`, and A1 owns `components/console/OpsBar.tsx` (one button). **Design builders never edit those files.** They ship components that W1 and W2 import.

| Builder | Owns (create or edit) | Must not touch |
|---|---|---|
| **D1: Tokens and brand kit** | `apps/web/app/globals.css`, `apps/web/app/layout.tsx`, `apps/web/app/icon.svg` (new), `apps/web/components/brand/{Wordmark,DotIcon,Ticket,Lamps,ScanCard,FirstText,MotionToggle}.tsx` (new), `apps/web/components/brand/icons.ts` (new), `apps/web/lib/motion/MotionProvider.tsx` (new), `apps/web/components/join/{Shell,ui}.tsx` (restyle; keep `Shell`, `Field`, `inputClass`, `buttonClass`, `secondaryButtonClass`, `Notice`, `Spinner`, `MoneyInput`, `LockIcon` source-compatible) | page files, flow, console |
| **D2: Hero motion** | `apps/web/lib/motion/{glyphField,priceMark,heroScript}.ts` and `{priceMark,heroScript}.test.ts` (new), `apps/web/components/brand/{PriceMark,HoldRings,SignalHero}.tsx` (new) | page files, console, D1's files (import only) |
| **D3: Console** | `apps/web/components/console/{Console,ConsoleHeader,Lanes,Counters,Xray,ConsoleShortlist,TapPanel,CreaoLane,Ledger,ConsoleFooter,Panel}.tsx`, new `apps/web/components/console/{StatusLine,Gate,ConsoleField,RedactBar}.tsx`, new `apps/web/lib/consoleView.ts` and `consoleView.test.ts`, `apps/web/components/console/evidence.test.ts` (update only for renamed copy) | `OpsBar.tsx` (A1), `lib/consoleReducer.ts` (read only; derive in `consoleView.ts`), page files |

`package.json` stays W1's alone: the design work adds **no dependencies**. Fonts come from `next/font/google`, already in Next 16.4.2.

### 12.2 Contracts (D1 publishes these at +0:45 as a short note; D2, D3, W1 and W2 code against them)

```ts
// components/brand/Ticket.tsx  (compound; layout switches by CSS media, not props)
<Ticket torn={boolean} aria-label="…">
  <Ticket.Main>…</Ticket.Main>
  <Ticket.Perf />
  <Ticket.Stub>…</Ticket.Stub>
</Ticket>
<PlanTicket eyebrow title meta filled={k} total={n} />        // the sodium paper-page form (join, organizer)

// components/brand/Lamps.tsx
<Lamp state="VOTED" | "HELD" | "CAPTURED" | "RELEASED" | "DECLINED" />   <Lamps filled={k} total={n} />

// components/brand/DotIcon.tsx
<DotIcon name="chat" | "card" | "check" | "box" | "share" | "wait" | "lock" color?: string />

// components/brand/ScanCard.tsx   (presentational; W1's DesktopScan.tsx passes the server-rendered SVG from lib/qr.ts)
<ScanCard title="Scan to start on your iPhone" svg={string} body="…">{/* <details> number fallback as children */}</ScanCard>

// components/brand/FirstText.tsx
<FirstText text="Hey SquadTab! Help me plan a night out." />

// components/brand/SignalHero.tsx (D2; client)
<SignalHero price={42} seats={["Maya","Leo","Sam","Priya"]} stub={<StartFlow />} />
// W1 renders it from app/page.tsx. `stub` is W1's: PhoneStep on phones, DesktopScan on desktop (platform.ts decides).
```

### 12.3 Token replacement

1. Replace the whole `@theme` block in `globals.css` with section 3.4.
2. Every existing class keeps compiling through the legacy aliases. For example, `bg-surface-2`, `text-muted`, `bg-accent/15` and `text-danger` all map to on-brand values, with no red and no purple.
3. D3 removes alias uses as each console component is rewritten.
4. Delete the aliases only after `rg "(bg|text|border)-(surface|muted|accent|ok|warn|danger|lock|fg|border)" apps/web` is empty. That is not tonight's gate.
5. `layout.tsx`:

```ts
import { Funnel_Display, Funnel_Sans, Martian_Mono } from "next/font/google";
const display = Funnel_Display({ subsets: ["latin"], variable: "--font-funnel-display", display: "swap" });
const sans = Funnel_Sans({ subsets: ["latin"], variable: "--font-funnel-sans", display: "swap" });
const mono = Martian_Mono({ subsets: ["latin"], axes: ["wdth"], variable: "--font-martian-mono", display: "swap" });
// <html className={`${display.variable} ${sans.variable} ${mono.variable}`}>; viewport.themeColor = "#FFB224"
```

D1 checks the exact `next/font` option names with Context7 before writing. Per section 3.3, the families and the `wdth` axis are already confirmed in the installed font data.

### 12.4 Ordered tasks

Times are relative to start. Each task names its owner, and nothing overlaps files.

| # | When | Owner | Task | Done when |
|---|---|---|---|---|
| 1 | 0:00–0:30 | D1 | `globals.css` per 3.4; `layout.tsx` fonts and `themeColor`; `icon.svg` | `pnpm --filter @tab/web typecheck` and `build` pass; the live console re-skins with no red or purple |
| 2 | 0:00–0:45 | D2 | `lib/motion/glyphField.ts` ported from the prototype plus the 4.1 hardening | engine is importable and pauses on `document.hidden` |
| 3 | 0:00–0:45 | D3 | `lib/consoleView.ts`: `statusLine(state)`, `money(state)` (heldCents, chargedCents, totalCents, heldCount, n, mode), `railFor(stage)` (done stations, endmark), `amountFor(lane)`, `proofFor(lane, hasShortlist)`; plus tests | `vitest` passes, covering the RELEASED keeps-Held history and DECLINED keeps Voted |
| 4 | 0:30–0:45 | D1 | **Publish contracts (12.2)** | note sent to D2, D3, W1, W2 |
| 5 | 0:45–1:45 | D1 | `Wordmark`, `icons.ts` and `DotIcon` (lock special case), `Lamps`, `Ticket` (CSS from prototype `.ticket-hero`, `.t-*`, `.ticket`), `ScanCard`, `FirstText`, `MotionToggle` and `MotionProvider` (one context: `paused`, `reduced`) | all render in a scratch story page with no runtime errors |
| 6 | 0:45–2:00 | D2 | `priceMark.ts` (pure: coverage → classes, bevel, regions, radius) and `heroScript.ts` (HCY, `heroAt`, `seatState`, `ticketStatus`), with tests: glyphs never leave their class across 100 ticks; the calm frame is all HELD; cycle B never shows CAPTURED | tests pass |
| 7 | 0:45–2:30 | D3 | `Lanes` rewrite (lamp, who + `RedactBar` + proof, rail, amount, chip, feed); `StatusLine`; `Gate` (title, meter, cells, `Counters` inside); `Console` grid per 7.1 | the console renders real SSE in 16:9 with no clipping at 1280×720 or 1920×1080 |
| 8 | 1:45–3:00 | D2 | `PriceMark.tsx`, `HoldRings.tsx`, `SignalHero.tsx` composing D1's `Ticket` and `Lamps`; `?t=` freeze kept for review | the hero matches `shot-desktop.png` and `shot-mobile.png` |
| 9 | 2:30–3:30 | D3 | `Xray` band ("Locked" string kept for `evidence.test.ts`; Scout preview as "What the group sees"); `TapPanel` summary (keep `TapTestKind`, `STEP_NAMES`, `stepRows`; add `STEP_LABEL`); `CreaoLane` restyle with no fake progress; `Ledger` id as a lane caption; `ConsoleFooter` only with `?ops=1`; `Panel` with no "Waiting for events" | all console tests pass; ✓/✗ characters gone (`rg "[✓✗]" apps/web` is empty) |
| 10 | 2:00–3:00 | W1 / W2 | (their plan) import `SignalHero`, `ScanCard`, `FirstText`, `PlanTicket`, `DotIcon` into `app/page.tsx`, `DesktopScan.tsx`, `ShareInvite.tsx`, `InviteFlow.tsx` | flows match `critique/v2-join.png` |
| 11 | 3:00–3:45 | D3 | `ConsoleField.tsx` (dot lattice and rings driven by lane stage transitions, on D2's engine); `data-theme="paper"` variables | rings fire once per real event; paper passes the 3.2 rules |
| 12 | 3:45–4:30 | D1 (review) | Accessibility pass: reduced motion, Pause motion, focus, sr-only lane text; re-run `scripts/contrast-states.mjs` against final values; screenshot at 390, 1440 and the 16:9 console | no failures; screenshots attached to the integrator |
| 13 | before 09:30 | team | Venue projector: ink vs paper. iPhone Safari timeline. The 3-person "forty-two" test | decision recorded in this doc |

**Integration rule.** The deploy integrator from ux-flow 10.1 merges design PRs after W1's. Any page-file change still needed after that goes through W1 or W2, never through D-builders. Last deploy is 11:30 AM.

### 12.5 Cut line (design)

- **Must ship:**
  - tokens and fonts (task 1): the whole product re-skins with it alone;
  - `Ticket`, `PlanTicket`, `ScanCard` and `FirstText` (the chat-first answers);
  - console lanes, gate, meter, privacy proof and RELEASED language.
- **Ships if green by 09:30:**
  - the animated `PriceMark` and `HoldRings`. If not, ship `PriceMark` as the static calm frame: draw once and never loop. It is the same code path as reduced motion.
- **Nice to have:**
  - `ConsoleField` rings;
  - the paper console variant.
