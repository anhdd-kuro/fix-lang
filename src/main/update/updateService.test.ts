import { describe, expect, it, vi } from "vitest";
import { createUpdateService } from "./updateService";

type UpdaterListener = (...args: unknown[]) => void;

/**
 * Minimal event-driven updater double. It deliberately resembles the public
 * subset FixLang needs from electron-updater without loading Electron in Vitest.
 */
const createFakeUpdater = () => {
  const listeners = new Map<string, UpdaterListener[]>();
  const updater = {
    autoDownload: true,
    autoInstallOnAppQuit: true,
    allowPrerelease: true,
    allowDowngrade: true,
    on: vi.fn((event: string, listener: UpdaterListener) => {
      const existing = listeners.get(event) ?? [];
      existing.push(listener);
      listeners.set(event, existing);
    }),
    checkForUpdates: vi.fn<() => Promise<void>>().mockResolvedValue(),
    downloadUpdate: vi.fn<() => Promise<void>>().mockResolvedValue(),
    quitAndInstall: vi.fn<() => void>(),
  };

  return {
    updater,
    emit: (event: string, ...args: unknown[]): void => {
      for (const listener of listeners.get(event) ?? []) {
        listener(...args);
      }
    },
  };
};

const createService = (
  overrides: Partial<{
    isPackaged: boolean;
    platform: string;
    getCurrentVersion: () => string;
    onLog: (level: "info" | "warn" | "error", message: string) => void;
  }> = {},
) => {
  const fakeUpdater = createFakeUpdater();
  const service = createUpdateService({
    updater: fakeUpdater.updater,
    isPackaged: overrides.isPackaged ?? true,
    platform: overrides.platform ?? "darwin",
    getCurrentVersion: overrides.getCurrentVersion ?? (() => "0.1.0"),
    onLog: overrides.onLog,
  });

  return { service, ...fakeUpdater };
};

