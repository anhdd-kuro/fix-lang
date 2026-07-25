import { describe, expect, it, vi } from "vitest";
import { createUpdateService } from "./updateService";

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
    pending: { fromVersion: string; toVersion: string } | null;
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
  const pendingInstall = {
    read: vi.fn(() => overrides.pending ?? null),
    write: vi.fn(),
    clear: vi.fn(),
  };
  const quitApp = vi.fn();
  const service = createUpdateService({
    releaseSource,
    isPackaged: overrides.isPackaged ?? true,
    platform: overrides.platform ?? "darwin",
    arch: overrides.arch ?? "arm64",
    getCurrentVersion: () => overrides.currentVersion ?? "0.1.0",
    upgrader: {
      canInstall: overrides.canInstall ?? false,
      getInstallableVersion,
      startUpgrade,
    },
    pendingInstall,
    quitApp,
    onLog: overrides.onLog,
  });

  return {
    service,
    releaseSource,
    startUpgrade,
    getInstallableVersion,
    pendingInstall,
    quitApp,
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
      message: "Could not check for updates. Try again later.",
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
      message: "Could not check for updates. Try again later.",
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
  const INSTALL_ERROR =
    "Could not start the Homebrew update. Update manually with the command below.";

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
    const { service, startUpgrade } = createService({
      canInstall: true,
      installableVersion: "0.1.0",
    });
    await service.checkForUpdates();

    await service.installUpdate();
    await service.checkForUpdates();
    await service.installUpdate();

    expect(startUpgrade).not.toHaveBeenCalled();
    expect(service.getState().phase).toBe("error");
  });
});

describe("Homebrew tap lag", () => {
  it("refuses to quit for a version the tap cannot install yet", async () => {
    const { service, startUpgrade, pendingInstall, quitApp } = createService({
      canInstall: true,
      installableVersion: "0.1.0",
    });
    await service.checkForUpdates();

    const result = await service.installUpdate();

    expect(result).toEqual({
      success: false,
      error:
        "Homebrew does not have v0.2.0 yet — it still offers v0.1.0. " +
        "The tap syncs shortly after each release; try again later, or update " +
        "manually with the command below.",
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

  it("shows the installing phase while the tap is being probed", async () => {
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
    expect(service.getState().phase).toBe("installing");

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
  it("reports a completed upgrade on the next launch", () => {
    const { service, pendingInstall } = createService({
      canInstall: true,
      currentVersion: "0.2.0",
      pending: { fromVersion: "0.1.0", toVersion: "0.2.0" },
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
      pending: { fromVersion: "0.1.0", toVersion: "0.2.0" },
    });

    expect(service.getState()).toMatchObject({
      phase: "error",
      message:
        "Homebrew did not finish the last update. Update manually with the command below.",
    });
    expect(pendingInstall.clear).toHaveBeenCalledTimes(1);
  });

  it("stays idle when nothing was pending", () => {
    const { service, pendingInstall } = createService({ canInstall: true });

    expect(service.getState().phase).toBe("idle");
    expect(pendingInstall.clear).not.toHaveBeenCalled();
  });

  it("ignores a marker left behind for an unsupported build", () => {
    const { service, pendingInstall } = createService({
      isPackaged: false,
      pending: { fromVersion: "0.1.0", toVersion: "0.2.0" },
    });

    expect(service.getState().phase).toBe("unsupported");
    expect(pendingInstall.read).not.toHaveBeenCalled();
  });
});
