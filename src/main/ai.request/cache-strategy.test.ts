/**
 * @file cache-strategy.test.ts
 * @description Tests for provider-aware cache strategy utilities
 */
import { describe, expect, it } from "vitest";
import {
  CacheProvider,
  buildCachedMessages,
  extractCacheUsage,
  resolveCacheProvider,
} from "./cache-strategy";

// ---------------------------------------------------------------------------
// resolveCacheProvider
// ---------------------------------------------------------------------------

describe("resolveCacheProvider", () => {
  it("resolves Anthropic prefix to ANTHROPIC", () => {
    expect(resolveCacheProvider("anthropic/claude-3-5-sonnet")).toBe(
      CacheProvider.ANTHROPIC,
    );
  });

  it("resolves claude in model id to ANTHROPIC", () => {
    expect(resolveCacheProvider("claude-3-opus-20240229")).toBe(
      CacheProvider.ANTHROPIC,
    );
  });

  it("resolves Google prefix to GEMINI", () => {
    expect(resolveCacheProvider("google/gemini-2.0-flash")).toBe(
      CacheProvider.GEMINI,
    );
  });

  it("resolves gemini in model id to GEMINI", () => {
    expect(resolveCacheProvider("gemini-1.5-pro")).toBe(CacheProvider.GEMINI);
  });

  it("resolves openai prefix to OPENAI_IMPLICIT", () => {
    expect(resolveCacheProvider("openai/gpt-4o")).toBe(
      CacheProvider.OPENAI_IMPLICIT,
    );
  });

  it("resolves gpt in model id to OPENAI_IMPLICIT", () => {
    expect(resolveCacheProvider("gpt-4-turbo")).toBe(
      CacheProvider.OPENAI_IMPLICIT,
    );
  });

  it("resolves x-ai prefix to OPENAI_IMPLICIT", () => {
    expect(resolveCacheProvider("x-ai/grok-2")).toBe(
      CacheProvider.OPENAI_IMPLICIT,
    );
  });

  it("resolves grok in model id to OPENAI_IMPLICIT", () => {
    expect(resolveCacheProvider("grok-1")).toBe(CacheProvider.OPENAI_IMPLICIT);
  });

  it("resolves deepseek in model id to OPENAI_IMPLICIT", () => {
    expect(resolveCacheProvider("deepseek/deepseek-chat")).toBe(
      CacheProvider.OPENAI_IMPLICIT,
    );
  });

  it("resolves unknown provider to UNSUPPORTED", () => {
    expect(resolveCacheProvider("meta-llama/llama-3-70b")).toBe(
      CacheProvider.UNSUPPORTED,
    );
  });

  it("resolves mistral to UNSUPPORTED", () => {
    expect(resolveCacheProvider("mistralai/mistral-7b-instruct")).toBe(
      CacheProvider.UNSUPPORTED,
    );
  });

  // W4: empty string should not match any provider
  it("resolves empty string to UNSUPPORTED", () => {
    expect(resolveCacheProvider("")).toBe(CacheProvider.UNSUPPORTED);
  });

  // W5: mixed-case model IDs should still resolve correctly (lowercased internally)
  it("resolves mixed-case Anthropic/Claude-3 to ANTHROPIC", () => {
    expect(resolveCacheProvider("Anthropic/Claude-3")).toBe(
      CacheProvider.ANTHROPIC,
    );
  });
});

// ---------------------------------------------------------------------------
// D19 — composite model refs must not silently degrade
//
// Every assertion below is `equals the raw-id result`, never `equals a
// specific CacheProvider literal`. That formulation is the point: this is a
// SILENT regression — a composite ref that misses a `startsWith(...)` arm
// falls through to UNSUPPORTED, prompt caching stops, and the only symptom is
// a bigger bill. A literal assertion would keep passing for the wrong reason
// if someone later retunes the strategy table; equality with the raw id
// cannot.
// ---------------------------------------------------------------------------

