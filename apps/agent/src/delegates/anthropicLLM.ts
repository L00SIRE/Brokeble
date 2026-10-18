// LLM_MODE=anthropic: the ONE Anthropic adapter (standard-names "Anthropic"). The Integrate stage repoints
// ports/index.ts here. Owner A; B owns the rate/repair prompts (src/decide/ratePrompt.ts), A only sends them.
// Every request: client.messages.parse(body, { timeout, maxRetries }) with output_config { format: zodOutputFormat(S),
// effort: "low" }. NEVER tools, tool_choice, assistant prefill, thinking, temperature, top_p or top_k (P5).
// Low confidence = a throw, a null parsed_output, or stop_reason "refusal" | "max_tokens".
// Verified against the installed @anthropic-ai/sdk@0.135.0: messages.parse(params, RequestOptions{timeout ms, maxRetries}),
// OutputConfig {effort, format}, helpers/zod zodOutputFormat (drops unsupported JSON-schema keywords, re-validates with
// zod client-side and throws AnthropicError on mismatch), ParsedMessage.parsed_output, StopReason "refusal".
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import {
  BallotParse,
  BudgetParse,
  DietaryTag,
  HHMM,
  Ratings,
  ScoutSubmission,
  Vibe,
  type DelegateInput,
  type Preferences,
  type PublicBundle,
  type RateCandidate,
} from "@tab/shared";
import * as z from "zod";
import { buildRateUserMessage, RATE_SYSTEM, REPAIR_SYSTEM } from "../decide/ratePrompt";
import { log } from "../log";
import type { LLMPort } from "../ports";
import { EMPTY_PREFERENCES } from "../repo/preferences";
import { ConverseResult, type ConverseInput, type DelegateConverser } from "./converseSchema";
import { PlanDraftParse, parsePlanDraftText, type PlanDraftInput } from "./planDraft";
import { BALLOT_SYSTEM, BUDGET_SYSTEM, CONVERSE_SYSTEM, PLAN_DRAFT_SYSTEM, PREFS_SYSTEM, ballotExtra } from "./prompts";

export type LlmModel = "claude-haiku-5-5" | "claude-sonnet-5-5";
export type LlmCallOptions = { model: LlmModel; maxTokens: number; timeoutMs: number; maxRetries: number };

/** Delegate parses (budget, prefs, ballot): worst case ~20 s, inside the consumer's 45 s per-event timeout. */
export const DELEGATE_CALL: LlmCallOptions = { model: "claude-haiku-5-5", maxTokens: 2048, timeoutMs: 10_000, maxRetries: 1 };
/** Conversational delegate reply: short text, so a tighter budget and timeout (the T_HELP fallback covers a miss). */
export const CONVERSE_CALL: LlmCallOptions = { model: "claude-haiku-5-5", maxTokens: 1024, timeoutMs: 8_000, maxRetries: 1 };
/** rateBundles (standard-names call settings). */
export const RATE_CALL: LlmCallOptions = { model: "claude-sonnet-5-5", maxTokens: 4096, timeoutMs: 30_000, maxRetries: 2 };
/** repairScoutJson (standard-names call settings). */
export const REPAIR_CALL: LlmCallOptions = { model: "claude-haiku-5-5", maxTokens: 12_000, timeoutMs: 30_000, maxRetries: 2 };

/** The exact request body sent (minus the SDK's parse helper internals); what P5/P7 tests inspect. */
export type LlmRequestBody = {
  model: LlmModel;
  max_tokens: number;
  system: string;
  messages: { role: "user"; content: string }[];
  output_config: { format: unknown; effort: "low" };
};
export type LlmMethod = keyof LLMPort | keyof DelegateConverser;
export type LlmRecorder = (r: { method: LlmMethod; body: LlmRequestBody }) => void;

let recorder: LlmRecorder | null = null;

/** Test hook (P5/P7): receives every request body before it is sent. Pass null to clear. */
export function setLlmRecorder(fn: LlmRecorder | null): void {
  recorder = fn;
}

