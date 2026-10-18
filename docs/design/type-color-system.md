# SquadTab type and colour system

**Recommendation: "Green Light".** It uses an emerald brand field (`#00704A`) with cream ink, warm paper surfaces, brass for HELD, emerald for CAPTURED, dashed slate for RELEASED, oxblood for errors and ink redaction bars for private data. The type is Funnel Display and Funnel Sans, with Martian Mono for data and Doto for the signature dot-matrix digits.

- Drop-in tokens: `docs/design/theme.css`, which replaces `apps/web/app/globals.css`. It compiles with the repo's Tailwind 4.3.3 against every class the app uses today (`scratch/design/scripts/compile-check.mjs`).
- Proofs: `scratch/design/contrast-report.md` (246 pairs, 0 failures), produced by `scratch/design/scripts/contrast.mjs`.
- Visual specimen: `scratch/design/specimen.html`, with screenshots `specimen-full.png` and `specimen-mobile.png`.

## 1. Why this field colour

The brand needs one saturated field it owns, the way prized.dev owns its blue. Three tests decided it:

1. **It must not be another payment brand's colour, especially on the Visa track.** `scratch/design/scripts/brandprox.mjs` measures each candidate's distance (OKLab dE x100) from Visa, Mastercard, Amex, PayPal, Venmo, Cash App, Stripe, Klarna, Zelle, Splitwise, Wise, iMessage and prized.

| field | nearest owned colour | dE | verdict |
|---|---|---|---|
| Persimmon `#FF5A1F` | Mastercard orange `#FF5F00` | **1.5** | reads as Mastercard; rejected |
| Cobalt `#2449D8` | prized blue `#0047D8` | **1.9** | copies the reference; rejected |
| Saffron `#FFC21A` | Visa gold | 2.7 | rejected |
| Chartreuse `#D4F23A` | Wise lime | 7.7 | too close |
| Watermelon `#FF4F79` | Mastercard orange | 11.2 | viable, but in Mastercard's warm family, and "in the red" is the wrong idea for money |
| **Emerald `#00704A`** | Wise forest | **20.1** | clearly ours |
| Oxblood `#6E0F25` | Wise forest | 19.5 | ours, but reads red (debt/error) |

The whole saturated red-orange-yellow band belongs to Mastercard. Hex values for other brands come from third-party brand-colour sites and are approximate.

2. **It must mean the product.** Green is "in the green", the green light and money. In SquadTab, CAPTURED is the moment everyone's in, and that is exactly when the brand colour shows up on a lane. The console starts neutral (paper) and earns its emerald. That gives the demo a story without a voiceover.

3. **It must hold text.** Cream on emerald is 5.32:1 (AA for body text). sRGB green cannot reach prized's chroma: about 0.13 at this lightness, against blue's 0.22. So the "electric" energy comes from the motion layer (cream dot grid and Doto digits), not from neon saturation. Mid-light greens like `#009767` fail for both cream and ink text, so the field stays at L 48%.

## 2. Type

| role | family | why it fits SquadTab | measured |
|---|---|---|---|
| Display | **Funnel Display** 600-800 (Google Fonts, OFL) | Its terminals are cut like funnels, an apt image for many budgets pouring into one tab. It avoids the faces generated sites default to (Inter, Geist, Space Grotesk, Bricolage, Instrument Serif). **Digits are tabular by default**, unusual for a display face, so animated totals don't jitter. | cap 0.675, x 0.50 |
| Text / UI | **Funnel Sans** 400/600 | Same skeleton as the display face, so the system feels authored rather than assembled. Its x-height is lower than Inter's (0.50 vs 0.546), so body text is set at **17px** to compensate (16 x 0.546 / 0.50 ≈ 17.5). | cap 0.675, x 0.50 |
| Data / states / signed requests | **Martian Mono** 500-700, `wdth` 75-112.5 | It has the **largest glyphs per pixel of every candidate tested** (cap 0.80 and x 0.60, against 0.73 and 0.55 for JetBrains Mono, which prized uses, and 0.73 and 0.55 for Inter). That matters most at 5 m. The width axis lets the console condense long TAP signatures without shrinking them. | cap 0.80, x 0.60 |
| Signature digits | **Doto** 800, `ROND` 100 | A variable dot-matrix face. It is our answer to prized's ASCII digits: receipt-printer and LED-ticker numerals for the tab total and the counters, and it rhymes with the dot-grid field. **Display only, at 48px or larger.** | cap 0.70 |

