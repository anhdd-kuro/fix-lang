import { describe, expect, it, vi } from "vitest";
import { msg } from "~/shared/i18n/message";
import { UPGRADE_GRACE_MS } from "./pendingInstall";
import { createUpdateService } from "./updateService";

/** Fixed clock so marker ages are exact rather than wall-clock dependent. */
const NOW = 1_700_000_000_000;

const stableRelease = (
  tagName = "v0.2.0",
  overrides: Record<string, unknown> = {},
): Record<string, unknown> => ({
  tag_name: tagName,
  name: `FixLang ${tagName}`,
  body: "Improved update reliability.",
  draft: false,
  prerelease: false,
  assets: [
    {
      name: `FixLang-${tagName.slice(1)}-arm64.dmg`,
      state: "uploaded",
      size: 1,
    },
  ],
  html_url: "https://malicious.example/update",
  ...overrides,
});

const createService = (
  overrides: Partial<{
    isPackaged: boolean;
    platform: string;
    arch: string;
    currentVersion: string;
    canInstall: boolean;
    startUpgrade: () => void;
    /** Version the tap can install; null models a brew that cannot be asked. */
    installableVersion: string | null;
    /** Versions already staged in the Caskroom. */
    installedVersions: readonly string[];
    /** Bytes reported as cached while the download is polled. */
    downloadedBytes: number | null;
    downloadUpdate: () => Promise<void>;
    pending: {
      fromVersion: string;
      toVersion: string;
      startedAt: number;
    } | null;
    now: () => number;
    getLatestRelease: () => Promise<unknown>;
    onLog: (level: "info" | "warn" | "error", message: string) => void;
  }> = {},
) => {
  const releaseSource = {
    getLatestRelease: vi
      .fn<() => Promise<unknown>>()
      .mockImplementation(
        overrides.getLatestRelease ??
          (() => Promise.resolve(stableRelease())),
      ),
  };
  const startUpgrade = vi.fn(overrides.startUpgrade);
  const getInstallableVersion = vi.fn<() => Promise<string | null>>(() =>
    Promise.resolve(
      overrides.installableVersion === undefined
        ? "0.2.0"
        : overrides.installableVersion,
    ),
  );
  const installedVersions = new Set(overrides.installedVersions ?? []);
  const isVersionInstalled = vi.fn((version: string) =>
    installedVersions.has(version),
  );
  const downloadUpdate = vi.fn<() => Promise<void>>(
    overrides.downloadUpdate ?? (() => Promise.resolve()),
  );
  const getDownloadedBytes = vi.fn<(version: string) => number | null>(
    () => overrides.downloadedBytes ?? null,
  );
  const pendingInstall = {
    read: vi.fn(() => overrides.pending ?? null),
    write: vi.fn(),
    clear: vi.fn(),
  };
  const quitApp = vi.fn();
  const relaunchApp = vi.fn();
  // Collected instead of timed: tests drive the poll by hand.
  const polls: (() => void)[] = [];
  const cancelPoll = vi.fn();
  const service = createUpdateService({
    releaseSource,
    isPackaged: overrides.isPackaged ?? true,
    platform: overrides.platform ?? "darwin",
    arch: overrides.arch ?? "arm64",
    getCurrentVersion: () => overrides.currentVersion ?? "0.1.0",
    upgrader: {
      canInstall: overrides.canInstall ?? false,
      getInstallableVersion,
      isVersionInstalled,
      downloadUpdate,
      getDownloadedBytes,
      startUpgrade,
    },
    pendingInstall,
    quitApp,
    relaunchApp,
    onLog: overrides.onLog,
    now: overrides.now ?? (() => NOW),
    schedulePoll: (run) => {
      polls.push(run);
      return cancelPoll;
    },
  });

  return {
    service,
    releaseSource,
    startUpgrade,
    getInstallableVersion,
    isVersionInstalled,
    downloadUpdate,
    getDownloadedBytes,
    installedVersions,
    pendingInstall,
    quitApp,
    relaunchApp,
    cancelPoll,
    /** Runs every scheduled poll once, as the real interval would. */
    tickPoll: () => {
      for (const run of [...polls]) run();
    },
  };
};