export const LOW_BUDGET: BudgetParse = { target_pp_cents: 0, hard_max_pp_cents: null, confidence: "low" };
export const LOW_BALLOT: BallotParse = { approvals: [], constraints: [], none_of_these: false, intent: "other", confidence: "low" };

// LLM-facing prefs schema: array caps and the HH:MM pattern are not enforceable in the JSON schema the API receives, so a
// 6th cuisine or "10pm" would fail the strict client-side re-validation and lose the whole parse. Accept loosely, then
// clamp/validate in code into the strict shared Preferences.
const PrefsLoose = z.strictObject({
  cuisines_like: z.array(z.string()),
  cuisines_avoid: z.array(z.string()),
  dietary: z.array(DietaryTag),
  vibe: z.array(Vibe),
  earliest_start: z.string().nullable(),
  latest_end: z.string().nullable(),
  dealbreakers: z.array(z.string()),
});

const hhmmOrNull = (s: string | null): string | null => {
  const t = s?.trim() ?? null;
  if (t === null) return null;
  const padded = /^\d:\d\d$/.test(t) ? `0${t}` : t;
  return HHMM.safeParse(padded).success ? padded : null;
};
// P1 backstop: only the private constraints store may hold a budget, so a money mention ("nothing over $40") must never be stored
// as a cuisine or dealbreaker even if the model ignores PREFS_SYSTEM. Dropping a real preference is the safe failure.
const MONEY_MENTION =
  /[$€£¢]|\b(?:budget|afford\w*|spend\w*|price\w*|cost\w*|bucks?|dollars?|usd|money|cheap\w*|expensive|pricey)\b|\b(?:under|over|below|above|max|tops|less than|more than)\s*\d|\d+\s*(?:pp|per person|a head|each)\b/i;
const clean = (xs: readonly string[], n: number, max = 60): string[] =>
  [...new Set(xs.map((x) => x.trim().slice(0, max)).filter((x) => x && !MONEY_MENTION.test(x)))].slice(0, n);

export function toPreferences(p: z.infer<typeof PrefsLoose>): Preferences {
  return {
    cuisines_like: clean(p.cuisines_like, 5),
    cuisines_avoid: clean(p.cuisines_avoid, 5),
    dietary: [...new Set(p.dietary)],
    vibe: [...new Set(p.vibe)].slice(0, 3),
    earliest_start: hhmmOrNull(p.earliest_start),
    latest_end: hhmmOrNull(p.latest_end),
    dealbreakers: clean(p.dealbreakers, 3, 80),
  };
}

export class AnthropicLLM implements LLMPort, DelegateConverser {
  #client: Anthropic | undefined;

  /** `client` defaults to `new Anthropic()` (reads ANTHROPIC_API_KEY), created lazily on first call. */
  constructor(client?: Anthropic) {
    this.#client = client;
  }

