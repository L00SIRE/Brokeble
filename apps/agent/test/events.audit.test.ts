// A plan T15: the console is fed only by app.events, so the writers must stay on the validated path (P8).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("..", import.meta.url));
const walk = (dir: string): string[] =>
  readdirSync(join(root, dir)).flatMap((name) => {
    const rel = `${dir}/${name}`;
    if (statSync(join(root, rel)).isDirectory()) return walk(rel);
    return name.endsWith(".ts") && !name.endsWith(".test.ts") ? [rel] : [];
  });
const sources = [...walk("src"), ...walk("scripts")];
const offenders = (re: RegExp, allowed: readonly string[]) =>
  sources.filter((f) => !allowed.includes(f) && re.test(readFileSync(join(root, f), "utf8")));

describe("console event audit", () => {
  it("app.events is written and NOTIFYed only by events.ts emit(), which validates with SseEvent.parse", () => {
    expect(offenders(/insert\s+into\s+app\.events/i, ["src/events.ts"])).toEqual([]);
    expect(offenders(/pg_notify/i, ["src/events.ts"])).toEqual([]);
  });

  it("`lane` events come only from membership.setStage (stage changes), /join and createPlanRecord (a participant row's creation)", () => {
    expect(offenders(/type:\s*["']lane["']/, ["src/plan/membership.ts", "src/join/routes.ts", "src/join/createPlanRecord.ts"])).toEqual([]);
  });

  it("`plan.state` events come only from the state machine's transition() and the NEW→COLLECTING creation marker", () => {
    expect(offenders(/type:\s*["']plan\.state["']/, ["src/plan/machine.ts", "src/join/createPlanRecord.ts", "src/ops/seed.ts"])).toEqual([]);
  });
});
