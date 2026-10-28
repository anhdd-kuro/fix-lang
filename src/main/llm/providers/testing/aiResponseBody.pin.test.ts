/**
 * Pins how the REAL installed `ai` package exposes the raw provider response
 * body, then holds `fakeGenerateText` to the same contract. If an `ai` bump
 * changes the rule, this file fails before any provider test silently drifts.
 *
 * Every provider `request.ts` reads `result.response.body` (served model,
 * OpenRouter cache usage, OpenRouter `n > 1` choices). Since v7 that body is
 * dropped unless the call opts in with `include: { responseBody: true }`.
 */
import { createAmazonBedrock } from "@ai-sdk/amazon-bedrock";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateText, streamText } from "ai";
import { MockLanguageModelV4, convertArrayToReadableStream } from "ai/test";
import { describe, expect, it } from "vitest";
import {
  chatCompletionBody,
  chatCompletionUsage,
  fakeGenerateText,
  type ChatCompletionBody,
  type FakeGenerateTextCallOptions,
} from "./fakeGenerateText";

const REQUESTED_MODEL = "~openai/gpt-mini-latest";
const SERVED_MODEL = "openai/gpt-5.4-mini-20260317";
const PROVIDER_BODY = chatCompletionBody({
  model: SERVED_MODEL,
  contents: ["first", "second"],
  usage: chatCompletionUsage({
    promptTokens: 10,
    completionTokens: 4,
    cachedTokens: 6,
  }),
});

const providerUsage = {
  inputTokens: { total: 10, noCache: 4, cacheRead: 6, cacheWrite: undefined },
  outputTokens: { total: 4, text: 4, reasoning: 0 },
};
const finishReason = { unified: "stop" as const, raw: "stop" };

type ProviderResponse = {
  id: string;
  timestamp: Date;
  modelId?: string;
  body: ChatCompletionBody;
};