  get client(): Anthropic {
    return (this.#client ??= new Anthropic());
  }

  /** One structured call with the rules above; resolves to the parsed value or null (low confidence). Never throws. */
  async structuredParse<T>(method: LlmMethod, schema: z.ZodType<T>, system: string, userContent: string, o: LlmCallOptions): Promise<T | null> {
    try {
      const body = {
        model: o.model,
        max_tokens: o.maxTokens,
        system,
        messages: [{ role: "user" as const, content: userContent }],
        output_config: { format: zodOutputFormat(schema), effort: "low" as const },
      };
      recorder?.({ method, body });
      const r = await this.client.messages.parse(body, { timeout: o.timeoutMs, maxRetries: o.maxRetries });
      if (r.stop_reason === "refusal" || r.stop_reason === "max_tokens") {
        log.warn({ method, stop_reason: r.stop_reason }, "llm low confidence");
        return null;
      }
      return (r.parsed_output as T | null) ?? null;
    } catch (e) {
      // Never log e.message: a structured-output validation error quotes the model's output (which can echo a budget).
      log.warn({ method, err: e instanceof Error ? e.name : "unknown", status: e instanceof Anthropic.APIError ? e.status : undefined }, "llm call failed");
      return null;
    }
  }

  /** BUDGET_SYSTEM over JSON(DelegateInput). Null → {target_pp_cents:0, hard_max_pp_cents:null, confidence:"low"}. */
  async parseBudget(i: DelegateInput): Promise<BudgetParse> {
    return (await this.structuredParse("parseBudget", BudgetParse, BUDGET_SYSTEM, JSON.stringify(i), DELEGATE_CALL)) ?? LOW_BUDGET;
  }

  /** PREFS_SYSTEM over JSON(DelegateInput). Null → EMPTY_PREFERENCES (repo/preferences). */
  async parsePreferences(i: DelegateInput): Promise<Preferences> {
    const p = await this.structuredParse("parsePreferences", PrefsLoose, PREFS_SYSTEM, JSON.stringify(i), DELEGATE_CALL);
    return p ? toPreferences(p) : EMPTY_PREFERENCES;
  }

  /** BALLOT_SYSTEM with ballotExtra(shortlist) then JSON(DelegateInput). Null → {approvals:[], constraints:[], none_of_these:false, intent:"other", confidence:"low"}. */
  async parseBallot(i: DelegateInput, shortlist: PublicBundle[]): Promise<BallotParse> {
    const content = `${ballotExtra(shortlist)}\n\n${JSON.stringify(i)}`;
    const p = await this.structuredParse("parseBallot", BallotParse, BALLOT_SYSTEM, content, DELEGATE_CALL);
    if (!p) return LOW_BALLOT;
    // Plan numbers outside the shortlist are hallucinations; drop them rather than trust them.
    const valid = new Set(shortlist.map((b) => b.index));
    return {
      ...p,
      approvals: [...new Set(p.approvals)].filter((n) => valid.has(n)),
      constraints: p.constraints.filter((c) => c.kind !== "exclude" || valid.has(c.index)),
    };
  }

  /** CONVERSE_SYSTEM over JSON(ConverseInput): the private delegate's free-form reply. Null on failure (caller falls back to templates). */
  async converse(i: ConverseInput): Promise<ConverseResult | null> {
    return this.structuredParse("converse", ConverseResult, CONVERSE_SYSTEM, JSON.stringify(i), CONVERSE_CALL);
  }

  /**
   * PLAN_DRAFT_SYSTEM over JSON(PlanDraftInput), DELEGATE_CALL. Null (failure, refusal, timeout) → the deterministic
   * parser, so the start chat still works when the model is down. Every field is validated in code by startByChat.
   */
  async parsePlanDraft(i: PlanDraftInput): Promise<PlanDraftParse> {
    return (await this.structuredParse("parsePlanDraft", PlanDraftParse, PLAN_DRAFT_SYSTEM, JSON.stringify(i), DELEGATE_CALL)) ?? parsePlanDraftText(i);
  }

  /** B's RATE_SYSTEM + buildRateUserMessage(prefs, candidates), RATE_CALL. Null → {ratings: []} (B defaults in code). */
  async rateBundles(prefs: Preferences, candidates: RateCandidate[]): Promise<Ratings> {
    if (candidates.length === 0) return { ratings: [] };
    return (await this.structuredParse("rateBundles", Ratings, RATE_SYSTEM, buildRateUserMessage(prefs, candidates), RATE_CALL)) ?? { ratings: [] };
  }

  /** B's REPAIR_SYSTEM over the raw Scout text, schema ScoutSubmission, REPAIR_CALL. Null on failure. Scout text only. */
  async repairScoutJson(raw: string, category: "dinner" | "show"): Promise<unknown> {
    return this.structuredParse("repairScoutJson", ScoutSubmission, REPAIR_SYSTEM, `Category: ${category}\n\n${raw}`, REPAIR_CALL);
  }
}