describe("unsigned GitHub update service", () => {
  it("does not contact GitHub from development builds", async () => {
    const { service, releaseSource } = createService({ isPackaged: false });

    expect(service.getState()).toMatchObject({
      phase: "unsupported",
      currentVersion: "0.1.0",
    });
    await service.checkForUpdates();

    expect(releaseSource.getLatestRelease).not.toHaveBeenCalled();
  });

  it("does not offer macOS artifacts on unsupported platforms", async () => {
    const { service, releaseSource } = createService({ platform: "win32" });

    await service.checkForUpdates();

    expect(service.getState().phase).toBe("unsupported");
    expect(releaseSource.getLatestRelease).not.toHaveBeenCalled();
  });

  it("does not offer Apple Silicon artifacts to an Intel app", async () => {
    const { service, releaseSource } = createService({ arch: "x64" });

    await service.checkForUpdates();

    expect(service.getState().phase).toBe("unsupported");
    expect(releaseSource.getLatestRelease).not.toHaveBeenCalled();
  });

  it("reports a newer stable release and derives a trusted release URL", async () => {
    const { service, releaseSource } = createService();

    await service.checkForUpdates();

    expect(releaseSource.getLatestRelease).toHaveBeenCalledTimes(1);
    expect(service.getState()).toMatchObject({
      phase: "available",
      currentVersion: "0.1.0",
      availableVersion: "0.2.0",
      releaseNotes: "Improved update reliability.",
    });
    expect(service.getReleaseUrl()).toBe(
      "https://github.com/anhdd-kuro/fix-lang/releases/tag/v0.2.0",
    );
    expect(service.getReleaseUrl()).not.toContain("malicious.example");
  });

  it.each([null, undefined])(
    "accepts a stable release whose body is %s",
    async (body) => {
      const { service } = createService({
        getLatestRelease: () =>
          Promise.resolve(stableRelease("v0.2.0", { body })),
      });

      await service.checkForUpdates();

      expect(service.getState()).toMatchObject({
        phase: "available",
        availableVersion: "0.2.0",
      });
      expect(service.getState().releaseNotes).toBeUndefined();
    },
  );

  it.each([
    ["0.10.0", "v0.9.9", "up-to-date"],
    ["0.10.0", "v0.10.0", "up-to-date"],
    ["0.9.9", "v0.10.0", "available"],
  ])(
    "compares current %s with release %s numerically",
    async (currentVersion, releaseVersion, expectedPhase) => {
      const { service } = createService({
        currentVersion,
        getLatestRelease: () =>
          Promise.resolve(stableRelease(releaseVersion)),
      });

      await service.checkForUpdates();

      expect(service.getState().phase).toBe(expectedPhase);
    },
  );

  it.each([
    stableRelease("release-0.2.0"),
    stableRelease("v0.2"),
    stableRelease("v0.2.0-beta.1"),
    stableRelease("v0.2.0", { draft: true }),
    stableRelease("v0.2.0", { prerelease: true }),
    stableRelease("v0.2.0", { assets: [] }),
    stableRelease("v0.2.0", {
      assets: [{ name: "FixLang-0.2.0-arm64.dmg", state: "uploaded", size: 0 }],
    }),
    stableRelease("v0.2.0", { body: 42 }),
    { message: "not a release" },
  ])("rejects malformed or non-stable release metadata", async (release) => {
    const { service } = createService({
      getLatestRelease: () => Promise.resolve(release),
    });

    await service.checkForUpdates();

    expect(service.getState()).toMatchObject({
      phase: "error",
      message: msg("settings.updates.checkErrorMessage"),
    });
    expect(service.getReleaseUrl()).toBeNull();
  });

  it("limits release notes and keeps them as plain text", async () => {
    const longNotes = `<strong>${"x".repeat(13_000)}</strong>`;
    const { service } = createService({
      getLatestRelease: () =>
        Promise.resolve(stableRelease("v0.2.0", { body: longNotes })),
    });

    await service.checkForUpdates();

    expect(service.getState().releaseNotes).toHaveLength(12_000);
    expect(service.getState().releaseNotes?.startsWith("<strong>")).toBe(true);
  });

  it("prevents duplicate checks while the first request is active", async () => {
    let resolveRelease: ((release: unknown) => void) | undefined;
    const pendingRelease = new Promise<unknown>((resolve) => {
      resolveRelease = resolve;
    });
    const { service, releaseSource } = createService({
      getLatestRelease: () => pendingRelease,
    });

    const first = service.checkForUpdates();
    const second = service.checkForUpdates();
    expect(releaseSource.getLatestRelease).toHaveBeenCalledTimes(1);

    resolveRelease?.(stableRelease());
    await Promise.all([first, second]);
  });

  it("redacts remote and local details from errors and logs", async () => {
    const onLog = vi.fn();
    const { service } = createService({
      onLog,
      getLatestRelease: () =>
        Promise.reject(
          new Error(
            "https://private.example/releases?token=secret /Users/kuro/cache",
          ),
        ),
    });

    await service.checkForUpdates();

    expect(service.getState()).toMatchObject({
      phase: "error",
      message: msg("settings.updates.checkErrorMessage"),
    });
    expect(JSON.stringify(onLog.mock.calls)).not.toContain("private.example");
    expect(JSON.stringify(onLog.mock.calls)).not.toContain("token=secret");
    expect(JSON.stringify(onLog.mock.calls)).not.toContain("/Users/kuro");
  });

  it("notifies subscribers with immutable snapshots", async () => {
    const { service } = createService();
    const phases: string[] = [];
    const unsubscribe = service.subscribe((state) => phases.push(state.phase));

    await service.checkForUpdates();
    unsubscribe();

    expect(phases).toEqual(["checking", "available"]);
    expect(Object.isFrozen(service.getState())).toBe(true);
  });
});