Fallback note: Martian Mono has no slashed zero (no `zero` feature), so `0` and `O` differ only by width. Keep hex and signature strings to lowercase hex, which uses no capital `O`. None of the families has ✓ or ✗ glyphs (TapPanel uses them), so use SVG icons instead of falling back to system glyphs.

### next/font (apps/web/app/layout.tsx)

All four families and their axes are present in the installed Next 16.4.2 font manifest.

```tsx
import { Doto, Funnel_Display, Funnel_Sans, Martian_Mono } from "next/font/google";

const display = Funnel_Display({ subsets: ["latin"], variable: "--font-funnel-display", display: "swap" });
const sans = Funnel_Sans({ subsets: ["latin"], variable: "--font-funnel-sans", display: "swap" });
const mono = Martian_Mono({ subsets: ["latin"], axes: ["wdth"], variable: "--font-martian-mono", display: "swap" });
const dot = Doto({ subsets: ["latin"], axes: ["ROND"], variable: "--font-doto", display: "swap" });

// <html lang="en" className={`${display.variable} ${sans.variable} ${mono.variable} ${dot.variable}`}>
// viewport.themeColor: "#00704A" (Safari/Chrome toolbar picks up the brand field on mobile)
```

## 3. Palette (Green Light)

| role | Paper (light, default) | Booth (dark) |
|---|---|---|
| field / field-ink | `#00704A` `oklch(48.2% 0.107 161.2)` / `#F4EEE2` | same |
| bg / surface / surface-2 | `#F4EEE2` / `#FBF7EF` / `#EAE2D2` | `#0E1411` / `#151D19` / `#1D2722` |
| line / line-strong | `#D9CEBB` (decorative) / `#8C7F69` (controls) | `#2C3A33` / `#6E8378` |
| ink / muted / faint | `#131A16` / `#545A52` / `#767A70` | `#F1EDE3` / `#A9B3AA` / `#87938B` |
| brand (as text) | `#005C3D` | `#5BE0A0` |
| HELD text / fill / on | `#7A5200` / `#E8AE2E` / `#1E1400` | `#EDB84A` / `#EDB84A` / `#1E1400` |
| CAPTURED text / fill / on | `#066E43` / `#00704A` / `#F4EEE2` | `#5BE0A0` / `#00704A` / `#F4EEE2` |
| RELEASED text / fill / on | `#56606B` / `#E4E0D8` / `#3F4650` | `#A9B1BB` / `#2A332E` / `#D8DDE3` |
| danger (DECLINED, errors) | `#7A0C2C` | `#F5607F` |
| private (redaction bar) | `#131A16` | `#ECE7DC` |

OKLCH for every value is in `contrast-report.md`.

**Why each state colour:**

- **HELD = brass.** Money set aside on the table but not moved. It is also the amber of a traffic light ("wait").
- **CAPTURED = emerald**, the brand field: the colour is earned when everyone's in.
- **RELEASED = slate, drawn dashed or outlined.** Releasing a hold is a *safe* outcome (nobody is out of pocket), so it must not look like a warning. The current code paints RELEASED with `text-warn` (amber), which says the opposite.
- **Danger = oxblood.** It is the only red, kept dark so it never competes with the brand.
- **Private = a redaction bar.** "Tells no one" shown as a censored document, not a purple lock.

### Contrast results (WCAG 2.2, plus APCA Lc for reference)

| pair (worst case across bg / surface / surface-2) | Paper | Booth |
|---|---|---|
| ink | 13.74 | 13.15 |
| muted | 5.51 | 7.11 |
| brand text | 6.28 | 9.24 |
| HELD / CAPTURED / RELEASED / danger text | 5.37 / 4.91 / 4.97 / 8.51 | 8.46 / 9.24 / 7.10 / 5.03 |
| on-fill chips HELD / CAPTURED / RELEASED | 9.11 / 5.32 / 7.24 | 10.00 / 5.32 / 9.54 |
| state text on its own 14% tint | 4.83-7.84 | 4.72-7.60 |
| line-strong (control boundary, 1.4.11) | 3.05+ | 3.79+ |
| cream on field | 5.32 | 5.32 |

**Colour-vision check.** The script applies Machado 2009 simulation and takes the closest pair among the four states:

| vision | Paper | Booth |
|---|---|---|
| Normal | 11.3 | 16.3 |
| Protanopia | 6.9 | 10.5 |
| Deuteranopia | 5.7 | 8.5 |
| Tritanopia | 6.6 | 13.3 |

