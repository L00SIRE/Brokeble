// Contrast gate for the shipped tokens: the design-system 9 pair list (scratch/design/scripts/contrast-states.mjs,
// 38 pairs) re-run against the values actually in app/globals.css, plus every ground's remapped legacy aliases.
// WCAG 2.x relative luminance. min 4.5 = text, 3 = large text / UI component (1.4.11).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const css = readFileSync(fileURLToPath(new URL("../../app/globals.css", import.meta.url)), "utf8");

const lin = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
const lum = (hex: string) => {
  const [r, g, b] = rgb(hex).map(lin) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a: string, b: string) => {
  const [hi, lo] = [lum(a), lum(b)].sort((p, q) => q - p) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};

function block(source: string, selector: RegExp): string {
  const m = selector.exec(source);
  if (!m) throw new Error(`block not found: ${selector}`);
  const start = source.indexOf("{", m.index) + 1;
  return source.slice(start, source.indexOf("}", start));
}

function decls(body: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of body.matchAll(/--([\w-]+):\s*([^;]+);/g)) out.set(m[1]!, m[2]!.trim());
  return out;
}

const theme = decls(block(css, /@theme static\s*\{/));
const hexOf = (name: string): string => {
  const v = theme.get(`color-${name}`);
  if (!v || !/^#[0-9a-f]{6}$/i.test(v)) throw new Error(`--color-${name} is not a 6-digit hex: ${v}`);
  return v.toLowerCase();
};

function ground(name: "ink" | "paper" | "sodium"): (token: string) => string {
  const own = decls(block(css, new RegExp(`\\[data-ground="${name}"\\]\\s*\\{`)));
  return (token) => {
    const v = own.get(token) ?? theme.get(token);
    if (!v) throw new Error(`${name}: --${token} undefined`);
    const ref = /^var\(--color-([\w-]+)\)$/.exec(v);
    const hex = ref ? hexOf(ref[1]!) : v.toLowerCase();
    if (!/^#[0-9a-f]{6}$/.test(hex)) throw new Error(`${name}: --${token} unresolved (${v})`);
    return hex;
  };
}

describe("design-system 9 pairs against shipped tokens", () => {
  const t = (n: string) => hexOf(n);
  const white = "#ffffff";
  // Price-mark palette (MARK_FG, prototype). Not tokens; listed so the gate stays one list.
  const mark = { dimEdge: "#5a3e0a", dimCore: "#9c6d12", held: "#ffb224", lit: "#fff3d6", ghost: "#2e2616" };
  const pairs: [string, string, string, number][] = [
    ["Hero H1 / tagline / nav", t("ink"), t("sodium"), 4.5],
    ["Hero sub", t("on-sodium-2"), t("sodium"), 4.5],
    ["Ticket eyebrow, fits, status small", t("night-2"), t("ink"), 4.5],
    ["Ticket seat names, status", t("paper"), t("ink"), 4.5],
    ["Ticket $ / each (sodium type)", t("sodium"), t("ink"), 4.5],
    ["Ticket HELD seat label", t("sodium"), t("ink"), 4.5],
    ["Ticket CAPTURED seat label + Booked flag", t("go"), t("ink"), 4.5],
    ["Ticket captured $ / each (paper)", t("paper"), t("ink"), 4.5],
    ["Stub heading / QR modules", t("ink"), t("paper"), 4.5],
    ["Stub body / kicker", t("on-paper-2"), t("paper"), 4.5],
    ["Field text + 2px border", t("ink"), white, 3],
    ["Placeholder on white field", t("on-paper-2"), white, 4.5],
    ["Primary button label", t("sodium"), t("ink"), 4.5],
    ["First-text rule (decorative)", t("sodium"), t("paper"), 0],
    ["Price mark, dim edge glyph (graphic)", mark.dimEdge, t("ink"), 0],
    ["Price mark, dim core glyph (graphic)", mark.dimCore, t("ink"), 0],
    ["Price mark, held glyph", mark.held, t("ink"), 3],
    ["Price mark, captured glyph", mark.lit, t("ink"), 3],
    ["Price mark, released ghost dot (graphic)", mark.ghost, t("ink"), 0],
    ["Console ink: primary text", t("paper"), t("ink"), 4.5],
    ["Console ink: secondary text", t("night-2"), t("ink"), 4.5],
    ["Console ink: chip / station outline", t("night-2"), t("ink"), 3],
    ["Console ink: HELD chip text", t("ink"), t("sodium"), 4.5],
    ["Console ink: CAPTURED chip text", t("ink"), t("go"), 4.5],
    ["Console ink: captured meter (go text)", t("go"), t("ink"), 4.5],
    ["Console ink: HELD lamp / bus", t("sodium"), t("ink"), 3],
    ["Console ink: CAPTURED lamp / bus", t("go"), t("ink"), 3],
    ["Console ink: idle feed dash", t("night-3"), t("ink"), 3],
    ["Console paper: primary text", t("ink"), t("paper"), 4.5],
    ["Console paper: secondary text", t("on-paper-2"), t("paper"), 4.5],
    ["Console paper: chip / station outline", t("on-paper-2"), t("paper"), 3],
    ["Console paper: captured meter (go-ink text)", t("go-ink"), t("paper"), 4.5],
    ["Console paper: HELD feed / bus line", t("held-line-paper"), t("paper"), 3],
    ["Console paper: CAPTURED feed / bus line", t("go-ink"), t("paper"), 3],
    ["Console paper: HELD lamp edge (ink 2px)", t("ink"), t("paper"), 3],
    ["Ticket (paper page): eyebrow", t("on-sodium-2"), t("sodium"), 4.5],
    ["You're in: 3 of 4 (sodium on ink)", t("sodium"), t("ink"), 4.5],
    ["You're in: secondary", t("night-2"), t("ink"), 4.5],
  ];

  it("has the full 38-pair list", () => expect(pairs).toHaveLength(38));
  it.each(pairs)("%s", (_label, fg, bg, min) => {
    if (min > 0) expect(ratio(fg, bg)).toBeGreaterThanOrEqual(min);
  });
});

describe("ground-relative legacy aliases stay legible", () => {
  for (const name of ["ink", "paper", "sodium"] as const) {
    const g = ground(name);
    const bg = g("color-bg");
    it(`${name}: text tokens reach 4.5:1 on the ground`, () => {
      for (const token of ["color-fg", "color-muted", "color-accent", "color-ok", "color-lock", "color-warn", "color-danger"]) {
        expect(ratio(g(token), bg), `${name} ${token}`).toBeGreaterThanOrEqual(4.5);
      }
    });
    it(`${name}: outlines reach 3:1 and the primary button is legible`, () => {
      expect(ratio(g("color-border"), bg)).toBeGreaterThanOrEqual(3);
      expect(ratio(g("btn-bg"), bg), "button against ground").toBeGreaterThanOrEqual(3);
      expect(ratio(g("btn-fg"), g("btn-bg")), "button label").toBeGreaterThanOrEqual(4.5);
    });
    // The ring is drawn 3px outside the control, so the pixels it changes are the ground's (WCAG 1.4.11). The old
    // currentColor ring on a primary button took --btn-fg, which on ink is the ground itself (1:1).
    it(`${name}: the focus ring (--color-fg) reaches 3:1 on the ground`, () => {
      expect(ratio(g("color-fg"), bg)).toBeGreaterThanOrEqual(3);
    });
    it(`${name}: muted text stays legible on the raised surfaces`, () => {
      expect(ratio(g("color-muted"), g("color-surface"))).toBeGreaterThanOrEqual(4.5);
    });
  }
});

describe("focus ring follows the ground (design-system 9, WCAG 2.4.7 / 1.4.11)", () => {
  it("a ground sets the ring to its contrast color instead of currentColor", () => {
    expect(block(css, /\[data-ground\]\s+:focus-visible\s*\{/)).toMatch(/outline-color:\s*var\(--color-fg\)/);
  });
});

describe("palette rules (design-system 3.1, 10)", () => {
  const hsl = (hex: string) => {
    const [r, g, b] = rgb(hex);
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const d = max - min;
    const l = (max + min) / 2;
    const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
    let h = 0;
    if (d) h = max === r ? 60 * (((g - b) / d) % 6) : max === g ? 60 * ((b - r) / d + 2) : 60 * ((r - g) / d + 4);
    return { h: (h + 360) % 360, s };
  };
  const colors = [...theme].filter(([k, v]) => k.startsWith("color-") && v.startsWith("#"));

  it("defines every token as a hex", () => expect(colors.length).toBeGreaterThanOrEqual(28));
  it.each(colors)("--%s has no red, purple, indigo or cyan", (_k, v) => {
    const { h, s } = hsl(v);
    if (s < 0.25) return; // neutrals
    expect(h >= 345 || h < 20, "red").toBe(false);
    expect(h >= 175 && h < 330, "cyan / blue / indigo / purple").toBe(false);
  });
});
