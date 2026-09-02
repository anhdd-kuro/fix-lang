/**
 * @file prewarm.test.ts
 * @description Tests for the connection prewarmer: provider resolution from a
 * model ref (`resolveProviderForModelRef`, pure) and the never-throws,
 * never-blocks contract of `prewarmProviderConnection` itself. No Electron,
 * no real network — every store and the keep-alive fetch are mocked.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
// `vi.mock` calls below are hoisted above every import in this file by
// vitest's transform, regardless of where they sit textually — including
// above this import — so `prewarmProviderConnection` always sees the mocked
// dependencies.
// `prewarmProviderConnection` is deliberately NOT imported here: the
// `prewarmProviderConnection` describe block loads it fresh per test via
// `vi.resetModules()` so its module-level `lastPrewarmAt` map cannot leak
// between tests. `resolveProviderForModelRef` is pure and safe to share.
import { resolveProviderForModelRef } from "./prewarm";
import type { Model } from "~/features/providers/shared/providers";

// ---------------------------------------------------------------------------
// Mocks — hoisted above every import above by vitest's transform.
// ---------------------------------------------------------------------------
const { getCachedModelsMock, keepAliveFetchMock, getCurrentProfileIdMock, getProfileSecretMock, getApiKeyMock } =
  vi.hoisted(() => ({
    getCachedModelsMock: vi.fn<() => Model[]>(),
    keepAliveFetchMock: vi.fn(),
    getCurrentProfileIdMock: vi.fn<() => string>(),
    getProfileSecretMock: vi.fn<() => Promise<string | null>>(),
    getApiKeyMock: vi.fn<() => Promise<string | null>>(),
  }));

vi.mock("~/main/ai.request/shared", () => ({
  getCachedModels: getCachedModelsMock,
}));
vi.mock("~/main/llm/httpKeepAlive", () => ({
  keepAliveFetch: keepAliveFetchMock,
}));
vi.mock("~/features/providers/store/apiStore", () => ({
  getCurrentProfileId: getCurrentProfileIdMock,
}));
vi.mock("~/features/providers/store/profileSecretStore", () => ({
  getProfileSecret: getProfileSecretMock,
}));
vi.mock("~/features/providers/store/apiKeyStore", () => ({
  getApiKey: getApiKeyMock,
}));

/**
 * A warm-up response stub. `arrayBuffer` is not decoration: `prewarm.ts`
 * drains the body so undici can hand the socket back to the pool, so a stub
 * without it would throw inside the warm and turn every "successful" prewarm
 * in these tests into a silently-failed one.
 */
const okWarmResponse = () => ({
  ok: true,
  status: 200,
  arrayBuffer: vi.fn<() => Promise<ArrayBuffer>>().mockResolvedValue(new ArrayBuffer(0)),
});

// ---------------------------------------------------------------------------
// resolveProviderForModelRef — pure, no mocking needed
// ---------------------------------------------------------------------------

