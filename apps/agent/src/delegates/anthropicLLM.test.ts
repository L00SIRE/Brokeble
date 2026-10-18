// P5/P7 + adapter behavior: no tools/prefill/sampling ever reach the request; every failure maps to low confidence.
import type Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { BallotParse, BudgetParse, Ratings, ScoutSubmission, type DelegateInput, type PublicBundle, type RateCandidate } from "@tab/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EMPTY_PREFERENCES } from "../repo/preferences";
import {
  AnthropicLLM,
  DELEGATE_CALL,
  LOW_BALLOT,
  LOW_BUDGET,
  RATE_CALL,
  REPAIR_CALL,
  setLlmRecorder,
  toPreferences,
  type LlmRequestBody,
} from "./anthropicLLM";
import { BALLOT_SYSTEM, BUDGET_SYSTEM, PREFS_SYSTEM, ballotExtra } from "./prompts";

vi.mock("../decide/ratePrompt", () => ({
  RATE_SYSTEM: "rate-system",
  REPAIR_SYSTEM: "repair-system",
  buildRateUserMessage: (prefs: unknown, candidates: unknown) => JSON.stringify({ preferences: prefs, plans: candidates }),
}));

type Reply = { stop_reason?: string; parsed_output?: unknown } | Error;
function fakeClient(reply: Reply) {
  const parse = vi.fn(async (_body: unknown, _opts: unknown) => {
    if (reply instanceof Error) throw reply;
    return { stop_reason: "end_turn", parsed_output: null, ...reply };
  });
  return { llm: new AnthropicLLM({ messages: { parse } } as unknown as Anthropic), parse };
}

const input = (message_text: string, stage: DelegateInput["stage"] = "budget"): DelegateInput => ({ user_first_name: "Sam", stage, message_text });
const bundle = (index: 1 | 2 | 3): PublicBundle => ({
  id: `bnd_${index}`, index, title: `Dinner at D${index} → Show at S${index}`, dinner_name: `D${index}`, show_name: `S${index}`,
  dinner_time: "18:30", show_start: "20:00", show_end_est: "22:00", all_in_pp_cents: 4599, dietary_fit: [], pitch: "p",
});

afterEach(() => setLlmRecorder(null));

describe("AnthropicLLM request shape (P5)", () => {
  it("sends only model/max_tokens/system/user messages/output_config(effort low) with per-call timeout and retries", async () => {
    const bodies: { method: string; body: LlmRequestBody }[] = [];
    setLlmRecorder((r) => bodies.push(r));
    const { llm, parse } = fakeClient({ parsed_output: { target_pp_cents: 3000, hard_max_pp_cents: 3000, confidence: "high" } });

    await llm.parseBudget(input("30 tops"));

    expect(bodies).toHaveLength(1);
    const { method, body } = bodies[0]!;
    expect(method).toBe("parseBudget");
    expect(Object.keys(body).sort()).toEqual(["max_tokens", "messages", "model", "output_config", "system"]);
    expect(body).toMatchObject({ model: "claude-haiku-5-5", max_tokens: 2048, system: BUDGET_SYSTEM });
    expect(body.messages).toEqual([{ role: "user", content: JSON.stringify(input("30 tops")) }]);
    expect(body.output_config.effort).toBe("low");
    expect((body.output_config.format as { type: string }).type).toBe("json_schema");
    for (const k of ["tools", "tool_choice", "thinking", "temperature", "top_p", "top_k"]) expect(body).not.toHaveProperty(k);
    expect(parse).toHaveBeenCalledWith(body, { timeout: DELEGATE_CALL.timeoutMs, maxRetries: DELEGATE_CALL.maxRetries });
  });

  it("every shared output schema converts to a structured-output format", () => {
    for (const s of [BudgetParse, BallotParse, Ratings, ScoutSubmission]) expect(() => zodOutputFormat(s)).not.toThrow();
  });

  it("ballot content is the public shortlist then the person's own input; the system prompt carries no request data", async () => {
    const bodies: LlmRequestBody[] = [];
    setLlmRecorder((r) => bodies.push(r.body));
    const { llm } = fakeClient({ parsed_output: null });
    await llm.parseBallot(input("1 or 3", "ballot"), [bundle(1), bundle(2)]);
    expect(bodies[0]!.system).toBe(BALLOT_SYSTEM);
    expect(bodies[0]!.messages[0]!.content).toBe(`${ballotExtra([bundle(1), bundle(2)])}\n\n${JSON.stringify(input("1 or 3", "ballot"))}`);
  });

  it("rate and repair use B's prompts with their own call settings", async () => {
    const bodies: { method: string; body: LlmRequestBody }[] = [];
    setLlmRecorder((r) => bodies.push(r));
    const { llm, parse } = fakeClient({ parsed_output: { ratings: [{ index: 1, score: 0.7 }] } });
    const cand: RateCandidate = { ...bundle(1), index: 1 };
    expect(await llm.rateBundles(EMPTY_PREFERENCES, [cand])).toEqual({ ratings: [{ index: 1, score: 0.7 }] });
    await llm.repairScoutJson("{oops", "show");
    expect(bodies.map((b) => [b.method, b.body.model, b.body.max_tokens, b.body.system])).toEqual([
      ["rateBundles", RATE_CALL.model, RATE_CALL.maxTokens, "rate-system"],
      ["repairScoutJson", REPAIR_CALL.model, REPAIR_CALL.maxTokens, "repair-system"],
    ]);
    expect(bodies[1]!.body.messages[0]!.content).toBe("Category: show\n\n{oops");
    expect(parse.mock.calls[0]![1]).toEqual({ timeout: 30_000, maxRetries: 2 });
    expect(parse.mock.calls[1]![1]).toEqual({ timeout: 30_000, maxRetries: 2 });
  });

  it("rateBundles with no candidates makes no call", async () => {
    const { llm, parse } = fakeClient({ parsed_output: null });
    expect(await llm.rateBundles(EMPTY_PREFERENCES, [])).toEqual({ ratings: [] });
    expect(parse).not.toHaveBeenCalled();
  });
});

