import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createLmStudioOpenAIClient,
  probeLmStudio,
  resolveLmStudioApiKey,
} from "./client";

const { modelsListMock, lastOpenAIOptions } = vi.hoisted(() => ({
  modelsListMock: vi.fn(),
  lastOpenAIOptions: {
    current: null as { baseURL?: string; apiKey?: string } | null,
  },
}));

vi.mock("openai", () => ({
  default: class OpenAI {
    models = { list: modelsListMock };
    constructor(options: { baseURL?: string; apiKey?: string }) {
      lastOpenAIOptions.current = options;
    }
  },
}));

describe("resolveLmStudioApiKey", () => {
  it("falls back to the lm-studio dummy key", () => {
    expect(resolveLmStudioApiKey(null)).toBe("lm-studio");
    expect(resolveLmStudioApiKey("")).toBe("lm-studio");
    expect(resolveLmStudioApiKey("  secret  ")).toBe("secret");
  });
});

describe("createLmStudioOpenAIClient", () => {
  it("points at the OpenAI-compatible /v1 base URL", () => {
    createLmStudioOpenAIClient({
      endpoint: { host: "127.0.0.1", port: 1234 },
      apiKey: null,
    });
    expect(lastOpenAIOptions.current?.baseURL).toBe("http://127.0.0.1:1234/v1");
    expect(lastOpenAIOptions.current?.apiKey).toBe("lm-studio");
  });
});

describe("probeLmStudio", () => {
  beforeEach(() => {
    modelsListMock.mockReset();
  });

  it("returns reachable models tagged lmstudio", async () => {
    modelsListMock.mockResolvedValue({
      data: [{ id: "local-model", created: 1 }],
    });
    const probe = await probeLmStudio({
      endpoint: { host: "127.0.0.1", port: 1234 },
    });
    expect(probe.reachable).toBe(true);
    expect(probe.models).toEqual([
      { id: "local-model", name: "local-model", created: 1, provider: "lmstudio" },
    ]);
  });

  it("returns unreachable on failure", async () => {
    modelsListMock.mockRejectedValue(new Error("ECONNREFUSED"));
    const probe = await probeLmStudio();
    expect(probe.reachable).toBe(false);
    expect(probe.models).toEqual([]);
    expect(probe.error).toContain("ECONNREFUSED");
  });
});
