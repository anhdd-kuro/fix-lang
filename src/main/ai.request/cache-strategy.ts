/**
 * @file cache-strategy.ts
 * @description Provider-aware system prompt caching strategy for OpenRouter requests.
 *
 * OpenRouter forwards cache_control hints to providers that support it:
 * - Anthropic / Claude: explicit ephemeral cache_control on message blocks
 * - Google / Gemini: explicit ephemeral cache_control on message blocks
 * - OpenAI, xAI, DeepSeek: implicit prefix caching — no annotation needed, the
 *   provider caches automatically when the same prefix is repeated
 * - Everything else: no caching support, pass messages through unchanged
 */
import { stripModelRefPrefix } from "~/features/providers/shared/modelRef";
import { contentAsText } from "./requestTypes";
import {
  AnyNumberSchema,
  objectLike,
} from "~/features/core/shared/schemaGuard";

export enum CacheProvider {
  ANTHROPIC = "ANTHROPIC",
  GEMINI = "GEMINI",
  OPENAI_IMPLICIT = "OPENAI_IMPLICIT",
  UNSUPPORTED = "UNSUPPORTED",
}

/**
 * Determines which caching strategy to use based on the model ID string.
 *
 * Must strip the composite-ref prefix before the prefix-sensitive
 * `startsWith` arms, or a ref falls through to `UNSUPPORTED` and prompt
 * caching silently stops. Only ids classified solely by `startsWith`
 * (`google/gemma-*`, `openai/o*`, non-Claude Anthropic) break — ids carrying a
 * family word are rescued by the `includes` arms, so a Claude-id test passes
 * against broken code.
 */
export function resolveCacheProvider(modelId: string): CacheProvider {
  const id = stripModelRefPrefix(modelId).toLowerCase();

  if (id.startsWith("anthropic/") || id.includes("claude")) {
    return CacheProvider.ANTHROPIC;
  }

  if (id.startsWith("google/") || id.includes("gemini")) {
    return CacheProvider.GEMINI;
  }

  if (
    id.startsWith("openai/") ||
    id.includes("gpt") ||
    id.startsWith("x-ai/") ||
    id.includes("grok") ||
    id.includes("deepseek")
  ) {
    return CacheProvider.OPENAI_IMPLICIT;
  }

  return CacheProvider.UNSUPPORTED;
}

type RawMessage = { role: string; content: unknown };

/**
 * Wraps the system message with provider-specific cache_control annotations
 * so OpenRouter can instruct the underlying provider to cache the prompt prefix.
 *
 * For ANTHROPIC and GEMINI, the system message content is converted to a
 * content-block array with `cache_control: { type: "ephemeral" }` on the last
 * block — the minimum required to activate prompt caching on those providers.
 *
 * For OPENAI_IMPLICIT and UNSUPPORTED the messages are returned as-is; OpenAI
 * caches automatically and other providers have no caching API.
 */
export function buildCachedMessages(
  messages: RawMessage[],
  provider: CacheProvider,
): RawMessage[] {
  if (
    provider !== CacheProvider.ANTHROPIC &&
    provider !== CacheProvider.GEMINI
  ) {
    return messages;
  }

  return messages.map((msg) => {
    if (msg.role !== "system") return msg;

    // If content is already an array of content blocks, append cache_control
    // to the last block rather than re-wrapping (avoids double-serialization).
    if (Array.isArray(msg.content)) {
      // SAFETY: an array `content` is a chat-API content-block list, and every
      // block in that contract is an object (`{ type, text, ... }`).
      const blocks = [...(msg.content as object[])];
      const last = {
        // SAFETY: `blocks` holds content-block objects, per the line above.
        ...(blocks[blocks.length - 1] as object),
        cache_control: { type: "ephemeral" },
      };
      return { ...msg, content: [...blocks.slice(0, -1), last] };
    }

    const textContent = contentAsText(msg.content);

    return {
      ...msg,
      content: [
        {
          type: "text",
          text: textContent,
          cache_control: { type: "ephemeral" },
        },
      ],
    };
  });
}

/**
 * Safely extracts cache-usage fields from an OpenRouter usage object.
 * These fields are present only when caching is active for the request.
 */
export type CacheUsage = {
  cachedTokens: number;
  cacheWriteTokens: number;
};

/** A count when the field holds a number primitive (NaN included), else `0`. */
const CacheCountSchema = AnyNumberSchema.catch(0);

const CacheUsageFieldsSchema = objectLike({
  cache_read_input_tokens: CacheCountSchema,
  cache_creation_input_tokens: CacheCountSchema,
}).catch({ cache_read_input_tokens: 0, cache_creation_input_tokens: 0 });

export function extractCacheUsage<Input>(usage: Input): CacheUsage {
  const fields = CacheUsageFieldsSchema.parse(usage);
  return {
    cachedTokens: fields.cache_read_input_tokens,
    cacheWriteTokens: fields.cache_creation_input_tokens,
  };
}