describe("Homebrew one-click install", () => {
  const INSTALL_ERROR = msg("settings.updates.installErrorMessage");

  it("advertises one-click install only for a cask-managed app", () => {
    expect(createService({ canInstall: true }).service.getState().canInstall).toBe(
      true,
    );
    expect(createService().service.getState().canInstall).toBe(false);
  });

  it("never advertises install in an unsupported build", () => {
    const { service } = createService({ canInstall: true, isPackaged: false });

    expect(service.getState().canInstall).toBe(false);
  });

  it("starts the upgrade, records the marker, and quits", async () => {
    const { service, startUpgrade, pendingInstall, quitApp } = createService({
      canInstall: true,
    });
    await service.checkForUpdates();

    await expect(service.installUpdate()).resolves.toEqual({ success: true });

    expect(startUpgrade).toHaveBeenCalledTimes(1);
    expect(pendingInstall.write).toHaveBeenCalledWith({
      fromVersion: "0.1.0",
      toVersion: "0.2.0",
      startedAt: NOW,
    });
    expect(quitApp).toHaveBeenCalledTimes(1);
    expect(service.getState()).toMatchObject({
      phase: "installing",
      availableVersion: "0.2.0",
    });
  });

  it("refuses to install when no checked release is available", async () => {
    const { service, startUpgrade, quitApp } = createService({ canInstall: true });

    await expect(service.installUpdate()).resolves.toEqual({
      success: false,
      error: INSTALL_ERROR,
    });
    expect(startUpgrade).not.toHaveBeenCalled();
    expect(quitApp).not.toHaveBeenCalled();
  });

  it("refuses to install for a manual DMG copy", async () => {
    const { service, startUpgrade, quitApp } = createService();
    await service.checkForUpdates();

    await expect(service.installUpdate()).resolves.toEqual({
      success: false,
      error: INSTALL_ERROR,
    });
    expect(startUpgrade).not.toHaveBeenCalled();
    expect(quitApp).not.toHaveBeenCalled();
  });

  it("does not quit or mark a pending update when the helper fails to start", async () => {
    const { service, pendingInstall, quitApp } = createService({
      canInstall: true,
      startUpgrade: () => {
        throw new Error("/Users/kuro/Library brew missing");
      },
    });
    await service.checkForUpdates();

    await expect(service.installUpdate()).resolves.toEqual({
      success: false,
      error: INSTALL_ERROR,
    });
    expect(pendingInstall.write).not.toHaveBeenCalled();
    expect(quitApp).not.toHaveBeenCalled();
    expect(service.getState()).toMatchObject({ phase: "error" });
  });

  it("keeps local paths out of install failure logs", async () => {
    const onLog = vi.fn();
    const { service } = createService({
      canInstall: true,
      onLog,
      startUpgrade: () => {
        throw new Error("/Users/kuro/Library/Caskroom missing");
      },
    });
    await service.checkForUpdates();

    await service.installUpdate();

    expect(JSON.stringify(onLog.mock.calls)).not.toContain("/Users/kuro");
  });

  it("starts the upgrade only once while it is running", async () => {
    const { service, startUpgrade, quitApp } = createService({ canInstall: true });
    await service.checkForUpdates();

    const first = service.installUpdate();
    await expect(service.installUpdate()).resolves.toEqual({ success: true });
    await first;

    expect(startUpgrade).toHaveBeenCalledTimes(1);
    expect(quitApp).toHaveBeenCalledTimes(1);
  });

  it("lets the user retry after a rejected install", async () => {
    const { service, startUpgrade, getInstallableVersion } = createService({
      canInstall: true,
      installableVersion: null,
    });
    await service.checkForUpdates();
    getInstallableVersion.mockResolvedValueOnce("0.1.0");

    await service.installUpdate();
    // The rejection must not strand the panel: a fresh check re-offers the
    // update, and a still-behind tap simply rejects it again.
    await service.checkForUpdates();
    expect(service.getState().phase).toBe("available");
    getInstallableVersion.mockResolvedValueOnce("0.1.0");
    await service.installUpdate();

    expect(startUpgrade).not.toHaveBeenCalled();
    expect(service.getState().phase).toBe("error");
  });
});