describe("resolveCacheProvider — composite model refs (D19)", () => {
  const equivalent = (raw: string, ref: string) => {
    expect(resolveCacheProvider(ref)).toEqual(resolveCacheProvider(raw));
  };

  // -- The pairs that genuinely regressed ----------------------------------
  //
  // Only the `startsWith(...)` arms are prefix-sensitive. An id that also
  // matches an `includes(...)` arm ("claude", "gemini", "gpt", "grok",
  // "deepseek") is rescued by that arm, and degrades only when the family
  // word is absent from the id — the common case for `google/gemma-*`,
  // `openai/o*` and any non-Claude Anthropic id. These are the pairs that
  // were actually returning UNSUPPORTED for a composite ref.

  it("an openrouter:: ref to a Gemma id matches the raw id", () => {
    // "google/gemma-2-9b-it" contains no "gemini", so only
    // `startsWith("google/")` can classify it.
    equivalent("google/gemma-2-9b-it", "openrouter::google/gemma-2-9b-it");
  });

  it("an openrouter:: ref to an OpenAI o-series id matches the raw id", () => {
    // "openai/o3-mini" contains no "gpt" — same shape as the Gemma case.
    equivalent("openai/o3-mini", "openrouter::openai/o3-mini");
  });

  it("an openai:: ref to an OpenAI o-series id matches the raw id", () => {
    // The prefix need not name a different provider than the id's own path
    // segment: "openai::openai/o3-mini" no longer starts with "openai/".
    equivalent("openai/o3-mini", "openai::openai/o3-mini");
  });

  it("an openrouter:: ref to a non-Claude Anthropic id matches the raw id", () => {
    equivalent("anthropic/haiku-next", "openrouter::anthropic/haiku-next");
  });

  // -- Pairs that were already equal, pinned so they stay equal -------------
  //
  // These pass before the fix too, rescued by an `includes(...)` arm. They
  // are kept because a strip applied at the wrong point in the chain would
  // break them — and because the card names the first one as the motivating
  // example, so it is worth recording that this particular id was NOT one of
  // the ones losing its cache.

  it("an openrouter:: ref to a Claude id matches the raw id", () => {
    equivalent(
      "anthropic/claude-3.5-sonnet",
      "openrouter::anthropic/claude-3.5-sonnet",
    );
  });

  it("an openrouter:: ref to a Gemini id matches the raw id", () => {
    equivalent("google/gemini-2.0-flash", "openrouter::google/gemini-2.0-flash");
  });

  it("an openai:: ref to a GPT id matches the raw id", () => {
    equivalent("openai/gpt-4o", "openai::openai/gpt-4o");
  });

  it("a ref to a genuinely unsupported model still matches the raw id", () => {
    // The UNSUPPORTED case has to be pinned too: a strip that accidentally
    // widened matching would show up here and nowhere else.
    equivalent("meta-llama/llama-3-70b", "openrouter::meta-llama/llama-3-70b");
  });

  it("an ollama:: ref keeps the tag's own colon intact", () => {
    // `::` splits once, so "llama3.2:3b" survives the strip unaltered.
    equivalent("llama3.2:3b", "ollama::llama3.2:3b");
    equivalent("deepseek-r1:7b", "ollama::deepseek-r1:7b");
  });

  it("an unrecognized head is NOT a prefix — it stays part of the id", () => {
    // `parseModelRef` only honors a known provider id, so "bogus::claude-3"
    // is a bare id whose modelId is the whole string. It still resolves
    // ANTHROPIC via the `includes("claude")` arm.
    expect(resolveCacheProvider("bogus::claude-3")).toBe(CacheProvider.ANTHROPIC);
    // …and an unknown head does still hide a `startsWith` id, exactly as it
    // does for every other consumer of `parseModelRef`. Pinned so a future
    // "just split on any ::" shortcut fails here.
    expect(resolveCacheProvider("bogus::openai/o3-mini")).toBe(
      CacheProvider.UNSUPPORTED,
    );
  });

  it("the inherit sentinel is still UNSUPPORTED", () => {
    equivalent("", "");
    expect(resolveCacheProvider("")).toBe(CacheProvider.UNSUPPORTED);
  });
});

// ---------------------------------------------------------------------------
// buildCachedMessages
// ---------------------------------------------------------------------------