describe("AnthropicLLM low-confidence mapping", () => {
  const failures: [string, Reply][] = [
    ["throw (API or client-side validation)", new Error("Failed to parse structured output: 4500")],
    ["refusal", { stop_reason: "refusal", parsed_output: { target_pp_cents: 1, hard_max_pp_cents: null, confidence: "high" } }],
    ["max_tokens", { stop_reason: "max_tokens" }],
    ["null parsed_output", { parsed_output: null }],
  ];
  it.each(failures)("%s → low values, never throws", async (_n, reply) => {
    const { llm } = fakeClient(reply);
    expect(await llm.parseBudget(input("x"))).toEqual(LOW_BUDGET);
    expect(await llm.parsePreferences(input("x", "prefs"))).toEqual(EMPTY_PREFERENCES);
    expect(await llm.parseBallot(input("x", "ballot"), [bundle(1)])).toEqual(LOW_BALLOT);
    expect(await llm.rateBundles(EMPTY_PREFERENCES, [{ ...bundle(1), index: 1 }])).toEqual({ ratings: [] });
    expect(await llm.repairScoutJson("x", "dinner")).toBeNull();
  });

  it("drops ballot plan numbers that are not on the shortlist", async () => {
    const { llm } = fakeClient({
      parsed_output: { approvals: [1, 3, 3], constraints: [{ kind: "exclude", index: 3 }, { kind: "end_before", time: "22:00" }], none_of_these: false, intent: "ballot", confidence: "high" },
    });
    const p = await llm.parseBallot(input("1 or 3", "ballot"), [bundle(1), bundle(2)]);
    expect(p.approvals).toEqual([1]);
    expect(p.constraints).toEqual([{ kind: "end_before", time: "22:00" }]);
  });
});

describe("toPreferences", () => {
  it("never stores a money mention as a preference (P1 backstop)", () => {
    const p = toPreferences({
      cuisines_like: ["sushi", "cheap eats", "$$ steak"], cuisines_avoid: ["anything over 40"], dietary: [], vibe: [],
      earliest_start: null, latest_end: null, dealbreakers: ["nothing over $40", "no loud bars", "budget under 50", "30 pp max", "done by 10"],
    });
    expect(p.cuisines_like).toEqual(["sushi"]);
    expect(p.cuisines_avoid).toEqual([]);
    expect(p.dealbreakers).toEqual(["no loud bars", "done by 10"]);
  });

  it("clamps lists, dedupes, and keeps only valid HH:MM", () => {
    expect(
      toPreferences({
        cuisines_like: ["thai", "thai", " sushi ", "a", "b", "c", "d"], cuisines_avoid: [], dietary: ["vegetarian", "vegetarian"],
        vibe: ["casual", "lively", "quiet", "trendy"], earliest_start: "6:30", latest_end: "10pm", dealbreakers: ["x", "y", "z", "w", ""],
      }),
    ).toEqual({
      cuisines_like: ["thai", "sushi", "a", "b", "c"], cuisines_avoid: [], dietary: ["vegetarian"], vibe: ["casual", "lively", "quiet"],
      earliest_start: "06:30", latest_end: null, dealbreakers: ["x", "y", "z"],
    });
  });

  it("returns prefs the strict shared schema accepts", async () => {
    const { llm } = fakeClient({
      parsed_output: { cuisines_like: ["italian"], cuisines_avoid: [], dietary: ["vegan"], vibe: [], earliest_start: null, latest_end: "22:00", dealbreakers: [] },
    });
    const p = await llm.parsePreferences(input("vegan, italian, home by 10", "prefs"));
    expect(p.latest_end).toBe("22:00");
    expect(p.dietary).toEqual(["vegan"]);
    expect(PREFS_SYSTEM).not.toMatch(/\$\{/);
  });
});
