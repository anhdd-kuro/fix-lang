/**
 * @file requestTypes.ts
 * @description Cross-provider request shapes and message helpers.
 *
 * Extracted from `shared.ts` so each provider's request module can import them
 * WITHOUT importing `shared.ts` itself: `shared.ts` dispatches to the provider
 * modules, so the reverse edge would be a runtime import cycle in the CommonJS
 * main bundle. Import direction is therefore strictly
 * `shared.ts → providers/* → requestTypes.ts`.
 *
 * `shared.ts` re-exports everything here, so existing call sites are unaffected.
 */
import { z } from "zod";
import {
  objectLike,
  AnyNumberSchema,
} from "~/features/core/shared/schemaGuard";
import type { ReasoningEffort } from "~/features/correction/shared/reasoningEffort";
import type { HistorySessionData } from "~/features/history/shared/historySession";
import type { ProviderId } from "~/features/providers/shared/providers";

/** Message content as text: a string as-is, anything else as its JSON. */
export const contentAsText = (content: CoreMessage["content"]): string => {
  const text = z.string().safeParse(content);
  return text.success ? text.data : JSON.stringify(content);
};

export type CoreMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: unknown;
};

/**
 * Options for common AI request operations
 */
export type AIRequestOptions = {
  /** System prompt to guide the AI's behavior */
  systemPrompt: string;
  /** User message to send to the AI */
  userPrompt: string;
  /** OpenAI model to use (if not specified, pulls from store) */
  model?: string;
  /** Top_p for nucleus sampling (if not specified, uses request default) */
  top_p?: number;
  /**
   * AI SDK top-level `reasoning` effort. Omit / provider-default leaves the
   * provider's default behavior.
   */
  reasoning?: ReasoningEffort;
  /** Number of responses to generate */
  n?: number;
  /** Custom messages if needed (overrides system/user prompt params) */
  messages?: CoreMessage[];
  /** Stop sequences */
  stop?: string[] | null;
  /**
   * Cancels the in-flight provider call. Autocomplete supersedes its request on
   * every keystroke, so this is the difference between one billed completion per
   * pause and one per character.
   */
  abortSignal?: AbortSignal;
  /**
   * Caps generated tokens. Latency scales with what the model actually emits, so
   * a continuation that must arrive inside a typing pause needs a ceiling rather
   * than a stop sequence alone.
   */
  maxOutputTokens?: number;
  /**
   * Suppresses the user-facing notification on failure, leaving the throw and
   * the structured log intact.
   *
   * Cancellation is already silent (`isAbortError` in `~/main/notifications/error`).
   * This covers the rest: a request issued by typing rather than by an explicit
   * user action has no moment where an error dialog is expected, so a persistent
   * 401 would otherwise notify again on every pause the user takes.
   */
  quiet?: boolean;
};

/**
 * Response structure for AI request operations
 */
export type AIRequestResponse = {
  content: string[];
  promptTokens: number | null;
  completionTokens: number | null;
  model: string;
  /** Explicit provider used for this request; never inferred from the model id. */
  provider: ProviderId;
  /** Concrete model the provider actually served (resolves alias indirection) */
  resolvedModel?: string;
  prompts?: string[];
  /** Tokens served from prompt cache (Anthropic/Gemini) */
  cachedTokens?: number;
  /** Tokens written to prompt cache (Anthropic/Gemini) */
  cacheWriteTokens?: number;
  /** Model-generated reasoning text when the provider returns it. */
  reasoningTexts?: string[];
  /** Full session snapshot attached by `makeAIRequest` for history transparency. */
  session?: HistorySessionData;
};

/**
 * Split a message list into the AI SDK's `system` option plus the conversation.
 * AI SDK v7 rejects `system`-role entries inside `messages`
 * (standardize-prompt: `allowSystemInMessages` defaults to false).
 */
export const toConversation = (messages: CoreMessage[]) => {
  const system = messages
    .filter((message) => message.role === "system")
    .map((message) => contentAsText(message.content))
    .join("\n\n");
  return {
    system,
    // SAFETY: `makeAIRequest` is the only producer of these messages and
    // builds them from the system and user prompt strings, so once system
    // entries are folded into `system` above, every remaining turn is
    // `{ role: "user", content: string }` — valid in every provider SDK's
    // message type. `never` because each SDK names that type differently.
    messages: messages.filter((message) => message.role !== "system") as never,
  };
};

/** Read token counts under either the v6 or v7 AI SDK usage field names. */
export type UsageCounts = {
  promptTokens: number | null;
  completionTokens: number | null;
};

/**
 * Both generations of field name. Each is read as-is: a v6 field that holds a
 * non-null non-number still shadows its v7 sibling, as `??` would have it.
 */
const UsageFieldsSchema = objectLike({
  promptTokens: z.unknown().optional(),
  inputTokens: z.unknown().optional(),
  completionTokens: z.unknown().optional(),
  outputTokens: z.unknown().optional(),
});

export const usageCounts = <Input>(usage: Input): UsageCounts => {
  const fields = UsageFieldsSchema.safeParse(usage);
  if (!fields.success) {
    return { promptTokens: null, completionTokens: null };
  }
  const prompt = AnyNumberSchema.safeParse(
    fields.data.promptTokens ?? fields.data.inputTokens,
  );
  const completion = AnyNumberSchema.safeParse(
    fields.data.completionTokens ?? fields.data.outputTokens,
  );
  return {
    promptTokens: prompt.success ? prompt.data : null,
    completionTokens: completion.success ? completion.data : null,
  };
};

/**
 * Sum one token field across N sibling responses (the `n > 1` path issues N
 * separate SDK calls). All-null stays null: a `0` would read as "this request
 * used no tokens" rather than "the provider reported none".
 */
export const sumTokenField = (
  counts: readonly {
    promptTokens: number | null;
    completionTokens: number | null;
  }[],
  key: "promptTokens" | "completionTokens",
): number | null => {
  const values = counts
    .map((count) => count[key])
    .filter((count): count is number => count !== null);
  return values.length > 0
    ? values.reduce((total, count) => total + count, 0)
    : null;
};
