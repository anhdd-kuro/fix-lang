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
const toSdkUsage = (usage: FakeUsage = {}) => {
  const { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, reasoningTokens } =
    usage;
  const cachedInput = sumDefined(cacheReadTokens, cacheWriteTokens) ?? 0;
  return {
    inputTokens,
    inputTokenDetails: {
      noCacheTokens: inputTokens === undefined ? undefined : inputTokens - cachedInput,
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

const buildResult = (spec: FakeGenerateTextSpec, options: FakeGenerateTextCallOptions) => {
  const text = spec.text ?? "";
  const include = options.include ?? {};
  const usage = toSdkUsage(spec.usage);
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

/**
 * An OpenAI-compatible Chat Completions body (the shape OpenRouter returns),
 * one choice per entry in `contents`. `usage` is passed through verbatim so a
 * test can supply provider-specific cache fields.
 */
export const chatCompletionBody = ({
  model,
  contents,
  usage,
}: {
  model: string;
  contents: readonly string[];
  usage?: Record<string, unknown>;
}) => ({
  id: "fake-chatcmpl-id",
  object: "chat.completion",
  model,
  choices: contents.map((content, index) => ({
    index,
    message: { role: "assistant", content },
    finish_reason: "stop",
  })),
  ...(usage ? { usage } : {}),
});
