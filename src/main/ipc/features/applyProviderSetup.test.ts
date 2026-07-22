/**
 * @file applyProviderSetup.test.ts
 * @description M1 regression test: Apply must FAIL when the live model fetch
 * used for validation throws (e.g. a stale/revoked key), even though models
 * for that provider are still present in the cache. Before the fix,
 * `fetchAvailableModels` swallowed the fetch error and returned the cached
 * list, letting a bad key "pass" validation and Apply silently succeed.
 *
 * This captures the real `apply-provider-setup` handler registered by
 * `registerApiHandlers` (via a stub `ipcMain.handle`) and invokes it
 * directly, so the test exercises the actual handler wiring — not just the
 * underlying `fetchAvailableModels` primitive (covered separately in
 * `../ai.request/model-cache.test.ts`).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
const { fetchAvailableModelsMock, commitActiveProfileProviderSetupMock } = vi.hoisted(() => ({
  fetchAvailableModelsMock: vi.fn(),
  commitActiveProfileProviderSetupMock: vi.fn(),
}));
const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
vi.mock("electron", () => ({
  ipcMain: {
    handle: (channel: string, listener: (event: unknown, ...args: unknown[]) => unknown) => {
      handlers.set(channel, listener);
    },
    on: vi.fn(),
  },
}));
vi.mock("~/main/ai.request", () => ({
  fetchAvailableModels: fetchAvailableModelsMock,
  getActiveProvider: vi.fn().mockReturnValue("openai"),
}));
vi.mock("~/main/keybindings", () => ({
  reloadHotkeys: vi.fn(),
}));
vi.mock("~/main/llm", () => ({
  ollamaClient: { pull: vi.fn(), delete: vi.fn(), chat: vi.fn() },
}));
vi.mock("~/main/llm/models/compatibility", () => ({
  checkModelCompatibility: vi.fn(),
}));
vi.mock("~/main/llm/models/recommended", () => ({
  findRecommendedModel: vi.fn(),
  getRecommendedModels: vi.fn(),
}));
vi.mock("~/stores/apiKeyStore", () => ({
  clearApiKey: vi.fn(),
  getApiKey: vi.fn(),
  hasApiKey: vi.fn(),
  setApiKey: vi.fn(),
}));
// isProviderId/isModelForProvider need real-ish behavior so the handler's own
// validation logic runs faithfully; everything else is a plain mock.
vi.mock("~/stores/apiStore", () => ({
  isProviderId: (value: unknown): boolean =>
    value === "openai" || value === "openrouter" || value === "ollama",
  isModelForProvider: (
    model: { provider?: string; local?: unknown },
    provider: string,
  ): boolean =>
    provider === "ollama"
      ? model.provider === "ollama" || model.local !== undefined
      : model.provider === provider ||
        (provider === "openrouter" && model.provider === undefined && !model.local),
  commitActiveProfileProviderSetup: commitActiveProfileProviderSetupMock,
  getCurrentProfileId: vi.fn().mockReturnValue("profile_1"),
  getDefaultModelId: vi.fn(),
  getProfileSetting: vi.fn(),
  resetCurrentProfileSettings: vi.fn(),
  updateProfileSetting: vi.fn(),
}));
vi.mock("~/stores/keybindingStore", () => ({
  keybindingStore: { resetKeyBindings: vi.fn() },
}));
// The profile already has a saved (now stale/revoked) OpenAI key on file —
// this is the "re-apply / switch back to a previously-configured provider"
// scenario from M1: no new key is typed, so getSetupApiKey falls back to it.
vi.mock("~/stores/profileSecretStore", () => ({
  getProfileSecret: vi.fn().mockResolvedValue("sk-stale-revoked-key"),
  hasProfileSecret: vi.fn().mockResolvedValue(true),
  setProfileSecret: vi.fn().mockResolvedValue({ success: true }),
}));
// Import (after mocks) — registers the real handlers into the `handlers` map.
import { registerApiHandlers } from "./api";

describe("apply-provider-setup — M1: stale key must fail Apply, not pass via cache", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    handlers.clear();
    registerApiHandlers();
  });

  it("fails Apply when the live fetch throws, even though the provider has cached models", async () => {
    // Cached models exist for openai from a previously successful setup —
    // this is exactly what let a stale key silently "pass" before the fix.
    const cachedModels = [
      { id: "openai/gpt-4o", name: "gpt-4o", created: 1, provider: "openai" },
    ];
    // strict fetch (as wired in api.ts) now rejects instead of returning cache.
    fetchAvailableModelsMock.mockImplementation(
      async (_key: string, _provider: string, _persist: boolean, strict?: boolean) => {
        if (strict) {
          throw new Error("401 Unauthorized");
        }
        return cachedModels;
      },
    );

    const applyHandler = handlers.get("apply-provider-setup");
    expect(applyHandler).toBeTypeOf("function");

    const result = (await applyHandler?.(undefined, {
      provider: "openai",
      modelId: "openai/gpt-4o",
    })) as { success: boolean; error?: string };

    expect(result.success).toBe(false);
    expect(result.error).toContain("401 Unauthorized");
    // The validated live-fetch call must have been made in strict mode.
    expect(fetchAvailableModelsMock).toHaveBeenCalledWith(
      "sk-stale-revoked-key",
      "openai",
      false,
      true,
    );
    // Nothing must be committed when validation fails.
    expect(commitActiveProfileProviderSetupMock).not.toHaveBeenCalled();
  });

  it("succeeds when the live fetch resolves (control case)", async () => {
    const cachedModels = [
      { id: "openai/gpt-4o", name: "gpt-4o", created: 1, provider: "openai" },
    ];
    fetchAvailableModelsMock.mockResolvedValue(cachedModels);
    commitActiveProfileProviderSetupMock.mockReturnValue({ id: "profile_1" });

    const applyHandler = handlers.get("apply-provider-setup");
    const result = (await applyHandler?.(undefined, {
      provider: "openai",
      modelId: "openai/gpt-4o",
    })) as { success: boolean; error?: string };

    expect(result.success).toBe(true);
    expect(commitActiveProfileProviderSetupMock).toHaveBeenCalled();
  });
});