const mockModel = ({ reportsModelId = true } = {}) =>
  new MockLanguageModelV4({
    modelId: REQUESTED_MODEL,
    doGenerate: async () => {
      const response: ProviderResponse = {
        id: "response-1",
        timestamp: new Date(0),
        body: PROVIDER_BODY,
      };
      if (reportsModelId) response.modelId = SERVED_MODEL;
      return {
        content: [{ type: "text", text: "first" }],
        finishReason,
        usage: providerUsage,
        warnings: [],
        response,
      };
    },
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

const jsonResponse = <Body>(body: Body) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

const stubFetch = <Body>(body: Body): typeof globalThis.fetch =>
  Object.assign(async () => jsonResponse(body), {
    preconnect: () => undefined,
  });

describe("real @openrouter/ai-sdk-provider through generateText", () => {
  const openRouterBody = chatCompletionBody({
    model: SERVED_MODEL,
    contents: ["first"],
    usage: chatCompletionUsage({
      promptTokens: 40,
      completionTokens: 9,
      cachedTokens: 6,
      cacheWriteTokens: 2,
      reasoningTokens: 3,
    }),
  });

  const run = (
    include?: { responseBody?: boolean },
    body: ChatCompletionBody = openRouterBody,
  ) => {
    const openRouter = createOpenRouter({
      apiKey: "sk-or-test",
      fetch: stubFetch(body),
    });
    const model = openRouter(REQUESTED_MODEL);
    return include
      ? generateText({ model, prompt: "hi", include })
      : generateText({ model, prompt: "hi" });
  };

  it("exposes the served model and cache counts with no include", async () => {
    const result = await run();

    expect(result.response.modelId).toBe(SERVED_MODEL);
    expect(result.usage.inputTokens).toBe(40);
    expect(result.usage.inputTokenDetails.cacheReadTokens).toBe(6);
    expect(result.usage.inputTokenDetails.cacheWriteTokens).toBe(2);
    expect(result.usage.inputTokenDetails.noCacheTokens).toBe(34);
    expect(result.usage.outputTokenDetails.reasoningTokens).toBe(3);
  });

  it("returns response.body only with include: { responseBody: true }", async () => {
    expect((await run()).response.body).toBeUndefined();
    expect((await run({ responseBody: true })).response.body).toEqual(
      openRouterBody,
    );
  });

  it("reports cache reads as 0 and cache writes as undefined when the body omits details", async () => {
    const result = await run(
      undefined,
      chatCompletionBody({
        model: SERVED_MODEL,
        contents: ["first"],
        usage: chatCompletionUsage({ promptTokens: 40, completionTokens: 9 }),
      }),
    );

    expect(result.usage.inputTokenDetails.cacheReadTokens).toBe(0);
    expect(result.usage.inputTokenDetails.cacheWriteTokens).toBeUndefined();
  });

  it("fakeGenerateText derives the same usage from the same body", async () => {
    const real = await run();
    const fake = await fakeGenerateText({
      text: "first",
      body: openRouterBody,
    })({
      model: { modelId: REQUESTED_MODEL },
    });

    expect(fake.usage).toEqual({ ...real.usage, raw: undefined });
    expect(fake.response.modelId).toBe(real.response.modelId);
  });
});

describe("real @ai-sdk/amazon-bedrock through generateText", () => {
  const BEDROCK_MODEL = "us.anthropic.claude-sonnet-4-5-20250929-v1:0";
  const converseBody = {
    output: { message: { role: "assistant", content: [{ text: "first" }] } },
    stopReason: "end_turn",
    usage: {
      inputTokens: 40,
      outputTokens: 9,
      totalTokens: 49,
      cacheReadInputTokens: 6,
      cacheWriteInputTokens: 2,
    },
  };

  const run = (include?: { responseBody?: boolean }) => {
    const bedrock = createAmazonBedrock({
      region: "us-east-1",
      apiKey: "bedrock-test",
      fetch: stubFetch(converseBody),
    });
    const model = bedrock(BEDROCK_MODEL);
    return include
      ? generateText({ model, prompt: "hi", include })
      : generateText({ model, prompt: "hi" });
  };

  it("returns no response.body even with include: { responseBody: true }", async () => {
    const result = await run({ responseBody: true });

    expect(result.text).toBe("first");
    expect(result.response.body).toBeUndefined();
  });

  it("reports the requested model id and cache counts in usage", async () => {
    const result = await run();

    expect(result.response.modelId).toBe(BEDROCK_MODEL);
    expect(result.usage.inputTokenDetails.cacheReadTokens).toBe(6);
    expect(result.usage.inputTokenDetails.cacheWriteTokens).toBe(2);
  });

  it("fakeGenerateText with no body also returns none under include", async () => {
    const fake = await fakeGenerateText({ text: "first" })({
      model: { modelId: BEDROCK_MODEL },
      include: { responseBody: true },
    });

    expect(fake.response.body).toBeUndefined();
    expect(fake.response.modelId).toBe(BEDROCK_MODEL);
  });
});

describe("fakeGenerateText matches the real SDK", () => {
  const callBoth = async (include?: FakeGenerateTextCallOptions["include"]) => {
    const model = mockModel();
    const real = include
      ? await generateText({ model, prompt: "hi", include })
      : await generateText({ model, prompt: "hi" });
    const fakeCall: FakeGenerateTextCallOptions = {
      model: { modelId: REQUESTED_MODEL },
      prompt: "hi",
    };
    if (include) fakeCall.include = include;
    const fake = await fakeGenerateText({
      text: "first",
      body: PROVIDER_BODY,
      usage: { inputTokens: 10, outputTokens: 4, cacheReadTokens: 6 },
    })(fakeCall);
    return { real, fake };
  };

  it.each([
    ["omitted", undefined],
    ["responseBody: false", { responseBody: false }],
    ["responseBody: true", { responseBody: true }],
  ] as const)(
    "response.body agrees when include is %s",
    async (_label, include) => {
      const { real, fake } = await callBoth(include);

      expect(fake.response.body).toEqual(real.response.body);
    },
  );

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

  it("derives SDK usage from an OpenRouter-shaped body.usage when the spec gives none", async () => {
    const result = await fakeGenerateText({
      text: "x",
      body: chatCompletionBody({
        model: SERVED_MODEL,
        contents: ["x"],
        usage: chatCompletionUsage({
          promptTokens: 40,
          completionTokens: 9,
          cachedTokens: 6,
          cacheWriteTokens: 2,
          reasoningTokens: 3,
        }),
      }),
    })({});

    expect(result.usage).toMatchObject({
      inputTokens: 40,
      outputTokens: 9,
      inputTokenDetails: {
        noCacheTokens: 34,
        cacheReadTokens: 6,
        cacheWriteTokens: 2,
      },
      outputTokenDetails: { textTokens: 6, reasoningTokens: 3 },
    });
  });

  it("accepts an explicit spec.usage that agrees with body.usage", async () => {
    const result = await fakeGenerateText({
      text: "x",
      usage: { inputTokens: 40, outputTokens: 9, cacheReadTokens: 6 },
      body: chatCompletionBody({
        model: SERVED_MODEL,
        contents: ["x"],
        usage: chatCompletionUsage({
          promptTokens: 40,
          completionTokens: 9,
          cachedTokens: 6,
        }),
      }),
    })({});

    expect(result.usage.inputTokenDetails.cacheReadTokens).toBe(6);
  });

  it("throws when spec.usage contradicts body.usage", async () => {
    const generate = fakeGenerateText({
      text: "x",
      usage: { inputTokens: 40, outputTokens: 9, cacheReadTokens: 6 },
      body: chatCompletionBody({
        model: SERVED_MODEL,
        contents: ["x"],
        usage: chatCompletionUsage({ promptTokens: 40, completionTokens: 9 }),
      }),
    });

    await expect(generate({})).rejects.toThrow(
      /cacheReadTokens \(6\) contradicts body\.usage/,
    );
  });

  it("leaves usage to spec.usage when the body carries no usage", async () => {
    const result = await fakeGenerateText({
      text: "x",
      usage: { inputTokens: 10, outputTokens: 2 },
      body: { model: SERVED_MODEL },
    })({});

    expect(result.usage.inputTokens).toBe(10);
    expect(result.usage.inputTokenDetails.cacheReadTokens).toBeUndefined();
  });

  it("chatCompletionBody refuses Anthropic cache keys OpenRouter never sends", () => {
    expect(() =>
      chatCompletionBody({
        model: SERVED_MODEL,
        contents: ["x"],
        usage: { cache_read_input_tokens: 6 } as never,
      }),
    ).toThrow(/cache_read_input_tokens/);
  });

  it("passes reasoning and providerMetadata through", async () => {
    const result = await fakeGenerateText({
      text: "answer",
      reasoningText: "thinking",
      providerMetadata: { openrouter: { usage: { cost: 0.01 } } },
    })({});

    expect(result.reasoningText).toBe("thinking");
    expect(result.reasoning).toEqual([{ type: "reasoning", text: "thinking" }]);
    expect(result.providerMetadata).toEqual({
      openrouter: { usage: { cost: 0.01 } },
    });
  });
});