describe("resolveProviderForModelRef", () => {
  const models: Model[] = [
    { id: "gpt-4o", name: "GPT-4o", created: 0, provider: "openai" },
    { id: "openai/gpt-4o", name: "GPT-4o", created: 0, provider: "openrouter" },
    { id: "llama3.2:3b", name: "Llama 3.2 3B", created: 0, local: { path: "/models/llama3.2" } },
  ];

  it("resolves an explicit provider prefix against the cached model list", () => {
    expect(resolveProviderForModelRef("openai::gpt-4o", models)).toBe("openai");
    expect(resolveProviderForModelRef("openrouter::openai/gpt-4o", models)).toBe("openrouter");
  });

  it("resolves a bare id by scanning provider order against the cache", () => {
    expect(resolveProviderForModelRef("gpt-4o", models)).toBe("openai");
  });

  it("resolves a local provider ref (ollama) so callers can decide to skip it", () => {
    expect(resolveProviderForModelRef("ollama::llama3.2:3b", models)).toBe("ollama");
  });

  it("falls back to the ref's own prefix when the model cache has no match yet", () => {
    // An explicit prefix names its provider even before that provider's model
    // list has ever been fetched — must not silently disable prewarming.
    expect(resolveProviderForModelRef("openai::some-new-model", [])).toBe("openai");
  });

  it("returns null for a bare id with no cache match and no prefix", () => {
    expect(resolveProviderForModelRef("totally-unknown-model", [])).toBeNull();
  });

  it("returns null for the empty (inherit) ref", () => {
    expect(resolveProviderForModelRef("", models)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// prewarmProviderConnection — never throws, never blocks, skips what it should
// ---------------------------------------------------------------------------

describe("prewarmProviderConnection", () => {
  /**
   * Loaded fresh per test via `vi.resetModules()`, matching the idiom in
   * `ai.request/model-display-cache.test.ts`. `prewarm.ts` keeps a
   * module-level `lastPrewarmAt` map so a burst of hotkey presses does not
   * re-warm an already-pooled socket; a shared module graph would leak one
   * test's recorded warm into the next and silently suppress its fetch.
   */
  let prewarmProviderConnection: (modelRef: string) => void;

  beforeEach(async () => {
    vi.clearAllMocks();
    getCachedModelsMock.mockReturnValue([]);
    getCurrentProfileIdMock.mockReturnValue("profile-1");
    getProfileSecretMock.mockResolvedValue("sk-test-openai-key");
    getApiKeyMock.mockResolvedValue("sk-or-test-key");
    keepAliveFetchMock.mockResolvedValue(okWarmResponse());

    vi.resetModules();
    prewarmProviderConnection = (await import("./prewarm")).prewarmProviderConnection;
  });

  it("is synchronous to call and never throws for a normal ref", () => {
    expect(() => prewarmProviderConnection("openai::gpt-4o")).not.toThrow();
  });

  it("never throws for garbage input", () => {
    expect(() => prewarmProviderConnection("")).not.toThrow();
    expect(() => prewarmProviderConnection("not::a::valid::ref")).not.toThrow();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- deliberately wrong type at a runtime boundary
    expect(() => prewarmProviderConnection(null as any)).not.toThrow();
  });

  it("warms OpenAI with an authenticated, non-completion GET when a key is present", async () => {
    prewarmProviderConnection("openai::gpt-4o");
    await vi.waitFor(() => expect(keepAliveFetchMock).toHaveBeenCalledTimes(1));

    const [url, init] = keepAliveFetchMock.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/models");
    expect(init.method).toBe("GET");
    expect(init.headers.Authorization).toBe("Bearer sk-test-openai-key");
  });

  it("warms Anthropic with x-api-key and a pinned version, not a bearer token", async () => {
    // Kills: copying the OpenAI warm-up. Anthropic 401s a bearer token and
    // 400s a request with no `anthropic-version`, so either slip warms nothing
    // while still looking like a successful prewarm.
    prewarmProviderConnection("anthropic::claude-opus-4-5-20251101");
    await vi.waitFor(() => expect(keepAliveFetchMock).toHaveBeenCalledTimes(1));

    const [url, init] = keepAliveFetchMock.mock.calls[0];
    expect(url).toBe("https://api.anthropic.com/v1/models");
    expect(init.method).toBe("GET");
    expect(init.headers["x-api-key"]).toBe("sk-test-openai-key");
    expect(init.headers["anthropic-version"]).toBe("2023-06-01");
    expect(init.headers.Authorization).toBeUndefined();
  });

  it("warms OpenRouter via the tiny /credits endpoint, not the multi-MB model list", async () => {
    prewarmProviderConnection("openrouter::openai/gpt-4o");
    await vi.waitFor(() => expect(keepAliveFetchMock).toHaveBeenCalledTimes(1));

    const [url] = keepAliveFetchMock.mock.calls[0];
    // The body has to be drained to free the socket, so the endpoint must be
    // cheap — /models would download megabytes per hotkey press.
    expect(url).toBe("https://openrouter.ai/api/v1/credits");
  });

  it("drains the response body so undici can pool the socket", async () => {
    const response = okWarmResponse();
    keepAliveFetchMock.mockResolvedValue(response);

    prewarmProviderConnection("openai::gpt-4o");

    // Without this the connection stays outstanding and the real completion
    // opens a second one — the prewarm would hold a socket, not hand one over.
    await vi.waitFor(() => expect(response.arrayBuffer).toHaveBeenCalledTimes(1));
  });

  it("skips local providers (Ollama) entirely — no fetch, loopback buys nothing", async () => {
    prewarmProviderConnection("ollama::llama3.2:3b");
    // Give any stray microtask a chance to run before asserting the negative.
    await Promise.resolve();
    await Promise.resolve();
    expect(keepAliveFetchMock).not.toHaveBeenCalled();
  });

  it("skips local providers (LM Studio) entirely", async () => {
    prewarmProviderConnection("lmstudio::some-model");
    await Promise.resolve();
    await Promise.resolve();
    expect(keepAliveFetchMock).not.toHaveBeenCalled();
  });

  it("skips an unresolvable ref without calling fetch", async () => {
    prewarmProviderConnection("totally-unknown-model");
    await Promise.resolve();
    await Promise.resolve();
    expect(keepAliveFetchMock).not.toHaveBeenCalled();
  });

  it("does nothing when no OpenAI key is stored — nothing useful to warm", async () => {
    getProfileSecretMock.mockResolvedValue(null);
    prewarmProviderConnection("openai::gpt-4o");
    await Promise.resolve();
    await Promise.resolve();
    expect(keepAliveFetchMock).not.toHaveBeenCalled();
  });

  it("swallows a fetch rejection instead of raising an unhandled rejection", async () => {
    keepAliveFetchMock.mockRejectedValue(new Error("ECONNREFUSED"));

    expect(() => prewarmProviderConnection("openai::gpt-4o")).not.toThrow();
    await vi.waitFor(() => expect(keepAliveFetchMock).toHaveBeenCalledTimes(1));
    // No assertion beyond "the test process is still alive" — an unhandled
    // rejection here would fail the whole suite, not just this test.
  });

  it("never rejects — prewarmProviderConnection returns void, not a Promise", () => {
    const result = prewarmProviderConnection("openai::gpt-4o");
    expect(result).toBeUndefined();
  });

  it("skips a second warm within the TTL — a pooled socket needs no round trip", async () => {
    prewarmProviderConnection("openai::gpt-4o");
    await vi.waitFor(() => expect(keepAliveFetchMock).toHaveBeenCalledTimes(1));

    prewarmProviderConnection("openai::gpt-4o");
    prewarmProviderConnection("openai::gpt-4o");
    await Promise.resolve();
    await Promise.resolve();

    expect(keepAliveFetchMock).toHaveBeenCalledTimes(1);
  });

  it("warms again once the TTL has elapsed", async () => {
    prewarmProviderConnection("openai::gpt-4o");
    await vi.waitFor(() => expect(keepAliveFetchMock).toHaveBeenCalledTimes(1));

    // Past the 60s window: the pooled socket can no longer be assumed alive.
    // A `Date.now` spy rather than fake timers — `vi.useFakeTimers` would also
    // stall `vi.waitFor`'s own polling.
    const realNow = Date.now();
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(realNow + 61_000);
    prewarmProviderConnection("openai::gpt-4o");

    await vi.waitFor(() => expect(keepAliveFetchMock).toHaveBeenCalledTimes(2));
    nowSpy.mockRestore();
  });

  it("tracks the TTL per provider — warming OpenAI does not suppress OpenRouter", async () => {
    prewarmProviderConnection("openai::gpt-4o");
    await vi.waitFor(() => expect(keepAliveFetchMock).toHaveBeenCalledTimes(1));

    prewarmProviderConnection("openrouter::openai/gpt-4o");
    await vi.waitFor(() => expect(keepAliveFetchMock).toHaveBeenCalledTimes(2));

    expect(keepAliveFetchMock.mock.calls.map(([url]) => url)).toEqual([
      "https://api.openai.com/v1/models",
      "https://openrouter.ai/api/v1/credits",
    ]);
  });

  it("does not record a failed warm — one transient error must not disable the window", async () => {
    keepAliveFetchMock.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    prewarmProviderConnection("openai::gpt-4o");
    await vi.waitFor(() => expect(keepAliveFetchMock).toHaveBeenCalledTimes(1));

    keepAliveFetchMock.mockResolvedValue(okWarmResponse());
    prewarmProviderConnection("openai::gpt-4o");

    await vi.waitFor(() => expect(keepAliveFetchMock).toHaveBeenCalledTimes(2));
  });
});
