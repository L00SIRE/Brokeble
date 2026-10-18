// M1 + M2: payments and Cybersource credentials live only in apps/venue; agent code reaches money only through VenuePort.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const SKIP = new Set(["node_modules", ".next", "dist", "scratch", "docs", "test", "scripts", ".git"]);

function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    if (SKIP.has(n)) continue;
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|mjs|cjs|js)$/.test(n)) out.push(p);
  }
  return out;
}
const scanDirs = ["apps/agent/src", "apps/web", "apps/venue/src", "apps/venue/app", "packages/shared/src"].map((d) => join(root, d));
const files = scanDirs.flatMap((d) => { try { return walk(d); } catch { return []; } });
const rel = (f: string) => relative(root, f);
const inVenue = (f: string) => rel(f).startsWith("apps/venue/");
const inCybs = (f: string) => rel(f).startsWith("apps/venue/src/cybs/");

describe("secrets layout (M1)", () => {
  it("scans something", () => expect(files.length).toBeGreaterThan(10));
  it("no CYBS_ env access and no Cybersource SDK import outside apps/venue", () => {
    const bad = files.filter((f) => !inVenue(f) && /process\.env\.CYBS_|cybersource-rest-client/.test(readFileSync(f, "utf8")));
    expect(bad.map(rel)).toEqual([]);
  });
});

describe("money paths (M2)", () => {
  it("payment endpoints and SDK calls appear only under apps/venue/src/cybs", () => {
    const re = /\/pts\/v2|capturePayment|authReversal|mitReversal|createPayment/;
    const bad = files.filter((f) => !inCybs(f) && re.test(readFileSync(f, "utf8")));
    expect(bad.map(rel)).toEqual([]);
  });
  it("only the venue's payments module calls the cybs service's money methods", () => {
    const re = /\.(capture|reverse|timeoutReverse)\(/;
    const bad = files.filter((f) => inVenue(f) && !inCybs(f) && re.test(readFileSync(f, "utf8")));
    // orders/*, sweep/* call through cybsService() inside runOp closures; nothing else may
    expect(bad.map(rel).every((f) => /apps\/venue\/src\/(orders|sweep)\//.test(f))).toBe(true);
  });
});
