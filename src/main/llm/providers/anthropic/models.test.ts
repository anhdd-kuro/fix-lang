import { beforeEach, describe, expect, it, vi } from "vitest";

const keepAliveFetchMock = vi.fn();

vi.mock("~/main/llm/httpKeepAlive", () => ({
  keepAliveFetch: keepAliveFetchMock,
}));

const { fetchAnthropicModels } = await import("./models");

const okResponse = (data: unknown) => ({
  ok: true,
  status: 200,
  json: () => Promise.resolve({ data }),
  text: () => Promise.resolve(""),
});

beforeEach(() => {
  keepAliveFetchMock.mockReset();
});

describe("fetchAnthropicModels", () => {
  it("authenticates with x-api-key and a pinned version, never a bearer token", async () => {
    // Anthropic 401s a bearer token and 400s a request with no
    // `anthropic-version` — either slip reads as "your key is invalid".
    keepAliveFetchMock.mockResolvedValue(okResponse([]));

    await fetchAnthropicModels("  sk-ant-api03-test  ");

    const [url, init] = keepAliveFetchMock.mock.calls[0];
    expect(String(url)).toContain("https://api.anthropic.com/v1/models");
    expect(init.method).toBe("GET");
    expect(init.headers["x-api-key"]).toBe("sk-ant-api03-test");
    expect(init.headers["anthropic-version"]).toBe("2023-06-01");
    expect(init.headers.Authorization).toBeUndefined();
    // Provider setup blocks the Connect button on this call.
    expect(init.signal).toBeDefined();
  });

  it("converts the ISO created_at into the epoch SECONDS every other provider reports", async () => {
    // Kills: passing `created_at` through, or dividing nothing — the model
    // picker sorts on `created` across providers, so milliseconds here would
    // pin every Anthropic model above every OpenAI one forever.
    keepAliveFetchMock.mockResolvedValue(
      okResponse([
        {
          id: "claude-opus-4-5-20251101",
          display_name: "Claude Opus 4.5",
          created_at: "2025-11-01T00:00:00Z",
        },
      ]),
    );

    const models = await fetchAnthropicModels("sk-ant-api03-test");

    expect(models).toEqual([
      {
        id: "claude-opus-4-5-20251101",
        name: "Claude Opus 4.5",
        created: Date.parse("2025-11-01T00:00:00Z") / 1000,
        provider: "anthropic",
      },
    ]);
  });

  it("falls back to the raw id when the display name is missing or empty", async () => {
    keepAliveFetchMock.mockResolvedValue(
      okResponse([
        { id: "claude-a", display_name: "", created_at: "2026-01-01T00:00:00Z" },
        { id: "claude-b", created_at: "2026-01-01T00:00:00Z" },
      ]),
    );

    const models = await fetchAnthropicModels("sk-ant-api03-test");

    expect(models.map((model) => model.name)).toEqual(["claude-a", "claude-b"]);
  });

  it("stamps 0 rather than NaN for an unparseable or absent created_at", async () => {
    // A NaN reaches the picker's date formatter and renders "Invalid Date".
    keepAliveFetchMock.mockResolvedValue(
      okResponse([
        { id: "claude-a", display_name: "A", created_at: "not-a-date" },
        { id: "claude-b", display_name: "B" },
      ]),
    );

    const models = await fetchAnthropicModels("sk-ant-api03-test");

    expect(models.map((model) => model.created)).toEqual([0, 0]);
  });

  it("drops an entry with no usable id instead of emitting a blank row", async () => {
    keepAliveFetchMock.mockResolvedValue(
      okResponse([{ id: "", display_name: "A" }, { display_name: "B" }, { id: "claude-a" }]),
    );

    const models = await fetchAnthropicModels("sk-ant-api03-test");

    expect(models.map((model) => model.id)).toEqual(["claude-a"]);
  });

  it("throws on a non-OK response rather than reporting an empty catalogue", async () => {
    // `fetchProviderModels` runs this strict during provider setup: a swallowed
    // 401 would let a revoked key connect with zero models and fail later.
    keepAliveFetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      text: () => Promise.resolve("invalid x-api-key"),
      json: () => Promise.resolve({}),
    });

    await expect(fetchAnthropicModels("sk-ant-api03-test")).rejects.toThrow(/401/);
  });

  it("tolerates a body with no data array", async () => {
    keepAliveFetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({}),
      text: () => Promise.resolve(""),
    });

    await expect(fetchAnthropicModels("sk-ant-api03-test")).resolves.toEqual([]);
  });

  it("tags every entry with its provider and ships no pricing", async () => {
    // An untagged entry formats as an `openrouter::` ref; a fabricated price
    // would make `computeCost` bill Anthropic requests from invented numbers.
    keepAliveFetchMock.mockResolvedValue(
      okResponse([{ id: "claude-a", display_name: "A", created_at: "2026-01-01T00:00:00Z" }]),
    );

    const [model] = await fetchAnthropicModels("sk-ant-api03-test");

    expect(model.provider).toBe("anthropic");
    expect(model.pricing).toBeUndefined();
  });
});
