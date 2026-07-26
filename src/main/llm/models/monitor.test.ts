/**
 * @file monitor.test.ts
 * @description Tests for the background local-model monitor: it must not poll
 * a provider the user has not connected, and must not write the legacy
 * top-level `models` key. Pure unit tests — no Electron, no network.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
// Mocks must be hoisted above the module under test.
const {
  apiStoreGetMock,
  apiStoreSetMock,
  getProfileSettingMock,
  fetchAvailableModelsMock,
  getCachedModelsMock,
  getLocalModelsMock,
} = vi.hoisted(() => ({
  apiStoreGetMock: vi.fn(),
  apiStoreSetMock: vi.fn(),
  getProfileSettingMock: vi.fn(),
  fetchAvailableModelsMock: vi.fn(),
  getCachedModelsMock: vi.fn(),
  getLocalModelsMock: vi.fn(),
}));
vi.mock("electron", () => ({
  app: { on: vi.fn() },
  BrowserWindow: { getAllWindows: vi.fn().mockReturnValue([]) },
}));
vi.mock("~/stores/apiStore", () => ({
  apiStore: { get: apiStoreGetMock, set: apiStoreSetMock },
  getProfileSetting: getProfileSettingMock,
}));
vi.mock("~/main/ai.request/shared", () => ({
  fetchAvailableModels: fetchAvailableModelsMock,
  getCachedModels: getCachedModelsMock,
}));
vi.mock("./discover", () => ({ getLocalModels: getLocalModelsMock }));
import { checkForModelChanges } from "./monitor";
import type { Model } from "~/stores/apiStore";

const localModel = (id: string): Model => ({
  id,
  name: id.split(":")[0],
  created: 0,
  provider: "ollama",
  local: { path: id, size: 1 },
});

/** Connected providers for the active profile. */
const enable = (...providers: string[]) => {
  getProfileSettingMock.mockImplementation((key: string) =>
    key === "enabledProviders" ? providers : undefined,
  );
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  getCachedModelsMock.mockReturnValue([]);
  getLocalModelsMock.mockResolvedValue([]);
  fetchAvailableModelsMock.mockResolvedValue([]);
  enable("openai", "openrouter", "ollama");
});

describe("checkForModelChanges — gates on enabledProviders", () => {
  // The gate must precede the poll, or a user who never connected Ollama still
  // hits the local daemon every five minutes.
  it("does not poll Ollama at all when it is not a connected provider", async () => {
    enable("openai", "openrouter");

    await checkForModelChanges();

    expect(getLocalModelsMock).not.toHaveBeenCalled();
    expect(fetchAvailableModelsMock).not.toHaveBeenCalled();
    expect(apiStoreSetMock).not.toHaveBeenCalled();
  });

  it("does not poll when no provider is connected at all", async () => {
    enable();

    await checkForModelChanges();

    expect(getLocalModelsMock).not.toHaveBeenCalled();
  });

  it("polls when Ollama is connected alongside other providers", async () => {
    enable("openrouter", "ollama");

    await checkForModelChanges();

    expect(getLocalModelsMock).toHaveBeenCalledTimes(1);
  });

  it("tolerates a missing/garbled enabledProviders without throwing", async () => {
    getProfileSettingMock.mockReturnValue(undefined);

    await expect(checkForModelChanges()).resolves.toBeUndefined();
    expect(getLocalModelsMock).not.toHaveBeenCalled();
  });
});

describe("checkForModelChanges — profile cache, not the legacy top-level key", () => {
  it("never writes the top-level `models` key", async () => {
    // That global key no longer backs anything; writing it clobbers state for
    // every other profile.
    getCachedModelsMock.mockReturnValue([]);
    getLocalModelsMock.mockResolvedValue([localModel("llama3.2:3b")]);
    fetchAvailableModelsMock.mockResolvedValue([localModel("llama3.2:3b")]);

    await checkForModelChanges();

    expect(fetchAvailableModelsMock).toHaveBeenCalled();
    expect(apiStoreSetMock).not.toHaveBeenCalled();
  });

  it("never reads the top-level `models` key either", async () => {
    await checkForModelChanges();

    expect(apiStoreGetMock).not.toHaveBeenCalled();
    expect(getCachedModelsMock).toHaveBeenCalled();
  });

  it("delegates persistence to fetchAvailableModels with persistCache true", async () => {
    // The only writer that keeps the other providers' slices intact.
    getLocalModelsMock.mockResolvedValue([localModel("llama3.2:3b")]);

    await checkForModelChanges();

    expect(fetchAvailableModelsMock).toHaveBeenCalledWith("", "ollama", true);
  });

  it("compares against the cached Ollama slice, not the whole cache", async () => {
    // A cloud model in the cache must not read as a "removed" local model.
    getCachedModelsMock.mockReturnValue([localModel("llama3.2:3b")]);
    getLocalModelsMock.mockResolvedValue([localModel("llama3.2:3b")]);

    await checkForModelChanges();

    expect(getCachedModelsMock).toHaveBeenCalledWith("ollama");
    // Identical sets → nothing changed → no refetch.
    expect(fetchAvailableModelsMock).not.toHaveBeenCalled();
  });

  it("refetches when a model appears", async () => {
    getCachedModelsMock.mockReturnValue([]);
    getLocalModelsMock.mockResolvedValue([localModel("llama3.2:3b")]);

    await checkForModelChanges();

    expect(fetchAvailableModelsMock).toHaveBeenCalledTimes(1);
  });

  it("refetches when a model disappears", async () => {
    getCachedModelsMock.mockReturnValue([localModel("llama3.2:3b")]);
    getLocalModelsMock.mockResolvedValue([]);

    await checkForModelChanges();

    expect(fetchAvailableModelsMock).toHaveBeenCalledTimes(1);
  });

  it("swallows a poll failure instead of rejecting", async () => {
    getLocalModelsMock.mockRejectedValue(new Error("daemon down"));

    await expect(checkForModelChanges()).resolves.toBeUndefined();
  });
});
