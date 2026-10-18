// M9: money and privacy copy. Never "$0 instantly", never "Visa-verified agent"; released wording is the approved one.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const app = join(dirname(fileURLToPath(import.meta.url)), "../app");
const src = join(dirname(fileURLToPath(import.meta.url)), "../src");
const walk = (d: string): string[] => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : /\.(tsx?|css)$/.test(n) ? [p] : []; });
const text = [...walk(app), ...walk(src)].map((f) => readFileSync(f, "utf8")).join("\n");

describe("copy lint (M9)", () => {
  it("has no banned phrases", () => {
    expect(text).not.toMatch(/\$0 instantly/i);
    expect(text).not.toMatch(/visa[- ]verified/i);
  });
  it("uses the approved release wording", () => {
    expect(text).toContain("Nobody was charged; your pending authorization was released.");
  });
  it("names no real business on the pay page", () => {
    const pay = walk(join(app, "pay")).map((f) => readFileSync(f, "utf8")).join("\n");
    expect(pay).not.toMatch(/ticketmaster|opentable|resy|yelp|eventbrite/i);
  });
});