/**
 * The button runs Homebrew, so the check has to ask Homebrew too. Offering a
 * GitHub release the cask cannot install yet is what made the button look
 * dead for hours after every release.
 */
describe("checking against Homebrew rather than GitHub", () => {
  it("offers the version the cask can install, not the newest release", async () => {
    const { service } = createService({
      canInstall: true,
      installableVersion: "0.1.5",
      getLatestRelease: () => Promise.resolve(stableRelease("v0.2.0")),
    });

    await service.checkForUpdates();

    expect(service.getState()).toMatchObject({
      phase: "available",
      availableVersion: "0.1.5",
    });
  });

  it("does not attach another release's notes or download size", async () => {
    const { service } = createService({
      canInstall: true,
      installableVersion: "0.1.5",
      getLatestRelease: () => Promise.resolve(stableRelease("v0.2.0")),
    });

    await service.checkForUpdates();

    // The notes and the byte total belong to v0.2.0, not to what is offered.
    expect(service.getState().releaseNotes).toBeUndefined();
    expect(service.getState().totalBytes).toBeUndefined();
  });

  it("says the tap is still catching up instead of offering a dead button", async () => {
    const { service } = createService({
      canInstall: true,
      installableVersion: "0.1.0",
      getLatestRelease: () => Promise.resolve(stableRelease("v0.2.0")),
    });

    await service.checkForUpdates();

    expect(service.getState()).toMatchObject({
      phase: "up-to-date",
      message: msg("settings.updates.tapPendingMessage", {
        publishedVersion: "0.2.0",
      }),
    });
    expect(service.getState().availableVersion).toBeUndefined();
  });

  it("reads the local tap clone first and only refreshes when GitHub is ahead", async () => {
    const { service, getInstallableVersion } = createService({
      canInstall: true,
      installableVersion: "0.2.0",
    });

    await service.checkForUpdates();

    // A cheap local read answered it; `brew update` is a git fetch across
    // every tap and must not run on a routine check.
    expect(getInstallableVersion.mock.calls).toEqual([[false]]);
  });

  it("pays for one tap refresh when the clone looks stale", async () => {
    const { service, getInstallableVersion } = createService({
      canInstall: true,
      installableVersion: "0.1.0",
      getLatestRelease: () => Promise.resolve(stableRelease("v0.2.0")),
    });

    await service.checkForUpdates();

    expect(getInstallableVersion.mock.calls).toEqual([[false], [true]]);
  });

  it("falls back to GitHub when brew cannot answer", async () => {
    const { service } = createService({
      canInstall: true,
      installableVersion: null,
    });

    await service.checkForUpdates();

    expect(service.getState()).toMatchObject({
      phase: "available",
      availableVersion: "0.2.0",
    });
  });

  it("never asks brew for a manual DMG install", async () => {
    const { service, getInstallableVersion } = createService({
      canInstall: false,
    });

    await service.checkForUpdates();

    expect(getInstallableVersion).not.toHaveBeenCalled();
    expect(service.getState()).toMatchObject({
      phase: "available",
      availableVersion: "0.2.0",
    });
  });

  it("still offers a cask update when GitHub is unreachable", async () => {
    const { service } = createService({
      canInstall: true,
      installableVersion: "0.2.0",
      getLatestRelease: () => Promise.reject(new Error("offline")),
    });

    await service.checkForUpdates();

    expect(service.getState()).toMatchObject({
      phase: "available",
      availableVersion: "0.2.0",
    });
    expect(service.getState().releaseNotes).toBeUndefined();
  });

  it("errors only when neither source can answer", async () => {
    const { service } = createService({
      canInstall: true,
      installableVersion: null,
      getLatestRelease: () => Promise.reject(new Error("offline")),
    });

    await service.checkForUpdates();

    expect(service.getState()).toMatchObject({
      phase: "error",
      message: msg("settings.updates.checkErrorMessage"),
    });
  });

  it("keeps GitHub failure details out of state and logs", async () => {
    const onLog = vi.fn();
    const { service } = createService({
      canInstall: true,
      installableVersion: "0.2.0",
      getLatestRelease: () => Promise.reject(new Error("/Users/kuro/token abc")),
      onLog,
    });

    await service.checkForUpdates();

    expect(JSON.stringify(service.getState())).not.toContain("/Users/kuro");
    expect(JSON.stringify(onLog.mock.calls)).not.toContain("/Users/kuro");
  });
});

