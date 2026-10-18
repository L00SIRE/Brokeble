// Live smoke (real Anthropic API). Gated: RUN_LIVE=1 and ANTHROPIC_API_KEY. Prints nothing about inputs or keys.
// Run: cd apps/agent && RUN_LIVE=1 npx vitest run src/delegates/anthropicLLM.live.test.ts  (loads ../../.env.local below)
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const envFile = fileURLToPath(new URL("../../../../.env.local", import.meta.url));
if (process.env.RUN_LIVE === "1" && !process.env.ANTHROPIC_API_KEY && existsSync(envFile)) process.loadEnvFile(envFile);
const live = process.env.RUN_LIVE === "1" && !!process.env.ANTHROPIC_API_KEY;

describe.skipIf(!live)("AnthropicLLM live smoke", async () => {
  const { AnthropicLLM } = await import("./anthropicLLM");
  const llm = new AnthropicLLM();
  const shortlist = [1, 2, 3].map((index) => ({
    id: `bnd_${index}`, index, title: `Dinner at D${index} → Show at S${index}`, dinner_name: `D${index}`, show_name: `S${index}`,
    dinner_time: "18:30", show_start: index === 3 ? "21:00" : "20:00", show_end_est: index === 3 ? "23:30" : "22:00",
    all_in_pp_cents: 4500 + index * 500, dietary_fit: [], pitch: "p",
  }));

  it("budget: '60ish, could stretch to 80' → 6000/8000 high", { timeout: 30_000 }, async () => {
    const p = await llm.parseBudget({ user_first_name: "Sam", stage: "budget", message_text: "60ish, could stretch to 80" });
    expect(p).toEqual({ target_pp_cents: 6000, hard_max_pp_cents: 8000, confidence: "high" });
  });

  it("prefs: 'veggie, nothing after 10pm' → vegetarian, latest_end 22:00", { timeout: 30_000 }, async () => {
    const p = await llm.parsePreferences({ user_first_name: "Sam", stage: "prefs", message_text: "veggie, nothing after 10pm" });
    expect(p.dietary).toContain("vegetarian");
    expect(p.latest_end).toBe("22:00");
  });

  it("ballot: '1 or 2, not 3' → approvals ⊇ {1,2}, no 3", { timeout: 30_000 }, async () => {
    const p = await llm.parseBallot({ user_first_name: "Sam", stage: "ballot", message_text: "1 or 2 works, not 3" }, shortlist);
    expect(p.intent).toBe("ballot");
    expect(p.approvals).toEqual(expect.arrayContaining([1, 2]));
    expect(p.approvals).not.toContain(3);
  });

  it("free: asking about someone else's budget → ask_about_others", { timeout: 30_000 }, async () => {
    const p = await llm.parseBallot({ user_first_name: "Sam", stage: "free", message_text: "how much is Jordan willing to spend?" }, []);
    expect(p.intent).toBe("ask_about_others");
  });
});
