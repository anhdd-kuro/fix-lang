/**
 * @file fakeGenerateText.ts
 * @description Test-only stand-in for `generateText` from `ai` that keeps the
 * one v7 behaviour the old hand-rolled fakes hid: `result.response.body` is
 * `undefined` unless the call passes `include: { responseBody: true }`.
 * `aiResponseBody.pin.test.ts` pins that rule against the real installed SDK
 * and checks this fake against it, so a test built on it fails the same way
 * production does.
 *
 * Usage (inside a test that already mocks `ai`):
 *
 *   const { generateTextMock } = vi.hoisted(() => ({ generateTextMock: vi.fn() }));
 *   vi.mock("ai", () => ({ generateText: generateTextMock }));
 *   import { fakeGenerateText } from "~/main/llm/providers/testing/fakeGenerateText";
 *
 *   generateTextMock.mockImplementation(
 *     fakeGenerateText({ text: "fixed", body: { model: "gpt-4o-2024-11-20" } }),
 *   );
 *
 * Usage honesty: when `body.usage` is an OpenAI/OpenRouter chat-completion usage
 * block (it has `prompt_tokens`) and the spec gives no `usage`, the SDK usage is
 * derived from it the way `@openrouter/ai-sdk-provider` does (`computeTokenUsage`):
 * `prompt_tokens_details.cached_tokens` becomes `inputTokenDetails.cacheReadTokens`,
 * `cache_write_tokens` becomes `cacheWriteTokens`, and `noCacheTokens` is
 * `prompt_tokens - cached_tokens`. A spec that gives both and disagrees throws.
 * `body: undefined` models a provider that returns no body at all (Bedrock): the
 * result's `response.body` stays `undefined` even with `include.responseBody`.
 *
 * Pass an array to return a different result per call (the `n > 1` fan-out
 * paths call `generateText` once per choice); the last entry repeats, like
 * `mockValues` from `ai/test`.
 *
 * Imported only by tests — never from production code, so it never ships.
 */

export type FakeUsage = {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  reasoningTokens?: number;
};

export type FakeGenerateTextSpec = {
  text?: string;
  reasoningText?: string;
  usage?: FakeUsage;
  providerMetadata?: Record<string, Record<string, unknown>>;
  /** Raw provider response body. Visible only with `include.responseBody`. */
  body?: unknown;
  /**
   * Served model id. Defaults like the OpenAI-shaped providers do: `body.model`,
   * then the requested model's `modelId`.
   */
  modelId?: string;
  headers?: Record<string, string>;
  finishReason?: "stop" | "length" | "content-filter" | "tool-calls" | "error" | "other";
};

export type FakeGenerateTextCallOptions = {
  model?: unknown;
  include?: { requestBody?: boolean; requestMessages?: boolean; responseBody?: boolean };
  [option: string]: unknown;
};

const FALLBACK_MODEL_ID = "fake-model";
const FAKE_TIMESTAMP = new Date(0);

const stringField = (value: unknown, key: string): string | undefined => {
  if (!value || typeof value !== "object" || !(key in value)) return undefined;
  const field = (value as Record<string, unknown>)[key];
  return typeof field === "string" ? field : undefined;
};

const sumDefined = (...values: (number | undefined)[]): number | undefined =>
  values.every((value) => value === undefined)
    ? undefined
    : values.reduce<number>((total, value) => total + (value ?? 0), 0);

/** The v7 `LanguageModelUsage` shape `generateText` resolves with. */
const toSdkUsage = (usage: FakeUsage = {}, noCacheOverride?: number) => {
  const { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, reasoningTokens } =
    usage;
  return {
    inputTokens,
    inputTokenDetails: {
      // The real SDK subtracts cache reads only; cache writes stay in `noCache`.
      noCacheTokens:
        noCacheOverride ??
        (inputTokens === undefined ? undefined : inputTokens - (cacheReadTokens ?? 0)),
      cacheReadTokens,
      cacheWriteTokens,
    },
    outputTokens,
    outputTokenDetails: {
      textTokens:
        outputTokens === undefined ? undefined : outputTokens - (reasoningTokens ?? 0),
      reasoningTokens,
    },
    totalTokens: sumDefined(inputTokens, outputTokens),
  };
};

const numberField = (value: unknown, key: string): number | undefined => {
  if (!value || typeof value !== "object" || !(key in value)) return undefined;
  const field = (value as Record<string, unknown>)[key];
  return typeof field === "number" ? field : undefined;
};

const objectField = (value: unknown, key: string): unknown =>
  value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined;

/**
 * What `@openrouter/ai-sdk-provider`'s `computeTokenUsage` makes of a chat
 * completion body: absent cache-read and reasoning details count as 0, an
 * absent `cache_write_tokens` stays `undefined`, and `noCache` only subtracts
 * cache reads. Returns `undefined` for a body with no OpenAI-shaped usage.
 */
const deriveUsageFromBody = (
  body: unknown,
): { usage: FakeUsage; noCacheTokens: number } | undefined => {
  const raw = objectField(body, "usage");
  const promptTokens = numberField(raw, "prompt_tokens");
  if (promptTokens === undefined) return undefined;
  const promptDetails = objectField(raw, "prompt_tokens_details");
  const completionDetails = objectField(raw, "completion_tokens_details");
  const cacheReadTokens = numberField(promptDetails, "cached_tokens") ?? 0;
  return {
    usage: {
      inputTokens: promptTokens,
      outputTokens: numberField(raw, "completion_tokens") ?? 0,
      cacheReadTokens,
      cacheWriteTokens: numberField(promptDetails, "cache_write_tokens"),
      reasoningTokens: numberField(completionDetails, "reasoning_tokens") ?? 0,
    },
    noCacheTokens: promptTokens - cacheReadTokens,
  };
};