describe("Homebrew tap lag", () => {
  it("refuses to quit for a version the tap cannot install yet", async () => {
    // The check itself normally blocks this; the gate still guards the case
    // where brew could not answer then but answers with an older cask now.
    const { service, startUpgrade, pendingInstall, quitApp, getInstallableVersion } =
      createService({ canInstall: true, installableVersion: null });
    await service.checkForUpdates();
    getInstallableVersion.mockResolvedValueOnce("0.1.0");

    const result = await service.installUpdate();

    expect(result).toEqual({
      success: false,
      error: msg("settings.updates.tapBehindMessage", {
        targetVersion: "0.2.0",
        offeredVersion: "0.1.0",
      }),
    });
    expect(startUpgrade).not.toHaveBeenCalled();
    expect(pendingInstall.write).not.toHaveBeenCalled();
    expect(quitApp).not.toHaveBeenCalled();
    expect(service.getState()).toMatchObject({
      phase: "error",
      availableVersion: "0.2.0",
    });
  });

  it("installs when the tap has caught up", async () => {
    const { service, startUpgrade, quitApp } = createService({
      canInstall: true,
      installableVersion: "0.2.0",
    });
    await service.checkForUpdates();

    await expect(service.installUpdate()).resolves.toEqual({ success: true });

    expect(startUpgrade).toHaveBeenCalledTimes(1);
    expect(quitApp).toHaveBeenCalledTimes(1);
  });

  it("installs when the tap is already ahead of the checked release", async () => {
    const { service, startUpgrade } = createService({
      canInstall: true,
      installableVersion: "0.3.0",
    });
    await service.checkForUpdates();

    await service.installUpdate();

    expect(startUpgrade).toHaveBeenCalledTimes(1);
  });

  it.each([null, "not-a-version"])(
    "proceeds when the probe answers %s rather than blocking a working install",
    async (installableVersion) => {
      const { service, startUpgrade, quitApp } = createService({
        canInstall: true,
        installableVersion,
      });
      await service.checkForUpdates();

      await expect(service.installUpdate()).resolves.toEqual({ success: true });

      expect(startUpgrade).toHaveBeenCalledTimes(1);
      expect(quitApp).toHaveBeenCalledTimes(1);
    },
  );

  it("shows the downloading phase while the tap is being probed", async () => {
    let resolveProbe: ((version: string | null) => void) | undefined;
    const { service, getInstallableVersion } = createService({
      canInstall: true,
    });
    await service.checkForUpdates();
    getInstallableVersion.mockReturnValueOnce(
      new Promise<string | null>((resolve) => {
        resolveProbe = resolve;
      }),
    );

    const install = service.installUpdate();
    expect(service.getState().phase).toBe("downloading");

    resolveProbe?.("0.2.0");
    await install;
  });

  it("survives a throwing probe and keeps its details out of state and logs", async () => {
    const onLog = vi.fn();
    const { service, getInstallableVersion, startUpgrade } = createService({
      canInstall: true,
      onLog,
    });
    await service.checkForUpdates();
    getInstallableVersion.mockRejectedValueOnce(
      new Error("/Users/kuro/Library/Caskroom/fixlang unreadable"),
    );

    await expect(service.installUpdate()).resolves.toEqual({ success: true });

    expect(startUpgrade).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(onLog.mock.calls)).not.toContain("/Users/kuro");
    expect(JSON.stringify(service.getState())).not.toContain("/Users/kuro");
  });
});

