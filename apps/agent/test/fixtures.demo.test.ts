// A's demo fixtures validate against the seed contracts and carry no PII (phones live only in env DEMO_TEAM).
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { DemoScript, DemoSeed, demoScriptPath, demoSeedPath } from "../src/ops/seed";

describe("fixtures/demo-*.json", () => {
  it("demo-seed.json matches DemoSeed and every hard max is ≥ its target", async () => {
    const seed = DemoSeed.parse(JSON.parse(await readFile(demoSeedPath, "utf8")));
    for (const m of seed.members) if (m.hard_max_pp_cents !== null) expect(m.hard_max_pp_cents).toBeGreaterThanOrEqual(m.target_pp_cents);
    expect(seed.members.length).toBeLessThan(seed.plan.party_target); // room for the judge to join
  });

  it("demo-script.json matches DemoScript and only references seeded lanes", async () => {
    const seed = DemoSeed.parse(JSON.parse(await readFile(demoSeedPath, "utf8")));
    const script = DemoScript.parse(JSON.parse(await readFile(demoScriptPath, "utf8")));
    for (const s of script.steps) expect(s.lane).toBeLessThanOrEqual(seed.members.length);
  });

  it("contain no phone numbers", async () => {
    for (const p of [demoSeedPath, demoScriptPath]) expect(await readFile(p, "utf8")).not.toMatch(/\+?\d[\d\s().-]{9,}\d/);
  });
});