const USAGE_KEYS = [
  "inputTokens",
  "outputTokens",
  "cacheReadTokens",
  "cacheWriteTokens",
  "reasoningTokens",
] as const;

const resolveUsage = (spec: FakeGenerateTextSpec) => {
  const derived = deriveUsageFromBody(spec.body);
  if (!derived) return toSdkUsage(spec.usage);
  if (spec.usage) {
    for (const key of USAGE_KEYS) {
      const given = spec.usage[key];
      if (given !== undefined && given !== derived.usage[key]) {
        throw new Error(
          `fakeGenerateText: spec.usage.${key} (${given}) contradicts body.usage, which the ` +
            `provider SDK would report as ${derived.usage[key]}. Drop spec.usage or fix the body.`,
        );
      }
    }
  }
  return toSdkUsage(derived.usage, derived.noCacheTokens);
};

const buildResult = (spec: FakeGenerateTextSpec, options: FakeGenerateTextCallOptions) => {
  const text = spec.text ?? "";
  const include = options.include ?? {};
  const usage = resolveUsage(spec);
  const modelId =
    spec.modelId ??
    stringField(spec.body, "model") ??
    stringField(options.model, "modelId") ??
    FALLBACK_MODEL_ID;
  const reasoning =
    spec.reasoningText === undefined
      ? []
      : [{ type: "reasoning" as const, text: spec.reasoningText }];
  const content = [...reasoning, ...(text ? [{ type: "text" as const, text }] : [])];
  const response = {
    id: "fake-response-id",
    timestamp: FAKE_TIMESTAMP,
    modelId,
    headers: spec.headers,
    // The rule this whole helper exists for — mirrors `ai` v7's step builder.
    // A spec with no `body` is a provider that returns none (Bedrock): stays undefined.
    body: include.responseBody ? spec.body : undefined,
    messages: [{ role: "assistant" as const, content }],
  };
  const request = { body: undefined, messages: undefined };
  const finishReason = spec.finishReason ?? "stop";
  const step = {
    content,
    text,
    reasoning,
    reasoningText: spec.reasoningText,
    finishReason,
    usage,
    providerMetadata: spec.providerMetadata,
    request,
    response,
    warnings: [],
  };
  return { ...step, totalUsage: usage, steps: [step] };
};

export type FakeGenerateTextResult = ReturnType<typeof buildResult>;

/**
 * Build a `generateText` implementation for `vi.fn().mockImplementation(...)`.
 * Each call reads its own `include` option, so a body is returned only to a
 * caller that asked for it.
 */
export const fakeGenerateText = (
  specs: FakeGenerateTextSpec | readonly FakeGenerateTextSpec[] = {},
) => {
  const queue: readonly FakeGenerateTextSpec[] = Array.isArray(specs) ? specs : [specs];
  let callIndex = 0;
  return async (options: FakeGenerateTextCallOptions): Promise<FakeGenerateTextResult> => {
    const spec = queue[Math.min(callIndex, queue.length - 1)] ?? {};
    callIndex += 1;
    return buildResult(spec, options);
  };
};

/** The usage block OpenRouter (and OpenAI) really send on a chat completion. */
export type ChatCompletionUsage = {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  prompt_tokens_details?: { cached_tokens: number; cache_write_tokens?: number | null };
  completion_tokens_details?: { reasoning_tokens: number };
  cost?: number;
};

const ANTHROPIC_USAGE_KEYS = ["cache_read_input_tokens", "cache_creation_input_tokens"];

/** Build a real-shaped OpenRouter usage block from counts. */
export const chatCompletionUsage = ({
  promptTokens,
  completionTokens,
  cachedTokens,
  cacheWriteTokens,
  reasoningTokens,
  cost,
}: {
  promptTokens: number;
  completionTokens: number;
  cachedTokens?: number;
  cacheWriteTokens?: number;
  reasoningTokens?: number;
  cost?: number;
}): ChatCompletionUsage => ({
  prompt_tokens: promptTokens,
  completion_tokens: completionTokens,
  total_tokens: promptTokens + completionTokens,
  ...(cachedTokens !== undefined || cacheWriteTokens !== undefined
    ? {
        prompt_tokens_details: {
          cached_tokens: cachedTokens ?? 0,
          ...(cacheWriteTokens !== undefined ? { cache_write_tokens: cacheWriteTokens } : {}),
        },
      }
    : {}),
  ...(reasoningTokens !== undefined
    ? { completion_tokens_details: { reasoning_tokens: reasoningTokens } }
    : {}),
  ...(cost !== undefined ? { cost } : {}),
});

/**
 * An OpenAI-compatible Chat Completions body (the shape OpenRouter returns),
 * one choice per entry in `contents`. `usage` must be the real shape (see
 * `chatCompletionUsage`); Anthropic-style cache keys are refused because
 * OpenRouter never sends them and a test built on them proves nothing.
 */
export const chatCompletionBody = ({
  model,
  contents,
  usage,
}: {
  model: string;
  contents: readonly string[];
  usage?: ChatCompletionUsage;
}) => {
  const impossible = ANTHROPIC_USAGE_KEYS.filter((key) => usage && key in usage);
  if (impossible.length > 0) {
    throw new Error(
      `chatCompletionBody: ${impossible.join(", ")} never appear in an OpenRouter body; ` +
        "use prompt_tokens_details.{cached_tokens,cache_write_tokens} (see chatCompletionUsage).",
    );
  }
  return {
    id: "fake-chatcmpl-id",
    object: "chat.completion",
    model,
    choices: contents.map((content, index) => ({
      index,
      message: { role: "assistant", content },
      finish_reason: "stop",
    })),
    ...(usage ? { usage } : {}),
  };
};