describe("pending Homebrew update reconciliation", () => {
  const STALE = NOW - UPGRADE_GRACE_MS;
  const FRESH = NOW - 10_000;
  const marker = (startedAt: number) => ({
    fromVersion: "0.1.0",
    toVersion: "0.2.0",
    startedAt,
  });

  it("reports a completed upgrade on the next launch", () => {
    const { service, pendingInstall } = createService({
      canInstall: true,
      currentVersion: "0.2.0",
      pending: marker(FRESH),
    });

    expect(service.getState()).toMatchObject({
      phase: "up-to-date",
      currentVersion: "0.2.0",
    });
    expect(pendingInstall.clear).toHaveBeenCalledTimes(1);
  });

  it("fails loudly when Homebrew never replaced the bundle", () => {
    const { service, pendingInstall } = createService({
      canInstall: true,
      currentVersion: "0.1.0",
      pending: marker(STALE),
    });

    expect(service.getState()).toMatchObject({
      phase: "error",
      message: msg("settings.updates.installIncompleteMessage"),
    });
    expect(pendingInstall.clear).toHaveBeenCalled();
  });

  it("stays idle when nothing was pending", () => {
    const { service, pendingInstall } = createService({ canInstall: true });

    expect(service.getState().phase).toBe("idle");
    expect(pendingInstall.clear).not.toHaveBeenCalled();
  });

  it("ignores a marker left behind for an unsupported build", () => {
    const { service, pendingInstall } = createService({
      isPackaged: false,
      pending: marker(FRESH),
    });

    expect(service.getState().phase).toBe("unsupported");
    expect(pendingInstall.read).not.toHaveBeenCalled();
  });
});

/**
 * The app quits in under a second while Homebrew keeps working for minutes.
 * Reopening FixLang in that window used to be reported as a failed upgrade,
 * which cleared the marker and re-armed a button whose second click collided
 * with the running helper's download lock.
 */