describe("buildCachedMessages", () => {
  const baseMessages = [
    { role: "system", content: "You are a helpful assistant." },
    { role: "user", content: "Hello" },
  ];

  it("wraps system message for ANTHROPIC with cache_control block", () => {
    const result = buildCachedMessages(baseMessages, CacheProvider.ANTHROPIC);

    const systemMsg = result.find((m) => m.role === "system");
    expect(Array.isArray(systemMsg?.content)).toBe(true);

    const blocks = systemMsg?.content as {
      type: string;
      text: string;
      cache_control: { type: string };
    }[];
    expect(blocks[0].type).toBe("text");
    expect(blocks[0].text).toBe("You are a helpful assistant.");
    expect(blocks[0].cache_control).toEqual({ type: "ephemeral" });
  });

  it("wraps system message for GEMINI with cache_control block", () => {
    const result = buildCachedMessages(baseMessages, CacheProvider.GEMINI);

    const systemMsg = result.find((m) => m.role === "system");
    expect(Array.isArray(systemMsg?.content)).toBe(true);

    const blocks = systemMsg?.content as {
      type: string;
      text: string;
      cache_control: { type: string };
    }[];
    expect(blocks[0].type).toBe("text");
    expect(blocks[0].text).toBe("You are a helpful assistant.");
    expect(blocks[0].cache_control).toEqual({ type: "ephemeral" });
  });

  it("leaves user message unchanged for ANTHROPIC", () => {
    const result = buildCachedMessages(baseMessages, CacheProvider.ANTHROPIC);
    const userMsg = result.find((m) => m.role === "user");
    expect(userMsg?.content).toBe("Hello");
  });

  it("returns messages unchanged for OPENAI_IMPLICIT", () => {
    const result = buildCachedMessages(
      baseMessages,
      CacheProvider.OPENAI_IMPLICIT,
    );
    expect(result).toEqual(baseMessages);
  });

  it("returns messages unchanged for UNSUPPORTED", () => {
    const result = buildCachedMessages(baseMessages, CacheProvider.UNSUPPORTED);
    expect(result).toEqual(baseMessages);
  });

  it("handles non-string system content by JSON-serializing it", () => {
    const msgs = [{ role: "system", content: { key: "value" } }];
    const result = buildCachedMessages(msgs, CacheProvider.ANTHROPIC);
    const blocks = result[0].content as { text: string }[];
    expect(blocks[0].text).toBe('{"key":"value"}');
  });

  it("does not mutate the original messages array", () => {
    const original = [{ role: "system", content: "original" }];
    buildCachedMessages(original, CacheProvider.ANTHROPIC);
    expect(original[0].content).toBe("original");
  });

  // W6: array content (C3 scenario) — appends cache_control to last block, does not re-wrap
  it("appends cache_control to last block when content is already an array", () => {
    const msgs = [
      {
        role: "system",
        content: [
          { type: "text", text: "Block one" },
          { type: "text", text: "Block two" },
        ],
      },
    ];
    const result = buildCachedMessages(msgs, CacheProvider.ANTHROPIC);
    const blocks = result[0].content as {
      type: string;
      text: string;
      cache_control?: { type: string };
    }[];
    expect(blocks).toHaveLength(2);
    expect(blocks[0].text).toBe("Block one");
    expect(blocks[0].cache_control).toBeUndefined();
    expect(blocks[1].text).toBe("Block two");
    expect(blocks[1].cache_control).toEqual({ type: "ephemeral" });
  });

  // W8: empty messages array should return empty array without error
  it("returns empty array unchanged for ANTHROPIC", () => {
    expect(buildCachedMessages([], CacheProvider.ANTHROPIC)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// extractCacheUsage
// ---------------------------------------------------------------------------

describe("extractCacheUsage", () => {
  it("extracts both cache fields when present", () => {
    const usage = {
      cache_read_input_tokens: 500,
      cache_creation_input_tokens: 200,
    };
    expect(extractCacheUsage(usage)).toEqual({
      cachedTokens: 500,
      cacheWriteTokens: 200,
    });
  });

  it("defaults missing cache_read_input_tokens to 0", () => {
    expect(extractCacheUsage({ cache_creation_input_tokens: 100 })).toEqual({
      cachedTokens: 0,
      cacheWriteTokens: 100,
    });
  });

  it("defaults missing cache_creation_input_tokens to 0", () => {
    expect(extractCacheUsage({ cache_read_input_tokens: 300 })).toEqual({
      cachedTokens: 300,
      cacheWriteTokens: 0,
    });
  });

  it("returns zeros when usage is null", () => {
    expect(extractCacheUsage(null)).toEqual({
      cachedTokens: 0,
      cacheWriteTokens: 0,
    });
  });

  it("returns zeros when usage is undefined", () => {
    expect(extractCacheUsage(undefined)).toEqual({
      cachedTokens: 0,
      cacheWriteTokens: 0,
    });
  });

  it("returns zeros when usage is an empty object", () => {
    expect(extractCacheUsage({})).toEqual({
      cachedTokens: 0,
      cacheWriteTokens: 0,
    });
  });

  it("ignores non-numeric cache fields", () => {
    expect(
      extractCacheUsage({
        cache_read_input_tokens: "300",
        cache_creation_input_tokens: null,
      }),
    ).toEqual({ cachedTokens: 0, cacheWriteTokens: 0 });
  });

  // W9: primitive non-object values should return zeros without throwing
  it("returns zeros when usage is a number", () => {
    expect(extractCacheUsage(42)).toEqual({
      cachedTokens: 0,
      cacheWriteTokens: 0,
    });
  });

  it("returns zeros when usage is a string", () => {
    expect(extractCacheUsage("some string")).toEqual({
      cachedTokens: 0,
      cacheWriteTokens: 0,
    });
  });
});