Paper-mode state colours are all forced into mid-dark tones to pass 4.5:1, which compresses hue. So **the states are also encoded by shape** (required by WCAG 1.4.1, and it reads better at 5 m):

- HELD = solid brass chip
- CAPTURED = solid emerald chip
- RELEASED = dashed outline with the amount struck through
- DECLINED = oxblood text with an icon

An earlier oxblood choice also came out of this check: a brighter red (`#A1123F`) collapsed into CAPTURED green under deuteranopia (dE 1.6).

## 4. Console from 5 m

`scratch/design/scripts/legibility.mjs` converts visual angle to CSS px using each font's measured cap height (output in `scratch/design/legibility-5m.md`). Character heights of 16' minimum and 20-22' preferred are commonly cited from ANSI/HFES 100-2007. I could not check the normative text, which is no longer maintained as an ANSI standard, so treat those figures as the industry rule of thumb.

| token | value (at 1080p) | font | purpose | 100" screen at 5 m | 65" TV at 5 m |
|---|---|---|---|---|---|
| `text-console-detail` | 1.8vh ≈ 19px | Mono | signature hex, timestamps (decorative at 5 m) | 12' | 8' |
| `text-console-label` | 2.4vh ≈ 26px | Mono caps | panel labels | 16' | 11' |
| `text-console-body` | 3.4vh ≈ 37px | Funnel Sans | names, shortlist items | 20' | 13' |
| `text-console-state` | 4.4vh ≈ 48px | Mono 700 | HELD / CAPTURED words | 30' | 20' |
| `text-console-key` | 5vh ≈ 54px | Mono / Display | amounts, counts | 34' / 29' | 22' / 19' |
| `text-console-hero` | 10vh ≈ 108px | Doto | tab total, $0-fronted counter | 60' | 39' |

The current console uses 18px labels and 22px body text, roughly 10' and 12' on a 100" screen: too small.

Sizes use `min(vh, vw·9/16)`, so they follow whichever dimension limits the screen, with rem floors for laptop previews. The design rule that follows: **anything a judge must read from the back is state, amount, name, or a counter, set at body size or larger.** Everything at detail size is atmosphere.

**Console polarity: Paper (light) by default, Booth on demand** (`data-theme="booth"`).

- Positive polarity (dark on light) gave better acuity and proofreading in both younger and older adults (Piepenbrock et al., *Ergonomics* 56(7), 2013).
- The advantage is attributed to higher display luminance (Buchner, Mayr and Brandt, 2009), which also survives a lit judging hall better than a black screen washed to grey.
- Under a lit-room projector model (+10% white flare), ink on paper keeps 5.7-6.8:1 and muted 3.7-4.4:1, depending on the surface. So the console never uses `faint` for anything required, and uses `muted` only at label size or larger.
- The emerald header band carries the brand and the live Doto total in both themes.
- Choose Booth for a dark room or an OLED TV.

## 5. Applying it (for the build step)

1. Replace `apps/web/app/globals.css` with `docs/design/theme.css` and add the next/font block.
2. The legacy names (`fg`, `border`, `accent`, `ok`, `lock`) are aliased so everything still compiles. `accent` maps to `held`, which is right for the console's in-progress uses. Three semantic fixes still need class changes:
   - `components/console/Lanes.tsx`: HELD uses `bg-accent/15 text-accent`. Make it a solid `bg-held-fill text-on-held` chip, CAPTURED `bg-captured-fill text-on-captured`, and RELEASED `border-2 border-dashed border-released text-released`.
   - `components/console/Ledger.tsx`: `RELEASED: "text-warn"` should be `text-released`, and `AUTHORIZED` should be `text-held`.
   - `components/console/Counters.tsx`: "holds released" uses `text-warn`; make it `text-released`.
3. Join and landing primary buttons: `bg-field text-field-ink` on paper, or `bg-field-ink text-field` on the field.
4. Focus rings: `outline-focus` (ink on paper, cream on booth and on the field).
5. Doto only through `font-dot`, which applies `ROND 100`, and only at `text-console-key` size or larger.

## 6. Rejected systems (full numbers in contrast-report.md)

- **B. Persimmon Tab.** The warmest and most "dinner with friends" option, and AA throughout, but dE 1.5 from Mastercard orange. On the Visa track that is disqualifying. If a warm direction is wanted later, Watermelon `#FF4F79` is the nearest viable shift.
- **C. Afterhours Aubergine.** Dark purple with apricot is the stereotype of AI-generated UI, and HELD and danger collapse under deuteranopia (dE 0.8).