describe("reopening during a background upgrade", () => {
  const inFlight = {
    fromVersion: "0.1.0",
    toVersion: "0.2.0",
    startedAt: NOW - 10_000,
  };

  it("says the upgrade is still running instead of calling it failed", () => {
    const { service, pendingInstall } = createService({
      canInstall: true,
      currentVersion: "0.1.0",
      pending: inFlight,
    });

    expect(service.getState()).toMatchObject({
      phase: "installing",
      availableVersion: "0.2.0",
      message: msg("settings.updates.backgroundInstallMessage", {
        targetVersion: "0.2.0",
      }),
    });
    // Clearing it would throw away the only record of this upgrade.
    expect(pendingInstall.clear).not.toHaveBeenCalled();
  });

  it("refuses a second upgrade that would collide with the running helper", async () => {
    const { service, startUpgrade, quitApp } = createService({
      canInstall: true,
      currentVersion: "0.1.0",
      pending: inFlight,
    });

    await service.checkForUpdates();
    await service.installUpdate();

    expect(startUpgrade).not.toHaveBeenCalled();
    expect(quitApp).not.toHaveBeenCalled();
    expect(service.getState().phase).toBe("installing");
  });

  it("asks for a restart when the helper finished before this launch", () => {
    const { service, pendingInstall } = createService({
      canInstall: true,
      currentVersion: "0.1.0",
      pending: inFlight,
      installedVersions: ["0.2.0"],
    });

    expect(service.getState()).toMatchObject({
      phase: "restart-required",
      availableVersion: "0.2.0",
      message: msg("settings.updates.restartRequiredMessage", {
        targetVersion: "0.2.0",
      }),
    });
    expect(pendingInstall.clear).toHaveBeenCalledTimes(1);
  });

  it("notices the upgrade landing while the app stays open", () => {
    const { service, pendingInstall, installedVersions, tickPoll, cancelPoll } =
      createService({
        canInstall: true,
        currentVersion: "0.1.0",
        pending: inFlight,
      });

    tickPoll();
    expect(service.getState().phase).toBe("installing");

    installedVersions.add("0.2.0");
    tickPoll();

    expect(service.getState()).toMatchObject({
      phase: "restart-required",
      message: msg("settings.updates.restartRequiredMessage", {
        targetVersion: "0.2.0",
      }),
    });
    expect(pendingInstall.clear).toHaveBeenCalledTimes(1);
    expect(cancelPoll).toHaveBeenCalledTimes(1);
  });

  it("gives up once the grace window closes with nothing installed", () => {
    let clock = NOW;
    const { service, pendingInstall, tickPoll, cancelPoll } = createService({
      canInstall: true,
      currentVersion: "0.1.0",
      pending: inFlight,
      now: () => clock,
    });

    clock = NOW + UPGRADE_GRACE_MS;
    tickPoll();

    expect(service.getState()).toMatchObject({
      phase: "error",
      message: msg("settings.updates.installIncompleteMessage"),
    });
    expect(pendingInstall.clear).toHaveBeenCalledTimes(1);
    expect(cancelPoll).toHaveBeenCalledTimes(1);
  });
});

/**
 * The download is the slow part of an upgrade, so it runs with the app still
 * open and reporting progress. Only the bundle swap — a local file move —
 * happens after the quit.
 */
