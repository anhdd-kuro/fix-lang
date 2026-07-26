/**
 * @file monitor.test.ts
 * @description Tests for the background local-model monitor: it must not poll
 * a provider the user has not connected, must not write the legacy top-level
 * `models` key, and must not report a removal it cannot verify. Pure unit
 * tests — no Electron, no network.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
// Mocks must be hoisted above the module under test.
const {
  apiStoreGetMock,
  apiStoreSetMock,
  getProfileSettingMock,
  fetchAvailableModelsMock,
  getCachedModelsMock,
  probeOllamaMock,
  getAllWindowsMock,
  sendMock,
} = vi.hoisted(() => ({
  apiStoreGetMock: vi.fn(),
  apiStoreSetMock: vi.fn(),
  getProfileSettingMock: vi.fn(),
  fetchAvailableModelsMock: vi.fn(),
  getCachedModelsMock: vi.fn(),
  probeOllamaMock: vi.fn(),
  getAllWindowsMock: vi.fn(),
  sendMock: vi.fn(),
}));
vi.mock("electron", () => ({
  app: { on: vi.fn() },
  BrowserWindow: { getAllWindows: getAllWindowsMock },
}));
vi.mock("~/stores/apiStore", () => ({
  apiStore: { get: apiStoreGetMock, set: apiStoreSetMock },
  getProfileSetting: getProfileSettingMock,
}));
vi.mock("~/main/ai.request/shared", () => ({
  fetchAvailableModels: fetchAvailableModelsMock,
  getCachedModels: getCachedModelsMock,
}));
vi.mock("./discover", () => ({ probeOllama: probeOllamaMock }));
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

/** A daemon that answered, with exactly these models pulled. */
const pulled = (...models: Model[]) =>
  probeOllamaMock.mockResolvedValue({ reachable: true, models });

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  getCachedModelsMock.mockReturnValue([]);
  pulled();
  fetchAvailableModelsMock.mockResolvedValue([]);
  getAllWindowsMock.mockReturnValue([{ webContents: { send: sendMock } }]);
  enable("openai", "openrouter", "ollama");
});

describe("checkForModelChanges — gates on enabledProviders", () => {
  // The gate must precede the poll, or a user who never connected Ollama still
  // hits the local daemon every five minutes.
  it("does not poll Ollama at all when it is not a connected provider", async () => {
    enable("openai", "openrouter");

    await checkForModelChanges();

    expect(probeOllamaMock).not.toHaveBeenCalled();
    expect(fetchAvailableModelsMock).not.toHaveBeenCalled();
    expect(apiStoreSetMock).not.toHaveBeenCalled();
  });

  it("does not poll when no provider is connected at all", async () => {
    enable();

    await checkForModelChanges();

    expect(probeOllamaMock).not.toHaveBeenCalled();
  });

  it("polls when Ollama is connected alongside other providers", async () => {
    enable("openrouter", "ollama");

    await checkForModelChanges();

    expect(probeOllamaMock).toHaveBeenCalledTimes(1);
  });

  it("tolerates a missing/garbled enabledProviders without throwing", async () => {
    getProfileSettingMock.mockReturnValue(undefined);

    await expect(checkForModelChanges()).resolves.toBeUndefined();
    expect(probeOllamaMock).not.toHaveBeenCalled();
  });
});

describe("checkForModelChanges — profile cache, not the legacy top-level key", () => {
  it("never writes the top-level `models` key", async () => {
    // That global key no longer backs anything; writing it clobbers state for
    // every other profile.
    getCachedModelsMock.mockReturnValue([]);
    pulled(localModel("llama3.2:3b"));
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
    pulled(localModel("llama3.2:3b"));

    await checkForModelChanges();

    expect(fetchAvailableModelsMock).toHaveBeenCalledWith("", "ollama", true);
  });

  it("compares against the cached Ollama slice, not the whole cache", async () => {
    // A cloud model in the cache must not read as a "removed" local model.
    getCachedModelsMock.mockReturnValue([localModel("llama3.2:3b")]);
    pulled(localModel("llama3.2:3b"));

    await checkForModelChanges();

    expect(getCachedModelsMock).toHaveBeenCalledWith("ollama");
    // Identical sets → nothing changed → no refetch.
    expect(fetchAvailableModelsMock).not.toHaveBeenCalled();
  });

  it("refetches when a model appears", async () => {
    getCachedModelsMock.mockReturnValue([]);
    pulled(localModel("llama3.2:3b"));

    await checkForModelChanges();

    expect(fetchAvailableModelsMock).toHaveBeenCalledTimes(1);
  });

  it("refetches when a model disappears", async () => {
    getCachedModelsMock.mockReturnValue([localModel("llama3.2:3b")]);
    pulled();

    await checkForModelChanges();

    expect(fetchAvailableModelsMock).toHaveBeenCalledTimes(1);
  });

  it("swallows a poll failure instead of rejecting", async () => {
    // `probeOllama` reports failure rather than throwing, but the monitor is
    // a periodic timer callback — nothing above it catches.
    probeOllamaMock.mockRejectedValue(new Error("daemon down"));

    await expect(checkForModelChanges()).resolves.toBeUndefined();
  });
});

describe("checkForModelChanges — an unreachable daemon is not a removal", () => {
  const cached = [localModel("llama3.2:3b"), localModel("qwen2.5-coder:7b")];

  beforeEach(() => {
    getCachedModelsMock.mockReturnValue(cached);
    probeOllamaMock.mockResolvedValue({
      reachable: false,
      models: [],
      error: "connect ECONNREFUSED 127.0.0.1:11434",
    });
  });

  it("tells the renderer nothing when the probe could not reach Ollama", async () => {
    // `[]` from a down daemon looks exactly like "the user deleted everything",
    // and this fires every five minutes for as long as the daemon is off.
    await checkForModelChanges();

    expect(sendMock).not.toHaveBeenCalled();
  });

  it("does not refetch either — there is nothing trustworthy to persist", async () => {
    await checkForModelChanges();

    expect(fetchAvailableModelsMock).not.toHaveBeenCalled();
  });

  it("still announces a genuine removal when the daemon answers", async () => {
    // The positive control: without it, "sends nothing" passes by doing nothing.
    pulled(localModel("llama3.2:3b"));

    await checkForModelChanges();

    expect(sendMock).toHaveBeenCalledWith("models-updated", {
      added: 0,
      removed: 1,
    });
  });
});
