/**
 * Pins how the REAL installed `ai` package exposes the raw provider response
 * body, then holds `fakeGenerateText` to the same contract. If an `ai` bump
 * changes the rule, this file fails before any provider test silently drifts.
 *
 * Every provider `request.ts` reads `result.response.body` (served model,
 * OpenRouter cache usage, OpenRouter `n > 1` choices). Since v7 that body is
 * dropped unless the call opts in with `include: { responseBody: true }`.
 */
import { generateText, streamText } from "ai";
import { MockLanguageModelV4, convertArrayToReadableStream } from "ai/test";
import { describe, expect, it } from "vitest";
import {
  chatCompletionBody,
  fakeGenerateText,
  type FakeGenerateTextCallOptions,
} from "./fakeGenerateText";

const REQUESTED_MODEL = "~openai/gpt-mini-latest";
const SERVED_MODEL = "openai/gpt-5.4-mini-20260317";
const PROVIDER_BODY = chatCompletionBody({
  model: SERVED_MODEL,
  contents: ["first", "second"],
  usage: { prompt_tokens: 10, completion_tokens: 4, cache_read_input_tokens: 6 },
});

const providerUsage = {
  inputTokens: { total: 10, noCache: 4, cacheRead: 6, cacheWrite: undefined },
  outputTokens: { total: 4, text: 4, reasoning: undefined },
};
const finishReason = { unified: "stop" as const, raw: "stop" };

const mockModel = ({ reportsModelId = true } = {}) =>
  new MockLanguageModelV4({
    modelId: REQUESTED_MODEL,
    doGenerate: async () => ({
      content: [{ type: "text", text: "first" }],
      finishReason,
      usage: providerUsage,
      warnings: [],
      response: {
        id: "response-1",
        timestamp: new Date(0),
        ...(reportsModelId ? { modelId: SERVED_MODEL } : {}),
        body: PROVIDER_BODY,
      },
    }),
    doStream: async () => ({
      stream: convertArrayToReadableStream([
        { type: "response-metadata", id: "response-1", modelId: SERVED_MODEL },
        { type: "text-start", id: "t" },
        { type: "text-delta", id: "t", delta: "first" },
        { type: "text-end", id: "t" },
        { type: "finish", finishReason, usage: providerUsage },
      ]),
      response: { headers: { "x-request-id": "abc" } },
    }),
  });

describe("ai v7 response body (real SDK)", () => {
  it("generateText drops response.body when include is omitted", async () => {
    const result = await generateText({ model: mockModel(), prompt: "hi" });

    expect(result.response.body).toBeUndefined();
    // The key exists; only its value is withheld — `"body" in` checks lie.
    expect("body" in result.response).toBe(true);
  });

  it("generateText drops response.body when include.responseBody is false", async () => {
    const result = await generateText({
      model: mockModel(),
      prompt: "hi",
      include: { responseBody: false },
    });

    expect(result.response.body).toBeUndefined();
  });

  it("generateText returns response.body with include: { responseBody: true }", async () => {
    const result = await generateText({
      model: mockModel(),
      prompt: "hi",
      include: { responseBody: true },
    });

    expect(result.response.body).toEqual(PROVIDER_BODY);
    expect(result.steps[0]?.response.body).toEqual(PROVIDER_BODY);
  });

  it("generateText reports the served model in response.modelId without any include", async () => {
    const result = await generateText({ model: mockModel(), prompt: "hi" });

    expect(result.response.modelId).toBe(SERVED_MODEL);
  });

  it("generateText falls back to the requested modelId when the provider reports none", async () => {
    const result = await generateText({
      model: mockModel({ reportsModelId: false }),
      prompt: "hi",
    });

    expect(result.response.modelId).toBe(REQUESTED_MODEL);
  });

  it("generateText surfaces cache-read tokens in usage without any include", async () => {
    const result = await generateText({ model: mockModel(), prompt: "hi" });

    expect(result.usage.inputTokens).toBe(10);
    expect(result.usage.inputTokenDetails.cacheReadTokens).toBe(6);
    expect(result.usage.outputTokens).toBe(4);
  });

  it("streamText has no response body at all, and no include option to ask for one", async () => {
    const result = streamText({
      model: mockModel(),
      prompt: "hi",
      // @ts-expect-error -- StreamTextInclude has no `responseBody`; pinned so a
      // future SDK adding it turns this line into a compile error worth reading.
      include: { responseBody: true },
    });
    await result.consumeStream();
    const response = await result.response;

    expect("body" in response).toBe(false);
    expect(response.modelId).toBe(SERVED_MODEL);
  });
});

describe("fakeGenerateText matches the real SDK", () => {
  const callBoth = async (include?: FakeGenerateTextCallOptions["include"]) => {
    const real = await generateText({
      model: mockModel(),
      prompt: "hi",
      ...(include ? { include } : {}),
    });
    const fake = await fakeGenerateText({
      text: "first",
      body: PROVIDER_BODY,
      usage: { inputTokens: 10, outputTokens: 4, cacheReadTokens: 6 },
    })({ model: { modelId: REQUESTED_MODEL }, prompt: "hi", ...(include ? { include } : {}) });
    return { real, fake };
  };

  it.each([
    ["omitted", undefined],
    ["responseBody: false", { responseBody: false }],
    ["responseBody: true", { responseBody: true }],
  ] as const)("response.body agrees when include is %s", async (_label, include) => {
    const { real, fake } = await callBoth(include);

    expect(fake.response.body).toEqual(real.response.body);
  });

  it("text, served model, and usage agree", async () => {
    const { real, fake } = await callBoth();

    expect(fake.text).toBe(real.text);
    expect(fake.reasoningText).toBe(real.reasoningText);
    expect(fake.response.modelId).toBe(real.response.modelId);
    expect(fake.usage).toEqual(real.usage);
  });
});

describe("fakeGenerateText", () => {
  it("returns one spec per call and repeats the last for extra calls", async () => {
    const generate = fakeGenerateText([{ text: "first" }, { text: "second" }]);

    const texts = await Promise.all(
      [1, 2, 3].map(async () => (await generate({})).text),
    );

    expect(texts).toEqual(["first", "second", "second"]);
  });

  it("falls back to the requested model's id when neither modelId nor body.model is given", async () => {
    const result = await fakeGenerateText({ text: "x" })({
      model: { modelId: REQUESTED_MODEL },
    });

    expect(result.response.modelId).toBe(REQUESTED_MODEL);
  });

  it("passes reasoning and providerMetadata through", async () => {
    const result = await fakeGenerateText({
      text: "answer",
      reasoningText: "thinking",
      providerMetadata: { openrouter: { usage: { cost: 0.01 } } },
    })({});

    expect(result.reasoningText).toBe("thinking");
    expect(result.reasoning).toEqual([{ type: "reasoning", text: "thinking" }]);
    expect(result.providerMetadata).toEqual({ openrouter: { usage: { cost: 0.01 } } });
  });
});
