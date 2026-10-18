// The {timeout: 1} adapter test (B plan T6): RequestOptions reach messages.parse, a timeout throws in the SDK, and
// the adapter degrades to "no ratings" (→ RATING_DEFAULT) without throwing. Offline: a local server that never answers.
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { Ratings } from "@tab/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AnthropicLLM, RATE_CALL, setLlmRecorder, type LlmRequestBody } from "../delegates/anthropicLLM";
import { buildRateUserMessage, RATE_SYSTEM } from "./ratePrompt";
import { prefs } from "./testkit";

let server: Server;
let client: Anthropic;

beforeAll(async () => {
  server = createServer(() => {}); // accepts, never responds
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  client = new Anthropic({ apiKey: "test-not-a-key", baseURL: `http://127.0.0.1:${(server.address() as AddressInfo).port}` });
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
});

const body = {
  model: RATE_CALL.model,
  max_tokens: RATE_CALL.maxTokens,
  system: RATE_SYSTEM,
  messages: [{ role: "user" as const, content: buildRateUserMessage(prefs(), []) }],
  output_config: { format: zodOutputFormat(Ratings), effort: "low" as const },
};

describe("rateBundles transport", () => {
  it("messages.parse(body, { timeout: 1 }) throws APIConnectionTimeoutError", async () => {
    await expect(client.messages.parse(body, { timeout: 1, maxRetries: 0 })).rejects.toBeInstanceOf(Anthropic.APIConnectionTimeoutError);
  });

  it("the adapter turns a timeout into null (callers default the ratings) and sends B's prompt with no tools", async () => {
    const seen: LlmRequestBody[] = [];
    setLlmRecorder((r) => seen.push(r.body));
    try {
      const llm = new AnthropicLLM(client);
      const out = await llm.structuredParse("rateBundles", Ratings, RATE_SYSTEM, body.messages[0]!.content, { ...RATE_CALL, timeoutMs: 1, maxRetries: 0 });
      expect(out).toBeNull();
    } finally {
      setLlmRecorder(null);
    }
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ model: "claude-sonnet-5-5", max_tokens: 4096, system: RATE_SYSTEM, output_config: { effort: "low" } });
    expect(Object.keys(seen[0]!).sort()).toEqual(["max_tokens", "messages", "model", "output_config", "system"]);
  });
});