describe("update service", () => {
  it("does not contact GitHub from development builds", async () => {
    const { service, updater } = createService({ isPackaged: false });

    expect(service.getState()).toMatchObject({
      phase: "unsupported",
      currentVersion: "0.1.0",
    });

    await service.checkForUpdates();

    expect(updater.checkForUpdates).not.toHaveBeenCalled();
  });

  it("does not enable the macOS updater on unsupported platforms", async () => {
    const { service, updater } = createService({ platform: "win32" });

    await service.checkForUpdates();

    expect(service.getState()).toMatchObject({ phase: "unsupported" });
    expect(updater.checkForUpdates).not.toHaveBeenCalled();
  });

  it("configures a packaged macOS release for explicit stable updates", () => {
    const { updater } = createService();

    expect(updater.autoDownload).toBe(false);
    expect(updater.autoInstallOnAppQuit).toBe(false);
    expect(updater.allowPrerelease).toBe(false);
    expect(updater.allowDowngrade).toBe(false);
  });

  it("reports an available release and its notes after a manual check", async () => {
    const { service, updater, emit } = createService();

    const check = service.checkForUpdates();
    expect(service.getState()).toMatchObject({ phase: "checking" });

    emit("update-available", {
      version: "0.2.0",
      releaseNotes: "Improved update reliability.",
    });
    await check;

    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);
    expect(service.getState()).toMatchObject({
      phase: "available",
      currentVersion: "0.1.0",
      availableVersion: "0.2.0",
      releaseNotes: "Improved update reliability.",
    });
  });

  it("reports that the installed release is up to date", async () => {
    const { service, emit } = createService();

    const check = service.checkForUpdates();
    emit("update-not-available", { version: "0.1.0" });
    await check;

    expect(service.getState()).toMatchObject({
      phase: "up-to-date",
      currentVersion: "0.1.0",
    });
  });

  it("prevents duplicate update checks while the first check is active", async () => {
    let resolveCheck: (() => void) | undefined;
    const pendingCheck = new Promise<void>((resolve) => {
      resolveCheck = resolve;
    });
    const { service, updater } = createService();
    updater.checkForUpdates.mockReturnValueOnce(pendingCheck);

    const firstCheck = service.checkForUpdates();
    const secondCheck = service.checkForUpdates();

    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);

    resolveCheck?.();
    await Promise.all([firstCheck, secondCheck]);
  });

  it("does not download before an update has been offered", async () => {
    const { service, updater } = createService();

    await service.downloadUpdate();

    expect(updater.downloadUpdate).not.toHaveBeenCalled();
    expect(service.getState()).toMatchObject({ phase: "idle" });
  });

  it("surfaces download progress and becomes ready only after the archive finishes", async () => {
    const { service, updater, emit } = createService();
    emit("update-available", { version: "0.2.0" });

    const download = service.downloadUpdate();
    expect(service.getState()).toMatchObject({ phase: "downloading" });

    emit("download-progress", {
      percent: 42.5,
      transferred: 425,
      total: 1000,
      bytesPerSecond: 120,
    });
    expect(service.getState()).toMatchObject({
      phase: "downloading",
      progress: {
        percent: 42.5,
        transferred: 425,
        total: 1000,
        bytesPerSecond: 120,
      },
    });

    emit("update-downloaded", { version: "0.2.0" });
    await download;

    expect(updater.downloadUpdate).toHaveBeenCalledTimes(1);
    expect(service.getState()).toMatchObject({
      phase: "downloaded",
      availableVersion: "0.2.0",
    });
  });

  it("prevents duplicate downloads while a download is active", async () => {
    let resolveDownload: (() => void) | undefined;
    const pendingDownload = new Promise<void>((resolve) => {
      resolveDownload = resolve;
    });
    const { service, updater, emit } = createService();
    emit("update-available", { version: "0.2.0" });
    updater.downloadUpdate.mockReturnValueOnce(pendingDownload);

    const firstDownload = service.downloadUpdate();
    const secondDownload = service.downloadUpdate();

    expect(updater.downloadUpdate).toHaveBeenCalledTimes(1);

    resolveDownload?.();
    await Promise.all([firstDownload, secondDownload]);
  });

  it("installs only an already-downloaded update", () => {
    const { service, updater, emit } = createService();

    service.installUpdate();
    expect(updater.quitAndInstall).not.toHaveBeenCalled();

    emit("update-available", { version: "0.2.0" });
    emit("update-downloaded", { version: "0.2.0" });
    service.installUpdate();

    expect(updater.quitAndInstall).toHaveBeenCalledTimes(1);
  });

  it("turns updater failures into a retryable, user-safe error state", async () => {
    const onLog = vi.fn();
    const { service, emit } = createService({ onLog });
    const sensitiveError = new Error(
      "request failed at https://private.example/releases?token=secret " +
        "using /Users/kuro/Library/Caches/fixlang/pending.zip",
    );

    const check = service.checkForUpdates();
    emit("error", sensitiveError);
    await check;

    const state = service.getState();
    expect(state.phase).toBe("error");
    expect(state.message).toMatch(/try again/i);
    expect(state.message).not.toContain("private.example");
    expect(onLog).toHaveBeenCalledWith(
      "warn",
      "App update check failed (Error)",
    );
    const persistedLogInput = JSON.stringify(onLog.mock.calls);
    expect(persistedLogInput).not.toContain("private.example");
    expect(persistedLogInput).not.toContain("token=secret");
    expect(persistedLogInput).not.toContain("/Users/kuro");
    expect(persistedLogInput).not.toContain("pending.zip");
  });

  it("handles an updater error event and rejected operation only once", async () => {
    const onLog = vi.fn();
    const { service, updater, emit } = createService({ onLog });
    const phases: string[] = [];
    service.subscribe((state) => phases.push(state.phase));
    const failure = new Error("duplicated failure with /private/cache.zip");
    updater.checkForUpdates.mockImplementationOnce(async () => {
      emit("error", failure);
      throw failure;
    });

    await service.checkForUpdates();

    expect(onLog).toHaveBeenCalledTimes(1);
    expect(onLog).toHaveBeenCalledWith(
      "warn",
      "App update check failed (Error)",
    );
    expect(phases.filter((phase) => phase === "error")).toHaveLength(1);
  });

  it("notifies subscribers with the latest immutable state", () => {
    const { service, emit } = createService();
    const observed: string[] = [];
    const unsubscribe = service.subscribe((state) => observed.push(state.phase));

    emit("checking-for-update");
    emit("update-available", { version: "0.2.0" });
    unsubscribe();
    emit("download-progress", {
      percent: 1,
      transferred: 1,
      total: 100,
      bytesPerSecond: 1,
    });

    expect(observed).toEqual(["checking", "available"]);
  });
});