describe("downloading before quitting", () => {
  const ready = async (
    overrides: Parameters<typeof createService>[0] = {},
  ) => {
    const harness = createService({ canInstall: true, ...overrides });
    await harness.service.checkForUpdates();
    return harness;
  };

  it("downloads first and only then hands over to the helper", async () => {
    const order: string[] = [];
    const { service, startUpgrade, quitApp } = await ready({
      downloadUpdate: () => {
        order.push("download");
        return Promise.resolve();
      },
      startUpgrade: () => order.push("upgrade"),
    });

    await expect(service.installUpdate()).resolves.toEqual({ success: true });

    expect(order).toEqual(["download", "upgrade"]);
    expect(startUpgrade).toHaveBeenCalledTimes(1);
    expect(quitApp).toHaveBeenCalledTimes(1);
  });

  it("never quits for an upgrade whose download failed", async () => {
    const { service, startUpgrade, quitApp, pendingInstall } = await ready({
      downloadUpdate: () => Promise.reject(new Error("network down")),
    });

    await expect(service.installUpdate()).resolves.toEqual({
      success: false,
      error: msg("settings.updates.downloadErrorMessage"),
    });

    expect(startUpgrade).not.toHaveBeenCalled();
    expect(quitApp).not.toHaveBeenCalled();
    expect(pendingInstall.write).not.toHaveBeenCalled();
    expect(service.getState()).toMatchObject({
      phase: "error",
      message: msg("settings.updates.downloadErrorMessage"),
    });
  });

  it("lets the user retry after a failed download", async () => {
    const { service } = await ready({
      downloadUpdate: () => Promise.reject(new Error("network down")),
    });
    await service.installUpdate();

    await service.checkForUpdates();

    expect(service.getState().phase).toBe("available");
  });

  it("publishes byte progress against the release asset size", async () => {
    const states: unknown[] = [];
    let finishDownload: (() => void) | undefined;
    const { service, tickPoll } = await ready({
      downloadedBytes: 512,
      getLatestRelease: () =>
        Promise.resolve(
          stableRelease("v0.2.0", {
            assets: [
              {
                name: "FixLang-0.2.0-arm64.dmg",
                state: "uploaded",
                size: 2_048,
              },
            ],
          }),
        ),
      // Held open so the poll can run while the download is genuinely pending.
      downloadUpdate: () =>
        new Promise<void>((resolve) => {
          finishDownload = resolve;
        }),
    });
    service.subscribe((next) => states.push({ ...next }));

    const install = service.installUpdate();
    // Let the tap probe settle so the download poll is registered.
    await new Promise((resolve) => setImmediate(resolve));
    tickPoll();
    finishDownload?.();
    await install;

    expect(states).toContainEqual(
      expect.objectContaining({
        phase: "downloading",
        downloadedBytes: 512,
        totalBytes: 2_048,
      }),
    );
  });

  it("stops polling once the download settles", async () => {
    const { service, cancelPoll } = await ready();

    await service.installUpdate();

    expect(cancelPoll).toHaveBeenCalledTimes(1);
  });

  it("reports no progress rather than a wrong total when nothing is cached", async () => {
    const { service, tickPoll } = await ready({ downloadedBytes: null });

    const install = service.installUpdate();
    tickPoll();
    await install;

    // A null read means "cannot tell yet", never "0 bytes of nothing".
    expect(service.getState().phase).toBe("installing");
  });
});

/**
 * `open -b` cannot replace a running app — LaunchServices just focuses it — so
 * the helper's own reopen leaves a user who reopened FixLang early stuck on
 * the old binary. Re-executing the bundle is the only way out.
 */
describe("restarting into an installed update", () => {
  it("re-executes the bundle Homebrew already replaced", () => {
    const { service, relaunchApp } = createService({
      canInstall: true,
      currentVersion: "0.1.0",
      pending: { fromVersion: "0.1.0", toVersion: "0.2.0", startedAt: NOW },
      installedVersions: ["0.2.0"],
    });

    expect(service.restartForUpdate()).toEqual({ success: true });
    expect(relaunchApp).toHaveBeenCalledTimes(1);
  });

  it.each(["idle", "available"] as const)(
    "never restarts from an unrelated phase: %s",
    async (phase) => {
      const { service, relaunchApp } = createService({ canInstall: true });
      if (phase === "available") await service.checkForUpdates();

      expect(service.restartForUpdate()).toEqual({
        success: false,
        error: msg("settings.updates.restartErrorMessage"),
      });
      expect(relaunchApp).not.toHaveBeenCalled();
    },
  );
});
