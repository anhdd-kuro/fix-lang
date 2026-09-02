/**
 * @file model-fetch-logging.test.ts
 * @description A failed model fetch is logged so a rejected key can be told
 * apart from a provider outage — and the log line must survive the provider's
 * habit of quoting the submitted key back inside the 401 body.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
const { openAIModelsListMock, getLocalModelsMock, probeOllamaMock, entries } = vi.hoisted(
  () => ({
    openAIModelsListMock: vi.fn(),
    getLocalModelsMock: vi.fn().mockResolvedValue([]),
    probeOllamaMock: vi.fn().mockResolvedValue({ reachable: true, models: [] }),
    entries: [] as {
      level: LogLevel;
      scope: string;
      message: string;
      context?: LogContext;
    }[],
  }),
);
vi.mock("~/main/logging/logService", () => {
  const record =
    (level: LogLevel) => (scope: string, message: string, context?: LogContext) => {
      entries.push({ level, scope, message, context });
    };
  return {
    logger: {
      debug: record("debug"),
      info: record("info"),
      warn: record("warn"),
      error: record("error"),
    },
  };
});
vi.mock("electron-store", () => {
  class MockStore {
    private data: Record<string, unknown> = {};
    get(key: string, defaultValue?: unknown) {
      return key in this.data ? this.data[key] : defaultValue;
    }
    set(key: string, value: unknown) {
      this.data[key] = value;
    }
    store = {};
    onDidChange = vi.fn();
    watch = vi.fn();
  }
  return { default: MockStore };
});
vi.mock("electron", () => ({
  app: {
    isReady: vi.fn().mockReturnValue(true),
    getPath: vi.fn().mockReturnValue("/tmp"),
    once: vi.fn(),
  },
  Notification: class {
    show = vi.fn();
    on = vi.fn().mockReturnThis();
  },
}));
vi.mock("~/main/webViewWindows/errorPopupWindow", () => ({
  showErrorPopup: vi.fn(),
}));
vi.mock("@openrouter/ai-sdk-provider", () => ({
  createOpenRouter: vi.fn(() => vi.fn(() => ({ provider: "openrouter" }))),
}));
vi.mock("@ai-sdk/openai", () => ({ createOpenAI: vi.fn(() => ({ chat: vi.fn() })) }));
vi.mock("ai", () => ({ generateText: vi.fn() }));
vi.mock("openai", () => ({
  OpenAI: class {
    models = { list: openAIModelsListMock };
  },
}));
vi.mock("~/features/providers/store/apiKeyStore", () => ({
  getApiKey: vi.fn().mockResolvedValue("test-api-key"),
}));
vi.mock("~/features/providers/store/profileSecretStore", () => ({
  getProfileSecret: vi.fn().mockResolvedValue(null),
}));
vi.mock("~/main/llm/models/discover", () => ({
  getLocalModels: getLocalModelsMock,
  probeOllama: probeOllamaMock,
}));
vi.mock("~/main/llm/providers/ollama/client", () => ({
  createOllamaClient: () => ({ chat: vi.fn() }), ollamaClient: { chat: vi.fn() },
}));
import { redactLogContext } from "~/features/logs/shared/logging";
import { fetchAvailableModels } from "./shared";
import type { LogContext, LogLevel } from "~/features/logs/shared/logging";

const OPENAI_KEY = "sk-proj-realkeymaterial0123456789";

beforeEach(() => {
  entries.length = 0;
  vi.clearAllMocks();
});

describe("model-list fetch logging", () => {
  it("records the key shape on success, never the key", async () => {
    openAIModelsListMock.mockResolvedValue({ data: [{ id: "gpt-5" }] });

    await fetchAvailableModels(OPENAI_KEY, "openai", false);

    const [fetched] = entries.filter((entry) => entry.scope === "provider.models");
    expect(fetched?.context).toMatchObject({
      provider: "openai",
      keyPresent: true,
      keyShape: "openai-project",
    });
    expect(JSON.stringify(entries)).not.toContain(OPENAI_KEY);
  });

  it("strips the key out of the provider's own 401 echo", async () => {
    // A SHORT visible prefix on purpose: `sk-abc12` is five characters past the
    // prefix, one short of what the `sk-…` pattern needs, so this exact form is
    // what used to survive into the persisted log. The echo is deliberately not
    // a substring of the key either, so only the masked-run pass can catch it.
    const legacyKey = "sk-abc12longlegacykeyvalue";
    openAIModelsListMock.mockRejectedValue(
      new Error(
        "Incorrect API key provided: sk-abc12*********value. You can find your API key at https://platform.openai.com/account/api-keys.",
      ),
    );

    await fetchAvailableModels(legacyKey, "openai", false);

    const [failure] = entries.filter((entry) => entry.level === "warn");
    expect(failure?.scope).toBe("provider.models");
    // `logService.log` runs this over every entry before it touches disk.
    const persisted = JSON.stringify(redactLogContext(failure?.context ?? {}));
    expect(persisted).not.toContain("sk-abc12");
    expect(persisted).toContain("Incorrect API key provided");
  });

  it("removes a local key with no recognizable prefix from the same echo", async () => {
    // LM Studio's optional key matches no `sk-…` pattern, so the shared
    // redaction cannot see it — the exact-value strip is what covers it.
    const localKey = "lmstudio-local-secret";
    openAIModelsListMock.mockRejectedValue(
      new Error(`Unauthorized for key ${localKey}`),
    );

    await fetchAvailableModels(localKey, "openai", false);

    expect(JSON.stringify(entries)).not.toContain(localKey);
  });

  it("says a key was absent rather than inventing a shape", async () => {
    await fetchAvailableModels("", "openai", false);

    const [fetched] = entries.filter((entry) => entry.scope === "provider.models");
    expect(fetched?.context?.keyPresent).toBe(false);
    expect(fetched?.context?.keyShape).toBeUndefined();
  });
});
