// Static privacy guards (PLAN §4): P1 (privacy.imports) and P3 (templates.only). Cheap greps that keep ~17 parallel
// builders inside the boundary from the first commit.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("..", import.meta.url));
const SELF = relative(root, fileURLToPath(import.meta.url)).split(sep).join("/");

function files(dir: string): string[] {
  return readdirSync(join(root, dir)).flatMap((name) => {
    const rel = `${dir}/${name}`;
    if (statSync(join(root, rel)).isDirectory()) return files(rel);
    return /\.(ts|tsx|mts)$/.test(name) ? [rel] : [];
  });
}
const sources = ["src", "scripts", "test"].flatMap(files).filter((f) => f !== SELF);

/** PLAN §4 P1 allowlist. */
const P1_ALLOW = (f: string) =>
  f.startsWith("src/delegates/") || ["src/decide/filter.ts", "src/decide/score.ts", "src/money/holdGate.ts", "src/repo/privateConstraints.ts"].includes(f);

describe("P1: budgets are reachable only from the allowlist", () => {
  it("@tab/shared/private is imported only by allowlisted files", () => {
    const offenders = sources.filter((f) => /["']@tab\/shared\/private["']/.test(readFileSync(join(root, f), "utf8")) && !P1_ALLOW(f));
    expect(offenders).toEqual([]);
  });

  it("the SQL table name private_constraints appears only in src/repo/privateConstraints.ts", () => {
    const offenders = sources.filter((f) => readFileSync(join(root, f), "utf8").includes("private_constraints") && f !== "src/repo/privateConstraints.ts");
    expect(offenders).toEqual([]);
  });
});

describe("P3: only notify.ts sends text", () => {
  it(".sendText( is called only in src/notify/notify.ts (src/**)", () => {
    const offenders = sources.filter((f) => f.startsWith("src/") && f !== "src/notify/notify.ts" && /\.sendText\(/.test(readFileSync(join(root, f), "utf8")));
    expect(offenders).toEqual([]);
  });
});
