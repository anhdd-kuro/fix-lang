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
import type { ProviderId } from "~/shared/providers";

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
  /** Temperature for sampling (if not specified, pulls from store) */
  temperature?: number;
  /** Top_p for nucleus sampling (if not specified, pulls from store) */
  top_p?: number;
  /** Maximum tokens to generate (if not specified, pulls from store) */
  maxTokens?: number;
  /** Number of responses to generate */
  n?: number;
  /** Custom messages if needed (overrides system/user prompt params) */
  messages?: CoreMessage[];
  /** Stop sequences */
  stop?: string[] | null;
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
};

/**
 * Split a message list into the AI SDK's `system` option plus the conversation.
 * AI SDK v7 rejects `system`-role entries inside `messages`
 * (standardize-prompt: `allowSystemInMessages` defaults to false).
 */
export const toConversation = (messages: CoreMessage[]) => {
  const system = messages
    .filter((message) => message.role === "system")
    .map((message) =>
      typeof message.content === "string" ? message.content : JSON.stringify(message.content),
    )
    .join("\n\n");
  return {
    system,
    messages: messages.filter((message) => message.role !== "system") as never,
  };
};

/** Read token counts under either the v6 or v7 AI SDK usage field names. */
export const usageCounts = (
  usage: unknown,
): { promptTokens: number | null; completionTokens: number | null } => {
  if (!usage || typeof usage !== "object") {
    return { promptTokens: null, completionTokens: null };
  }
  const value = usage as Record<string, unknown>;
  const count = (primary: string, fallback: string): number | null => {
    const raw = value[primary] ?? value[fallback];
    return typeof raw === "number" ? raw : null;
  };
  return {
    promptTokens: count("promptTokens", "inputTokens"),
    completionTokens: count("completionTokens", "outputTokens"),
  };
};

/**
 * Sum one token field across N sibling responses (the `n > 1` path issues N
 * separate SDK calls). All-null stays null: a `0` would read as "this request
 * used no tokens" rather than "the provider reported none".
 */
export const sumTokenField = (
  counts: readonly { promptTokens: number | null; completionTokens: number | null }[],
  key: "promptTokens" | "completionTokens",
): number | null => {
  const values = counts
    .map((count) => count[key])
    .filter((count): count is number => count !== null);
  return values.length > 0 ? values.reduce((total, count) => total + count, 0) : null;
};
