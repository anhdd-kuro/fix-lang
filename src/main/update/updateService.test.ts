import { describe, expect, it, vi } from "vitest";
import { msg } from "~/features/i18n/shared/message";
import {
  BETA_CASK_TOKEN,
  STABLE_CASK_TOKEN,
  type ActiveCaskChannel,
  type CaskToken,
} from "./homebrew";
import { UPGRADE_GRACE_MS } from "./pendingInstall";
import { parsePrereleaseVersion } from "./prereleaseVersion";
import { createUpdateService } from "./updateService";
import type { PrereleaseCandidate } from "./githubReleaseSource";

/** Fixed clock so marker ages are exact rather than wall-clock dependent. */
const NOW = 1_700_000_000_000;
const INSTALLED_APP_PATH = "/Applications/FixLang.app";
/** Same bundle id, different copy — a forgotten `pack:mac` build. */
const STRAY_APP_PATH = "/Users/dev/fix-lang/release/mac-arm64/FixLang.app";

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

/**
 * `getLatestPrerelease` is already validated by `githubReleaseSource.ts` by
 * the time `updateService.ts` ever sees it — the fake mirrors that contract
 * by handing back an already-shaped `PrereleaseCandidate` instead of raw
 * GitHub JSON.
 */
const prereleaseCandidate = (
  raw = "0.2.0-beta.1",
  overrides: Partial<Pick<PrereleaseCandidate, "releaseNotes" | "dmgSize">> = {},
): PrereleaseCandidate => {
  const version = parsePrereleaseVersion(raw);
  if (!version) throw new Error(`invalid test fixture version: ${raw}`);
  return {
    version,
    dmgSize: 1,
    releaseNotes: "Beta release notes.",
    ...overrides,
  };
};

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
    /** Versions already staged in the Caskroom under the stable token. */
    installedVersions: readonly string[];
    /** Versions already staged in the Caskroom under the beta token. */
    betaInstalledVersions: readonly string[];
    /** Bytes reported as cached while the download is polled. */
    downloadedBytes: number | null;
    downloadUpdate: () => Promise<void>;
    pending: {
      fromVersion: string;
      toVersion: string;
      startedAt: number;
      appPath: string;
      caskToken: "fixlang" | "fixlang@beta";
      /** The token the operation STARTED on; absent for pre-field markers. */
      fromCaskToken?: "fixlang" | "fixlang@beta";
    } | null;
    appPath: string | null;
    now: () => number;
    getLatestRelease: () => Promise<unknown>;
    getLatestPrerelease: () => Promise<PrereleaseCandidate | null>;
    /**
     * Which cask token(s) the Caskroom probe reports; undefined models no
     * collaborator wired. When no explicit value is given, defaults to
     * `"stable"` for a cask-capable fixture (`canInstall: true`) and `null`
     * otherwise — the realistic correlation: a build with no cask install at
     * all also has nothing staged in its Caskroom.
     */
    activeChannel: ActiveCaskChannel | null;
    /** Resolves `true` unless overridden — most fixtures want the happy path. */
    confirmPrereleaseSwitch: (targetVersion: string) => Promise<boolean>;
    startChannelSwitch: (
      currentToken: CaskToken,
      targetToken: CaskToken,
      appPath: string | null,
    ) => void;
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
    getLatestPrerelease: vi
      .fn<() => Promise<PrereleaseCandidate | null>>()
      .mockImplementation(overrides.getLatestPrerelease ?? (() => Promise.resolve(null))),
  };
  const detectActiveCaskChannel = vi.fn<() => ActiveCaskChannel | null>(() => {
    if (overrides.activeChannel !== undefined) return overrides.activeChannel;
    return overrides.canInstall ? "stable" : null;
  });
  // Typed with the REAL `HomebrewUpgrader` signatures, not the zero-argument
  // shape the fixtures happen to pass: the cask token these two are called
  // with is part of the contract, and a mock that cannot see it cannot pin it.
  const startUpgrade = vi.fn<
    (appPath?: string | null, caskToken?: string) => void
  >(overrides.startUpgrade);
  const getInstallableVersion = vi.fn<() => Promise<string | null>>(() =>
    Promise.resolve(
      overrides.installableVersion === undefined
        ? "0.2.0"
        : overrides.installableVersion,
    ),
  );
  const installedVersions = new Set(overrides.installedVersions ?? []);
  const betaInstalledVersions = new Set(overrides.betaInstalledVersions ?? []);
  const isVersionInstalled = vi.fn(
    (version: string, caskToken: string = STABLE_CASK_TOKEN) =>
      (caskToken === BETA_CASK_TOKEN ? betaInstalledVersions : installedVersions).has(
        version,
      ),
  );
  const downloadUpdate = vi.fn<(caskToken?: string) => Promise<void>>(
    overrides.downloadUpdate ?? (() => Promise.resolve()),
  );
  // Typed with the REAL signature for the same reason `startUpgrade` is: the
  // cask token this flow reads cached bytes for is part of the contract, and a
  // mock blind to it cannot pin which cask the ordinary flow named.
  const getDownloadedBytes = vi.fn<
    (version: string, caskToken?: string) => number | null
  >(() => overrides.downloadedBytes ?? null);
  const pendingInstall = {
    read: vi.fn(() => overrides.pending ?? null),
    write: vi.fn(),
    clear: vi.fn(),
  };
  const quitApp = vi.fn();
  const relaunchApp = vi.fn();
  const confirmPrereleaseSwitch = vi.fn<(targetVersion: string) => Promise<boolean>>(
    overrides.confirmPrereleaseSwitch ?? (() => Promise.resolve(true)),
  );
  const startChannelSwitch = vi.fn(overrides.startChannelSwitch);
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
    appPath:
      overrides.appPath === undefined ? INSTALLED_APP_PATH : overrides.appPath,
    quitApp,
    relaunchApp,
    onLog: overrides.onLog,
    now: overrides.now ?? (() => NOW),
    schedulePoll: (run) => {
      polls.push(run);
      return cancelPoll;
    },
    detectActiveCaskChannel,
    confirmPrereleaseSwitch,
    startChannelSwitch,
  });

  return {
    service,
    releaseSource,
    detectActiveCaskChannel,
    startUpgrade,
    getInstallableVersion,
    isVersionInstalled,
    downloadUpdate,
    getDownloadedBytes,
    installedVersions,
    betaInstalledVersions,
    pendingInstall,
    quitApp,
    relaunchApp,
    cancelPoll,
    confirmPrereleaseSwitch,
    startChannelSwitch,
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
    // The helper reopens this exact bundle instead of resolving the bundle id,
    // which can point at another copy of FixLang. The token is named rather
    // than inherited from the upgrader's binding — the ordinary flow says
    // "stable" at every step, which is what makes it agree with the marker
    // written just below.
    expect(startUpgrade).toHaveBeenCalledWith(INSTALLED_APP_PATH, STABLE_CASK_TOKEN);
    expect(pendingInstall.write).toHaveBeenCalledWith({
      fromVersion: "0.1.0",
      toVersion: "0.2.0",
      startedAt: NOW,
      appPath: INSTALLED_APP_PATH,
      caskToken: STABLE_CASK_TOKEN,
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
    // Not installable, but readable: the panel offers a link to that exact
    // release rather than the generic /releases/latest fallback.
    expect(service.getReleaseUrl()).toBe(
      "https://github.com/anhdd-kuro/fix-lang/releases/tag/v0.2.0",
    );
    // The notes describe the version the message names, so they belong here.
    expect(service.getState().releaseNotes).toBe(
      "Improved update reliability.",
    );
  });

  it("keeps the release link empty when nothing newer has been published", async () => {
    const { service } = createService({
      canInstall: true,
      installableVersion: "0.1.0",
      getLatestRelease: () => Promise.resolve(stableRelease("v0.1.0")),
    });

    await service.checkForUpdates();

    expect(service.getState().message).toBeUndefined();
    expect(service.getReleaseUrl()).toBeNull();
  });

  it("reads the local tap clone first and only refreshes when GitHub is ahead", async () => {
    const { service, getInstallableVersion } = createService({
      canInstall: true,
      installableVersion: "0.2.0",
    });

    await service.checkForUpdates();

    // A cheap local read answered it; `brew update` is a git fetch across
    // every tap and must not run on a routine check.
    expect(getInstallableVersion.mock.calls).toEqual([[false, STABLE_CASK_TOKEN]]);
  });

  it("pays for one tap refresh when the clone looks stale", async () => {
    const { service, getInstallableVersion } = createService({
      canInstall: true,
      installableVersion: "0.1.0",
      getLatestRelease: () => Promise.resolve(stableRelease("v0.2.0")),
    });

    await service.checkForUpdates();

    expect(getInstallableVersion.mock.calls).toEqual([
      [false, STABLE_CASK_TOKEN],
      [true, STABLE_CASK_TOKEN],
    ]);
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
  const marker = (startedAt: number) =>
    ({
      fromVersion: "0.1.0",
      toVersion: "0.2.0",
      startedAt,
      appPath: INSTALLED_APP_PATH,
      caskToken: STABLE_CASK_TOKEN,
    }) as const;

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
    appPath: INSTALLED_APP_PATH,
    caskToken: STABLE_CASK_TOKEN,
  } as const;

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

  /**
   * `homebrew.ts` validates a per-call token against ITS OWN Caskroom entry
   * and throws when it is absent, so fetching one cask and then asking
   * `startUpgrade` for a different one fails after the download already
   * succeeded. Whatever token this flow uses, it must be the SAME one end to
   * end — this pins the agreement itself, and the sibling test below pins
   * which token that is.
   */
  it("hands the helper the same cask token it downloaded with", async () => {
    const { service, startUpgrade, downloadUpdate } = await ready();

    await expect(service.installUpdate()).resolves.toEqual({ success: true });

    const downloadToken = downloadUpdate.mock.calls[0]?.[0];
    const upgradeToken = startUpgrade.mock.calls[0]?.[1];
    expect(upgradeToken).toBe(downloadToken);
  });

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
      pending: {
        fromVersion: "0.1.0",
        toVersion: "0.2.0",
        startedAt: NOW,
        appPath: INSTALLED_APP_PATH,
        caskToken: STABLE_CASK_TOKEN,
      },
      installedVersions: ["0.2.0"],
    });

    expect(service.restartForUpdate()).toEqual({ success: true });
    // No target path: this process is the upgraded bundle, so re-exec is right.
    expect(relaunchApp).toHaveBeenCalledWith(null);
  });

  /**
   * The failure this covers: Homebrew upgrades `/Applications`, the helper's
   * `open -b` resolves the shared bundle id to a stray build elsewhere, and
   * that older copy comes up reporting a completed update.
   */
  describe("when a different copy of FixLang reopened", () => {
    const strayLaunch = (
      onLog?: (level: "info" | "warn" | "error", message: string) => void,
    ) =>
      createService({
        canInstall: true,
        currentVersion: "0.1.5",
        appPath: STRAY_APP_PATH,
        pending: {
          fromVersion: "0.1.0",
          toVersion: "0.2.0",
          startedAt: NOW,
          appPath: INSTALLED_APP_PATH,
          caskToken: STABLE_CASK_TOKEN,
        },
        installedVersions: ["0.2.0"],
        ...(onLog ? { onLog } : {}),
      });

    it("never reports the stray version as the installed update", () => {
      const { service } = strayLaunch();

      expect(service.getState()).toMatchObject({
        phase: "restart-required",
        availableVersion: "0.2.0",
        message: msg("settings.updates.wrongBundleMessage", {
          targetVersion: "0.2.0",
          targetPath: INSTALLED_APP_PATH,
        }),
      });
    });

    it("restarts into the upgraded bundle rather than re-executing itself", () => {
      const { service, relaunchApp } = strayLaunch();

      expect(service.restartForUpdate()).toEqual({ success: true });
      expect(relaunchApp).toHaveBeenCalledWith(INSTALLED_APP_PATH);
    });

    it("logs both bundles so the stray copy can be found and removed", () => {
      const onLog = vi.fn();
      strayLaunch(onLog);

      expect(onLog).toHaveBeenCalledWith(
        "warn",
        expect.stringContaining(STRAY_APP_PATH),
      );
    });

    it("keeps the install button inert", () => {
      const { service, startUpgrade } = strayLaunch();

      // Nothing left to install: the bundle on disk is already the new one.
      void service.installUpdate();
      expect(startUpgrade).not.toHaveBeenCalled();
    });
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

/**
 * A SECOND, independently-published state (`getPrereleaseState`/
 * `checkForPrerelease`/`subscribeToPrereleaseState`) sitting on the same
 * service, discovery-only for this card: no switch, no revert, no confirm,
 * no marker writes.
 */
describe("pre-release channel discovery", () => {
  it("starts idle with the stable channel assumed until checked", () => {
    const { service } = createService();

    expect(service.getPrereleaseState()).toMatchObject({
      phase: "idle",
      activeChannel: "stable",
      canSwitch: false,
    });
  });

  it("never calls the pre-release source from the ordinary update check", async () => {
    const { service, releaseSource } = createService();

    await service.checkForUpdates();

    expect(releaseSource.getLatestPrerelease).not.toHaveBeenCalled();
  });

  it("refuses to guess which cask is live when both are staged, and starts no brew subprocess", async () => {
    const { service, startUpgrade, downloadUpdate, getInstallableVersion, releaseSource } =
      createService({ canInstall: true, activeChannel: "both" });

    const result = await service.checkForPrerelease();

    expect(result).toMatchObject({
      phase: "error",
      activeChannel: "both",
      message: msg("settings.updates.prerelease.bothCasksMessage", {
        stableToken: STABLE_CASK_TOKEN,
        betaToken: BETA_CASK_TOKEN,
        fixCommand: `brew uninstall --cask ${BETA_CASK_TOKEN}`,
      }),
    });
    expect(startUpgrade).not.toHaveBeenCalled();
    expect(downloadUpdate).not.toHaveBeenCalled();
    expect(getInstallableVersion).not.toHaveBeenCalled();
    // The conflict is decided from the two directory probes alone.
    expect(releaseSource.getLatestPrerelease).not.toHaveBeenCalled();
  });

  it("offers a beta without one-click for a manual DMG install, same as the ordinary flow", async () => {
    const candidate = prereleaseCandidate("0.2.0-beta.1", {
      releaseNotes: "Beta release notes.",
    });
    const { service } = createService({
      canInstall: false,
      currentVersion: "0.1.0",
      getLatestPrerelease: () => Promise.resolve(candidate),
    });

    const result = await service.checkForPrerelease();

    expect(result).toMatchObject({
      phase: "available",
      activeChannel: "stable",
      offeredVersion: "0.2.0-beta.1",
      releaseNotes: "Beta release notes.",
      canSwitch: false,
    });
  });

  it("offers a stable release over the running beta through the unchanged stable flow", async () => {
    const { service, releaseSource } = createService({
      currentVersion: "0.33.0-beta.2",
      getLatestRelease: () => Promise.resolve(stableRelease("v0.33.0")),
    });

    await service.checkForUpdates();

    expect(service.getState()).toMatchObject({
      phase: "available",
      currentVersion: "0.33.0-beta.2",
      availableVersion: "0.33.0",
    });
    expect(releaseSource.getLatestPrerelease).not.toHaveBeenCalled();
  });

  it("reports up-to-date when no newer beta is published", async () => {
    const { service } = createService({
      canInstall: true,
      currentVersion: "0.2.0-beta.1",
      getLatestPrerelease: () => Promise.resolve(null),
    });

    const result = await service.checkForPrerelease();

    expect(result).toMatchObject({ phase: "up-to-date", activeChannel: "stable" });
    expect(result.offeredVersion).toBeUndefined();
  });

  it("offers a newer beta over a beta already running", async () => {
    const candidate = prereleaseCandidate("0.2.0-beta.2");
    const { service } = createService({
      canInstall: true,
      currentVersion: "0.2.0-beta.1",
      getLatestPrerelease: () => Promise.resolve(candidate),
    });

    const result = await service.checkForPrerelease();

    expect(result).toMatchObject({
      phase: "available",
      offeredVersion: "0.2.0-beta.2",
      canSwitch: true,
    });
  });

  it("prevents a duplicate pre-release check while one is active", async () => {
    let resolveCandidate: ((candidate: PrereleaseCandidate | null) => void) | undefined;
    const pending = new Promise<PrereleaseCandidate | null>((resolve) => {
      resolveCandidate = resolve;
    });
    const { service, releaseSource } = createService({
      canInstall: true,
      getLatestPrerelease: () => pending,
    });

    const first = service.checkForPrerelease();
    const second = service.checkForPrerelease();
    expect(releaseSource.getLatestPrerelease).toHaveBeenCalledTimes(1);

    resolveCandidate?.(null);
    await Promise.all([first, second]);
  });

  it("stays unsupported and never probes the Caskroom on an unsupported build", async () => {
    const { service, detectActiveCaskChannel } = createService({ isPackaged: false });

    expect(service.getPrereleaseState().phase).toBe("unsupported");
    const result = await service.checkForPrerelease();

    expect(result.phase).toBe("unsupported");
    expect(detectActiveCaskChannel).not.toHaveBeenCalled();
  });

  it("notifies pre-release subscribers with immutable snapshots", async () => {
    const { service } = createService({ canInstall: true });
    const phases: string[] = [];
    const unsubscribe = service.subscribeToPrereleaseState((s) => phases.push(s.phase));

    await service.checkForPrerelease();
    unsubscribe();

    expect(phases).toEqual(["checking", "up-to-date"]);
    expect(Object.isFrozen(service.getPrereleaseState())).toBe(true);
  });

  /**
   * Routed defect (card 06, Architecture lens): `canSwitch` used to be
   * `canInstall`, a flag scoped to whichever token `upgrader` is bound to —
   * always the stable cask. A genuine beta install has NO stable Caskroom
   * entry, so `canInstall` reads false for exactly the population the
   * revert button exists to serve.
   */
  it("keeps canSwitch true for a genuine beta install even with no stable Caskroom entry", async () => {
    const { service } = createService({
      canInstall: false,
      activeChannel: "beta",
    });

    const result = await service.checkForPrerelease();

    expect(result).toMatchObject({ activeChannel: "beta", canSwitch: true });
  });

  it("keeps canSwitch false when the Caskroom cannot be read at all, even on a display default of stable", async () => {
    const { service } = createService({
      canInstall: true,
      activeChannel: null,
    });

    const result = await service.checkForPrerelease();

    // Display still says "stable" — the correct reading for a manual DMG
    // install — but nothing here proved a cask is actually staged.
    expect(result).toMatchObject({ activeChannel: "stable", canSwitch: false });
  });

  /**
   * Routed defect (card 06 review): the pre-release source THROWS on a
   * failed request but resolves `null` when nothing qualifies; the old code
   * routed both through a tolerant wrapper that swallowed the throw into the
   * same `null`, so a 403 or an offline abort published as "up-to-date" —
   * silently, with no error surfaced anywhere.
   */
  it("reports an error rather than up-to-date when the pre-release request itself fails", async () => {
    const onLog = vi.fn();
    const { service } = createService({
      canInstall: true,
      onLog,
      getLatestPrerelease: () =>
        Promise.reject(new Error("GitHub release list request failed (403)")),
    });

    const result = await service.checkForPrerelease();

    expect(result).toMatchObject({
      phase: "error",
      message: msg("settings.updates.checkErrorMessage"),
    });
    expect(result.phase).not.toBe("up-to-date");
  });
});

/**
 * Routed defect (card 02 review, routed to this card): `reconcileLastInstall`
 * and `watchBackgroundUpgrade` used to call `isVersionInstalled` WITHOUT
 * `pending.caskToken`, so both always probed the upgrader's BOUND channel
 * (stable) instead of the channel the marker actually targeted. A successful
 * beta install (or a revert) never registered, and after the grace window a
 * genuinely correct install reported `failed`.
 */
describe("reconciling a marker against its OWN cask token", () => {
  const STALE = NOW - UPGRADE_GRACE_MS;
  const betaPending = (startedAt: number) =>
    ({
      fromVersion: "0.2.0-beta.1",
      toVersion: "0.2.0-beta.2",
      startedAt,
      appPath: INSTALLED_APP_PATH,
      caskToken: BETA_CASK_TOKEN,
    }) as const;

  it("recognizes a completed beta install even though the stable Caskroom has nothing", () => {
    const { service, pendingInstall } = createService({
      canInstall: true,
      currentVersion: "0.2.0-beta.1",
      pending: betaPending(STALE),
      // The stable Caskroom probe (the old, unfixed lookup) would find
      // nothing here — only the beta one has the target version.
      betaInstalledVersions: ["0.2.0-beta.2"],
    });

    expect(service.getState()).toMatchObject({
      phase: "restart-required",
      availableVersion: "0.2.0-beta.2",
    });
    expect(pendingInstall.clear).toHaveBeenCalledTimes(1);
  });

  it("keeps polling the marker's own token while a channel switch is still running", () => {
    const { service, betaInstalledVersions, tickPoll, pendingInstall, cancelPoll } =
      createService({
        canInstall: true,
        currentVersion: "0.2.0-beta.1",
        pending: betaPending(NOW - 10_000),
      });

    tickPoll();
    // Observed on the PRE-RELEASE state: this marker was written by a channel
    // switch, and that is the state such an operation reports into. What this
    // test pins is the token the poll probes, not which state it lands on.
    expect(service.getPrereleaseState().phase).toBe("installing");

    betaInstalledVersions.add("0.2.0-beta.2");
    tickPoll();

    expect(service.getState().phase).toBe("restart-required");
    expect(pendingInstall.clear).toHaveBeenCalledTimes(1);
    expect(cancelPoll).toHaveBeenCalledTimes(1);
  });

  /**
   * `reconcilePendingInstall` accepts either a Caskroom RESOLVER or a
   * pre-resolved boolean, and the boolean discards the very thing the
   * contract is about — it records neither which version nor which token the
   * caller probed, so "did the version land on the target channel" can only
   * fall back to the version's SHAPE. Passing the resolver lets the Caskroom
   * answer instead, which is what survives a channel publishing a version
   * whose shape belongs to the other one.
   */
  it("reads the Caskroom, not the version's shape, to tell a landed switch from a rollback", () => {
    const { service, pendingInstall } = createService({
      canInstall: true,
      // Stable-shaped, but staged under the BETA token: the switch landed.
      currentVersion: "0.2.0",
      betaInstalledVersions: ["0.2.0"],
      pending: {
        fromVersion: "0.1.0",
        toVersion: "0.2.0-beta.1",
        startedAt: STALE,
        appPath: INSTALLED_APP_PATH,
        caskToken: BETA_CASK_TOKEN,
      },
    });

    // With only a boolean to go on, the shape fallback reads "0.2.0" as
    // stable, calls the switch rolled back, and reports an error into the
    // Pre-release section for an operation that actually worked.
    expect(service.getPrereleaseState().phase).toBe("up-to-date");
    expect(service.getState()).toMatchObject({ phase: "up-to-date" });
    expect(pendingInstall.clear).toHaveBeenCalledTimes(1);
  });

  it("names a rollback as a rollback in the log rather than an unchanged version", () => {
    const onLog = vi.fn();
    createService({
      canInstall: true,
      onLog,
      // Moved onto the channel the revert was LEAVING: the helper failed and
      // reinstalled the beta cask at its current version.
      currentVersion: "0.3.0-beta.4",
      pending: {
        fromVersion: "0.2.0-beta.1",
        toVersion: "0.1.9",
        startedAt: STALE,
        appPath: INSTALLED_APP_PATH,
        caskToken: STABLE_CASK_TOKEN,
      },
    });

    // "did not change the app version" is false here — it changed, just onto
    // the wrong channel, which is the one thing a reader must not be told
    // wrongly when diagnosing a stuck pre-release install.
    const logged = onLog.mock.calls.map(([, message]) => String(message));
    expect(logged).toContainEqual(expect.stringContaining("rolled back"));
    expect(logged).not.toContainEqual(
      expect.stringContaining("did not change the app version"),
    );
  });
});

/**
 * The riskiest path in this feature: a channel switch replaces the running
 * cask token, with a real window where nothing is installed at all. Every
 * assertion here is externally observable — the confirm call, the published
 * phases, the marker, the log lines, the quit — never internal structure.
 */
describe("switching to a pre-release build", () => {
  const readyToSwitch = async (
    overrides: Parameters<typeof createService>[0] = {},
  ) => {
    const candidate = prereleaseCandidate("0.2.0-beta.3", { dmgSize: 2_048 });
    const harness = createService({
      canInstall: true,
      activeChannel: "stable",
      getLatestPrerelease: () => Promise.resolve(candidate),
      ...overrides,
    });
    await harness.service.checkForPrerelease();
    return harness;
  };

  it("confirms the exact offered version exactly once, before any download, marker write, or quit", async () => {
    const order: string[] = [];
    const confirmPrereleaseSwitch = vi.fn(async (targetVersion: string) => {
      order.push(`confirm:${targetVersion}`);
      return true;
    });
    const { service, downloadUpdate, pendingInstall, quitApp } = await readyToSwitch({
      confirmPrereleaseSwitch,
    });
    downloadUpdate.mockImplementation(() => {
      order.push("download");
      return Promise.resolve();
    });
    pendingInstall.write.mockImplementation(() => order.push("marker"));
    quitApp.mockImplementation(() => order.push("quit"));

    const result = await service.switchToPrerelease();

    expect(result).toEqual({ success: true });
    expect(confirmPrereleaseSwitch).toHaveBeenCalledTimes(1);
    expect(confirmPrereleaseSwitch).toHaveBeenCalledWith("0.2.0-beta.3");
    expect(order).toEqual(["confirm:0.2.0-beta.3", "download", "marker", "quit"]);
  });

  it("leaves state, the marker, and quitApp completely untouched when the user declines", async () => {
    const { service, pendingInstall, quitApp, downloadUpdate, startChannelSwitch } =
      await readyToSwitch({
        confirmPrereleaseSwitch: () => Promise.resolve(false),
      });
    const before = service.getPrereleaseState();

    const result = await service.switchToPrerelease();

    expect(result).toEqual({ success: false, error: expect.anything() });
    expect(service.getPrereleaseState()).toEqual(before);
    expect(pendingInstall.write).not.toHaveBeenCalled();
    expect(quitApp).not.toHaveBeenCalled();
    expect(downloadUpdate).not.toHaveBeenCalled();
    expect(startChannelSwitch).not.toHaveBeenCalled();
  });

  it("publishes downloading with byte progress, then installing, and completes the download before quitting", async () => {
    const phases: string[] = [];
    let resolveDownload: (() => void) | undefined;
    const { service, tickPoll, quitApp } = await readyToSwitch({
      downloadedBytes: 512,
      downloadUpdate: () =>
        new Promise<void>((resolve) => {
          resolveDownload = resolve;
        }),
    });
    service.subscribeToPrereleaseState((s) => phases.push(s.phase));

    const switching = service.switchToPrerelease();
    // Let the confirm's microtask settle so the download poll is registered.
    await new Promise((resolve) => setImmediate(resolve));
    tickPoll();

    expect(service.getPrereleaseState()).toMatchObject({
      phase: "downloading",
      downloadedBytes: 512,
      totalBytes: 2_048,
    });
    expect(quitApp).not.toHaveBeenCalled();

    resolveDownload?.();
    await switching;

    expect(phases).toContain("installing");
    expect(quitApp).toHaveBeenCalledTimes(1);
  });

  it("writes the marker with the target cask token and logs both tokens and the version without a path", async () => {
    const onLog = vi.fn();
    const { service, pendingInstall } = await readyToSwitch({ onLog });

    await service.switchToPrerelease();

    expect(pendingInstall.write).toHaveBeenCalledWith({
      fromVersion: "0.1.0",
      toVersion: "0.2.0-beta.3",
      startedAt: NOW,
      appPath: INSTALLED_APP_PATH,
      caskToken: BETA_CASK_TOKEN,
      // Recorded rather than inferred: reconcile recovers the source channel
      // from `fromVersion`'s shape when this is absent, which is a guess
      // about which cask published that version.
      fromCaskToken: STABLE_CASK_TOKEN,
    });
    const logText = JSON.stringify(onLog.mock.calls);
    expect(logText).toContain(STABLE_CASK_TOKEN);
    expect(logText).toContain(BETA_CASK_TOKEN);
    expect(logText).toContain("0.2.0-beta.3");
    expect(logText).not.toContain(INSTALLED_APP_PATH);
  });

  it("refuses when nothing has been offered yet", async () => {
    const { service, confirmPrereleaseSwitch, startChannelSwitch } = createService({
      canInstall: true,
      activeChannel: "stable",
    });

    const result = await service.switchToPrerelease();

    expect(result.success).toBe(false);
    expect(confirmPrereleaseSwitch).not.toHaveBeenCalled();
    expect(startChannelSwitch).not.toHaveBeenCalled();
  });

  /**
   * The tap-lag gate CLAUDE.md marks never-delete, for the channel a switch
   * actually installs. GitHub publishes a beta before the tap syncs
   * `fixlang@beta` (cron, up to six hours), and the stable flow's own gate
   * cannot cover this path: it reads `state.availableVersion`, which is
   * always a stable version, and probes the stable token.
   */
  it("refuses to quit for a beta the pre-release tap cannot install yet", async () => {
    const {
      service,
      getInstallableVersion,
      downloadUpdate,
      startChannelSwitch,
      quitApp,
    } = await readyToSwitch({ installableVersion: "0.2.0-beta.1" });

    const result = await service.switchToPrerelease();

    expect(result.success).toBe(false);
    expect(getInstallableVersion).toHaveBeenCalledWith(true, BETA_CASK_TOKEN);
    expect(downloadUpdate).not.toHaveBeenCalled();
    expect(startChannelSwitch).not.toHaveBeenCalled();
    expect(quitApp).not.toHaveBeenCalled();
    expect(service.getPrereleaseState()).toMatchObject({
      phase: "error",
      message: msg("settings.updates.tapBehindMessage", {
        targetVersion: "0.2.0-beta.3",
        offeredVersion: "0.2.0-beta.1",
      }),
    });
  });

  /**
   * `activeChannel` is a CACHED display value and FixLang stays open for
   * days. A user who changes channel in a terminal leaves the panel
   * describing a cask that is no longer staged; committing that stale token
   * to the helper uninstalls a cask that is not installed, and the helper
   * exits without reopening the app it already quit.
   */
  it("refuses a switch when the live Caskroom no longer matches the offered channel", async () => {
    const harness = await readyToSwitch();
    harness.detectActiveCaskChannel.mockReturnValue("both");

    const result = await harness.service.switchToPrerelease();

    expect(result.success).toBe(false);
    expect(harness.downloadUpdate).not.toHaveBeenCalled();
    expect(harness.startChannelSwitch).not.toHaveBeenCalled();
    expect(harness.quitApp).not.toHaveBeenCalled();
    expect(harness.pendingInstall.write).not.toHaveBeenCalled();
    // The refusal republishes what was actually probed, so the badge stops
    // claiming a channel the user is no longer on.
    expect(harness.service.getPrereleaseState()).toMatchObject({
      phase: "error",
      activeChannel: "both",
      canSwitch: false,
    });
  });

  /**
   * The stable check's `installing` guard exists because "a check would
   * overwrite the state with `available` and re-arm a button that must stay
   * inert" — the pre-release copy dropped it, so a check during a switch
   * wipes the live download progress and can publish `available` moments
   * before `quitApp` fires.
   */
  it("refuses a pre-release check while a switch is downloading", async () => {
    const { service, releaseSource } = await readyToSwitch({
      downloadedBytes: 512,
      // Never resolves: the switch owns the state for the whole test.
      downloadUpdate: () => new Promise<void>(() => undefined),
    });
    releaseSource.getLatestPrerelease.mockClear();

    void service.switchToPrerelease();
    await new Promise((resolve) => setImmediate(resolve));
    expect(service.getPrereleaseState().phase).toBe("downloading");

    const state = await service.checkForPrerelease();

    expect(state.phase).toBe("downloading");
    expect(releaseSource.getLatestPrerelease).not.toHaveBeenCalled();
  });
});

describe("reverting to stable", () => {
  it("never calls the confirm dialog", async () => {
    const { service, confirmPrereleaseSwitch } = createService({
      canInstall: true,
      activeChannel: "beta",
      currentVersion: "0.2.0-beta.1",
      installableVersion: "0.1.9",
    });

    await service.revertToStable();

    expect(confirmPrereleaseSwitch).not.toHaveBeenCalled();
  });

  it("writes the marker with the stable cask token, sourced from the beta token", async () => {
    const { service, pendingInstall } = createService({
      canInstall: true,
      activeChannel: "beta",
      currentVersion: "0.2.0-beta.1",
      installableVersion: "0.1.9",
    });

    const result = await service.revertToStable();

    expect(result).toEqual({ success: true });
    expect(pendingInstall.write).toHaveBeenCalledWith({
      fromVersion: "0.2.0-beta.1",
      toVersion: "0.1.9",
      startedAt: NOW,
      appPath: INSTALLED_APP_PATH,
      caskToken: STABLE_CASK_TOKEN,
      fromCaskToken: BETA_CASK_TOKEN,
    });
  });

  it("refuses when the current channel is not beta", async () => {
    const { service, startChannelSwitch } = createService({
      canInstall: true,
      activeChannel: "stable",
    });

    const result = await service.revertToStable();

    expect(result.success).toBe(false);
    expect(startChannelSwitch).not.toHaveBeenCalled();
  });

  it("refuses when Homebrew cannot say what stable version it would install", async () => {
    const { service, startChannelSwitch } = createService({
      canInstall: true,
      activeChannel: "beta",
      currentVersion: "0.2.0-beta.1",
      installableVersion: null,
    });

    const result = await service.revertToStable();

    expect(result.success).toBe(false);
    expect(startChannelSwitch).not.toHaveBeenCalled();
  });

  /**
   * `getInstallableVersion` resolves null rather than throwing when brew
   * cannot be asked, so `probeInstallableVersion`'s catch never runs: the
   * refusal used to publish nothing and log nothing, leaving a dead button
   * with no trace of why.
   */
  it("says on screen and in the log why a revert could not start", async () => {
    const onLog = vi.fn();
    const { service } = createService({
      canInstall: true,
      activeChannel: "beta",
      currentVersion: "0.2.0-beta.1",
      installableVersion: null,
      onLog,
    });

    await service.revertToStable();

    expect(service.getPrereleaseState()).toMatchObject({
      phase: "error",
      message: msg("settings.updates.prerelease.revertErrorMessage"),
    });
    expect(onLog).toHaveBeenCalledWith("warn", expect.stringContaining("revert"));
  });

  /**
   * The f1 failure in the revert direction: the panel has been open for days
   * showing `beta` while the user ran `brew uninstall --cask fixlang@beta &&
   * brew install --cask fixlang` in a terminal. Committing the cached token
   * makes the helper quit the app, uninstall a cask that is not installed,
   * and exit on `|| exit 1` — after the download already succeeded, so
   * nothing on screen hints at what went wrong.
   */
  it("refuses when the beta cask is gone by the time the button is pressed", async () => {
    const harness = createService({
      canInstall: true,
      activeChannel: "beta",
      currentVersion: "0.2.0-beta.1",
      installableVersion: "0.1.9",
    });
    harness.detectActiveCaskChannel.mockReturnValue("stable");

    const result = await harness.service.revertToStable();

    expect(result.success).toBe(false);
    expect(harness.startChannelSwitch).not.toHaveBeenCalled();
    expect(harness.downloadUpdate).not.toHaveBeenCalled();
    expect(harness.pendingInstall.write).not.toHaveBeenCalled();
    expect(harness.quitApp).not.toHaveBeenCalled();
    expect(harness.service.getPrereleaseState()).toMatchObject({
      phase: "error",
      activeChannel: "stable",
    });
  });
});

/**
 * The mutual-exclusion criterion exists to prevent a specific silent
 * failure: two in-flight paths each pass their own tests while a SECOND flag
 * would let them run concurrently. Both directions share the exact same
 * `installing` flag the stable flow has always used — no second flag.
 */
describe("mutual exclusion between a stable install and a channel switch", () => {
  it("refuses a channel switch while a stable install is in flight, with no brew work", async () => {
    const candidate = prereleaseCandidate("0.2.0-beta.1");
    const { service, downloadUpdate, startChannelSwitch, confirmPrereleaseSwitch } =
      createService({
        canInstall: true,
        activeChannel: "stable",
        getLatestPrerelease: () => Promise.resolve(candidate),
      });
    await service.checkForUpdates();
    await service.checkForPrerelease();
    void service.installUpdate();

    const result = await service.switchToPrerelease();

    expect(result.success).toBe(false);
    expect(confirmPrereleaseSwitch).not.toHaveBeenCalled();
    expect(downloadUpdate).not.toHaveBeenCalledWith(BETA_CASK_TOKEN);
    expect(startChannelSwitch).not.toHaveBeenCalled();
  });

  it("returns early from installUpdate while a channel switch is in flight", async () => {
    const candidate = prereleaseCandidate("0.2.0-beta.1");
    const { service, startUpgrade, quitApp } = createService({
      canInstall: true,
      activeChannel: "stable",
      getLatestPrerelease: () => Promise.resolve(candidate),
      // Never resolves: keeps `installing` claimed for the whole test.
      confirmPrereleaseSwitch: () => new Promise<boolean>(() => undefined),
    });
    await service.checkForUpdates();
    await service.checkForPrerelease();
    void service.switchToPrerelease();

    const result = await service.installUpdate();

    // Same semantics as two concurrent stable installs: the second call
    // reports success because the first one already owns the in-flight work.
    expect(result).toEqual({ success: true });
    expect(startUpgrade).not.toHaveBeenCalled();
    expect(quitApp).not.toHaveBeenCalled();
  });
});

/**
 * The entry guards above only stop a check that STARTS during a channel
 * operation. A check already awaiting GitHub when the operation begins used
 * to publish its stale answer straight over the live one, in both directions
 * and on both states — the same single `installing` flag, read a second time
 * at the moment of publishing rather than only at entry.
 */
describe("a check already in flight when a channel operation starts", () => {
  /** Beta install with a stable version to fall back to, ready to revert. */
  const readyToRevert = (
    overrides: Parameters<typeof createService>[0] = {},
  ): ReturnType<typeof createService> & {
    resolveCandidate: (candidate: PrereleaseCandidate | null) => void;
  } => {
    let resolveCandidate: ((candidate: PrereleaseCandidate | null) => void) | undefined;
    const harness = createService({
      canInstall: true,
      activeChannel: "beta",
      currentVersion: "0.2.0-beta.1",
      installableVersion: "0.1.9",
      getLatestPrerelease: () =>
        new Promise<PrereleaseCandidate | null>((resolve) => {
          resolveCandidate = resolve;
        }),
      ...overrides,
    });
    return {
      ...harness,
      resolveCandidate: (candidate) => resolveCandidate?.(candidate),
    };
  };

  it("drops a stale pre-release answer rather than wiping a revert's live download progress", async () => {
    const { service, resolveCandidate } = readyToRevert({
      // Never resolves: the revert owns the state for the rest of the test.
      downloadUpdate: () => new Promise<void>(() => undefined),
    });

    const checking = service.checkForPrerelease();
    await new Promise((resolve) => setImmediate(resolve));
    expect(service.getPrereleaseState().phase).toBe("checking");

    void service.revertToStable();
    await new Promise((resolve) => setImmediate(resolve));
    expect(service.getPrereleaseState().phase).toBe("downloading");

    resolveCandidate(prereleaseCandidate("0.3.0-beta.9"));
    await checking;

    // Unfixed this reads `{phase: "available", offeredVersion:
    // "0.3.0-beta.9"}` — byte progress and spinner gone, a beta announced,
    // while Homebrew is in fact fetching the stable DMG.
    expect(service.getPrereleaseState()).toMatchObject({
      phase: "downloading",
      offeredVersion: "0.1.9",
    });
  });

  it("drops a stale pre-release answer that lands inside the quit delay", async () => {
    const phases: string[] = [];
    const { service, quitApp, resolveCandidate } = readyToRevert();
    service.subscribeToPrereleaseState((next) => phases.push(next.phase));

    const checking = service.checkForPrerelease();
    await new Promise((resolve) => setImmediate(resolve));

    expect(await service.revertToStable()).toEqual({ success: true });
    expect(quitApp).toHaveBeenCalledTimes(1);

    resolveCandidate(prereleaseCandidate("0.3.0-beta.9"));
    await checking;

    // Unfixed the sequence ends `[…, "installing", "available"]`, so the
    // stale offer is the LAST thing the renderer sees before the app quits.
    expect(phases).toEqual(["checking", "downloading", "installing"]);
    expect(service.getPrereleaseState()).toMatchObject({
      phase: "installing",
      offeredVersion: "0.1.9",
    });
  });

  /**
   * A check that FAILS is just as capable of overwriting a live operation as
   * one that succeeds: an `error` published over `downloading` replaces the
   * progress bar with "could not check", on an app that is downloading
   * perfectly well.
   */
  it("drops a stale pre-release failure rather than erroring over a live revert", async () => {
    let rejectCandidate: ((reason: Error) => void) | undefined;
    const { service } = readyToRevert({
      getLatestPrerelease: () =>
        new Promise<PrereleaseCandidate | null>((_resolve, reject) => {
          rejectCandidate = reject;
        }),
      downloadUpdate: () => new Promise<void>(() => undefined),
    });

    const checking = service.checkForPrerelease();
    await new Promise((resolve) => setImmediate(resolve));

    void service.revertToStable();
    await new Promise((resolve) => setImmediate(resolve));
    expect(service.getPrereleaseState().phase).toBe("downloading");

    rejectCandidate?.(new Error("GitHub said 403"));
    await checking;

    expect(service.getPrereleaseState()).toMatchObject({
      phase: "downloading",
      offeredVersion: "0.1.9",
    });
  });

  it("drops a stale stable answer rather than re-arming Install on a quitting app", async () => {
    let resolveRelease: ((release: unknown) => void) | undefined;
    const candidate = prereleaseCandidate("0.2.0-beta.3");
    const { service, quitApp } = createService({
      canInstall: true,
      activeChannel: "stable",
      getLatestPrerelease: () => Promise.resolve(candidate),
      getLatestRelease: () =>
        new Promise<unknown>((resolve) => {
          resolveRelease = resolve;
        }),
    });
    await service.checkForPrerelease();

    const checking = service.checkForUpdates();
    await new Promise((resolve) => setImmediate(resolve));
    expect(service.getState().phase).toBe("checking");

    expect(await service.switchToPrerelease()).toEqual({ success: true });
    expect(quitApp).toHaveBeenCalledTimes(1);

    resolveRelease?.(stableRelease());
    await checking;

    // Unfixed the ordinary Updates section flips to "0.2.0 is available"
    // with a live Install button, on an app that is quitting into a switch.
    expect(service.getState()).toMatchObject({
      phase: "checking",
      canInstall: true,
    });
    expect(service.getState()).not.toMatchObject({ phase: "available" });
  });
});

/**
 * The claim used to be a bare assignment released by an explicit statement on
 * each early return, so a collaborator that THREW between the two left the
 * flag stuck `true` for the lifetime of the process: every update path a
 * silent no-op, with `installUpdate` still answering `{success: true}`.
 * Unreachable through today's wiring only because the defences live in other
 * files (`index.ts` catches the dialog, `homebrew.ts` swallows `statSync`).
 */
describe("releasing the in-flight claim when a collaborator throws", () => {
  it("does not strand the flag when the confirm dialog rejects", async () => {
    const candidate = prereleaseCandidate("0.2.0-beta.3");
    const { service, releaseSource } = createService({
      canInstall: true,
      activeChannel: "stable",
      getLatestPrerelease: () => Promise.resolve(candidate),
      confirmPrereleaseSwitch: () => Promise.reject(new Error("dialog blew up")),
    });
    await service.checkForPrerelease();
    releaseSource.getLatestPrerelease.mockClear();

    await expect(service.switchToPrerelease()).rejects.toThrow("dialog blew up");

    // A stranded flag turns every guarded path into a silent no-op: the
    // check returns its old state without ever asking GitHub.
    await service.checkForPrerelease();
    expect(releaseSource.getLatestPrerelease).toHaveBeenCalledTimes(1);
  });

  it("does not strand the flag when the Caskroom probe throws mid-revert", async () => {
    const { service, detectActiveCaskChannel, startChannelSwitch } = createService({
      canInstall: true,
      activeChannel: "beta",
      currentVersion: "0.2.0-beta.1",
      installableVersion: "0.1.9",
    });
    detectActiveCaskChannel.mockImplementationOnce(() => {
      throw new Error("Caskroom unreadable");
    });

    await expect(service.revertToStable()).rejects.toThrow("Caskroom unreadable");

    // The Caskroom is readable again; a second press must be able to run.
    expect(await service.revertToStable()).toEqual({ success: true });
    expect(startChannelSwitch).toHaveBeenCalledTimes(1);
  });
});

/**
 * A channel operation's outcome belongs to the section whose button the user
 * pressed. Reporting it through `UpdateState` puts a revert's failure in the
 * ordinary Updates section, worded for an update ("Homebrew did not finish
 * the last update"), while the Pre-release section sits at `idle` with both
 * its buttons inert for up to the whole grace window and nothing on screen
 * explaining why.
 *
 * `caskToken` alone cannot route this: a revert targets the STABLE token
 * too, so its marker is token-identical to an ordinary stable upgrade. The
 * version it came FROM is what gives it away.
 */
describe("reporting a channel operation through the pre-release state", () => {
  const STALE = NOW - UPGRADE_GRACE_MS;
  const switchMarker = (startedAt: number) =>
    ({
      fromVersion: "0.1.0",
      toVersion: "0.2.0-beta.3",
      startedAt,
      appPath: INSTALLED_APP_PATH,
      caskToken: BETA_CASK_TOKEN,
    }) as const;
  /** Target token is STABLE — identical to an ordinary upgrade's marker. */
  const revertMarker = (startedAt: number) =>
    ({
      fromVersion: "0.2.0-beta.3",
      toVersion: "0.1.9",
      startedAt,
      appPath: INSTALLED_APP_PATH,
      caskToken: STABLE_CASK_TOKEN,
    }) as const;

  it("reports a stalled revert in the pre-release section, worded for a revert", () => {
    const { service, pendingInstall } = createService({
      canInstall: true,
      currentVersion: "0.2.0-beta.3",
      pending: revertMarker(STALE),
    });

    expect(service.getPrereleaseState()).toMatchObject({
      phase: "error",
      message: msg("settings.updates.prerelease.revertErrorMessage"),
    });
    expect(service.getState().phase).not.toBe("error");
    expect(service.getState().message).not.toEqual(
      msg("settings.updates.installIncompleteMessage"),
    );
    expect(pendingInstall.clear).toHaveBeenCalled();
  });

  it("reports a stalled switch in the pre-release section, worded for a switch", () => {
    const { service } = createService({
      canInstall: true,
      currentVersion: "0.1.0",
      pending: switchMarker(STALE),
    });

    expect(service.getPrereleaseState()).toMatchObject({
      phase: "error",
      message: msg("settings.updates.prerelease.switchErrorMessage"),
    });
    expect(service.getState().phase).not.toBe("error");
  });

  it("shows a still-running switch in the pre-release section rather than the ordinary one", () => {
    const { service } = createService({
      canInstall: true,
      currentVersion: "0.1.0",
      pending: switchMarker(NOW - 10_000),
    });

    expect(service.getPrereleaseState()).toMatchObject({
      phase: "installing",
      offeredVersion: "0.2.0-beta.3",
      message: msg("settings.updates.backgroundInstallMessage", {
        targetVersion: "0.2.0-beta.3",
      }),
    });
    expect(service.getState().phase).toBe("idle");
  });

  it("also reports a switch that finished in the background through the pre-release state", () => {
    const { service, betaInstalledVersions, tickPoll } = createService({
      canInstall: true,
      currentVersion: "0.1.0",
      pending: switchMarker(NOW - 10_000),
    });

    betaInstalledVersions.add("0.2.0-beta.3");
    tickPoll();

    expect(service.getPrereleaseState()).toMatchObject({
      phase: "restart-required",
      offeredVersion: "0.2.0-beta.3",
    });
  });

  /**
   * `restart-required` is the one outcome that carries an ACTION rather than
   * a report, and `restartForUpdate` is gated on `UpdateState.phase`. Routing
   * it away from that state would leave a user with the new build installed,
   * a Restart button that answers with an error, and no way out but quitting
   * by hand — so it is published to both states.
   */
  it("keeps the restart action reachable after a completed channel switch", () => {
    const { service, relaunchApp } = createService({
      canInstall: true,
      currentVersion: "0.1.0",
      pending: switchMarker(NOW - 10_000),
      betaInstalledVersions: ["0.2.0-beta.3"],
    });

    expect(service.getPrereleaseState().phase).toBe("restart-required");
    expect(service.getState().phase).toBe("restart-required");

    expect(service.restartForUpdate()).toEqual({ success: true });
    expect(relaunchApp).toHaveBeenCalledTimes(1);
  });

  it("leaves an ordinary stable update reporting through the ordinary section", () => {
    const { service } = createService({
      canInstall: true,
      currentVersion: "0.1.0",
      pending: {
        fromVersion: "0.1.0",
        toVersion: "0.2.0",
        startedAt: STALE,
        appPath: INSTALLED_APP_PATH,
        caskToken: STABLE_CASK_TOKEN,
      },
    });

    expect(service.getState()).toMatchObject({
      phase: "error",
      message: msg("settings.updates.installIncompleteMessage"),
    });
    expect(service.getPrereleaseState().phase).toBe("idle");
  });
});

/**
 * The ordinary flow upgrades the STABLE cask in place and only that. A beta
 * install has no stable Caskroom entry, so `startUpgrade` refuses one after
 * the button was already offered. That population reverts instead.
 */
describe("the ordinary install flow on a beta install", () => {
  it("does not offer one-click install, and asks brew nothing", async () => {
    const { service, getInstallableVersion, startUpgrade } = createService({
      canInstall: true,
      activeChannel: "beta",
      currentVersion: "0.2.0-beta.1",
    });

    await service.checkForUpdates();

    expect(service.getState()).toMatchObject({
      phase: "available",
      canInstall: false,
    });
    expect(getInstallableVersion).not.toHaveBeenCalled();

    const result = await service.installUpdate();

    expect(result.success).toBe(false);
    expect(startUpgrade).not.toHaveBeenCalled();
  });
});

/**
 * The in-flight claim's real boundary is the HAND-OFF, not the returned
 * result. Once the detached helper is spawned the app is committed: releasing
 * the flag after that point re-arms a button whose second press starts a
 * SECOND helper, and two helpers racing to uninstall and reinstall the same
 * two casks is strictly worse than the stranded flag the claim replaced.
 */
describe("claiming the app for the whole hand-off, not just the return value", () => {
  it("keeps the claim once the channel-switch helper is spawned, even if a later step throws", async () => {
    const { service, startChannelSwitch, quitApp } = createService({
      canInstall: true,
      activeChannel: "beta",
      currentVersion: "0.2.0-beta.1",
      installableVersion: "0.1.9",
      onLog: (_level, message) => {
        // The last statement before `quitApp`, and the first unguarded one
        // after the helper has already been started.
        if (message.startsWith("Channel switch from")) {
          throw new Error("log sink blew up");
        }
      },
    });

    await expect(service.revertToStable()).rejects.toThrow("log sink blew up");

    expect(startChannelSwitch).toHaveBeenCalledTimes(1);
    expect(quitApp).not.toHaveBeenCalled();

    // The helper owns the casks from here. A second press must be refused.
    await expect(service.revertToStable()).resolves.toEqual({
      success: false,
      error: msg("settings.updates.prerelease.revertErrorMessage"),
    });
    expect(startChannelSwitch).toHaveBeenCalledTimes(1);
  });

  it("does not strand the claim when a state listener throws mid-install", async () => {
    const { service, startUpgrade } = createService({ canInstall: true });
    await service.checkForUpdates();
    let thrown = false;
    service.subscribe((next) => {
      if (next.phase === "downloading" && !thrown) {
        thrown = true;
        throw new Error("listener blew up");
      }
    });

    await expect(service.installUpdate()).rejects.toThrow("listener blew up");
    expect(startUpgrade).not.toHaveBeenCalled();

    // A stranded flag freezes the check too, so the panel can never get back
    // to `available` — and every later press answers a lying `{success:true}`
    // with the upgrade never started.
    await service.checkForUpdates();
    expect(service.getState().phase).toBe("available");
    await expect(service.installUpdate()).resolves.toEqual({ success: true });
    expect(startUpgrade).toHaveBeenCalledTimes(1);
  });
});

/**
 * One doctrine per flow. The ordinary update flow names the STABLE cask at
 * every Homebrew call it makes and in the marker it writes — it never rides
 * whichever token `upgrader` happens to be bound to. Mixing the two is only
 * invisible while `canInstall` stays false on a beta install; the moment that
 * is relaxed, a mixed flow gates on one cask's version and upgrades another's.
 */
describe("the ordinary flow names one cask end to end", () => {
  it("passes the stable token to every Homebrew call and records it in the marker", async () => {
    let finishDownload: (() => void) | undefined;
    const { service, downloadUpdate, getDownloadedBytes, startUpgrade, pendingInstall, tickPoll } =
      createService({
        canInstall: true,
        downloadedBytes: 512,
        downloadUpdate: () =>
          new Promise<void>((resolve) => {
            finishDownload = resolve;
          }),
      });
    await service.checkForUpdates();

    const install = service.installUpdate();
    // Let the tap probe settle so the download poll is registered.
    await new Promise((resolve) => setImmediate(resolve));
    tickPoll();
    finishDownload?.();
    await expect(install).resolves.toEqual({ success: true });

    expect(downloadUpdate).toHaveBeenCalledWith(STABLE_CASK_TOKEN);
    expect(getDownloadedBytes).toHaveBeenCalledWith("0.2.0", STABLE_CASK_TOKEN);
    expect(startUpgrade).toHaveBeenCalledWith(INSTALLED_APP_PATH, STABLE_CASK_TOKEN);
    expect(pendingInstall.write).toHaveBeenCalledWith(
      expect.objectContaining({ caskToken: STABLE_CASK_TOKEN }),
    );
  });
});

/**
 * The marker records the token the operation STARTED on precisely so this
 * question stops being a guess about a version string's shape. A channel that
 * publishes a version belonging to the other channel's grammar is the whole
 * reason the field exists.
 */
describe("routing a marker by its recorded source token", () => {
  const STALE = NOW - UPGRADE_GRACE_MS;

  it("reports a revert whose beta build carried a stable-shaped version in the pre-release section", () => {
    const { service } = createService({
      canInstall: true,
      // Staged under the beta cask, but with no `-beta.N` in its version, so
      // `fromVersion`'s shape says "stable" and only `fromCaskToken` knows.
      currentVersion: "0.3.0",
      pending: {
        fromVersion: "0.3.0",
        toVersion: "0.1.9",
        startedAt: STALE,
        appPath: INSTALLED_APP_PATH,
        caskToken: STABLE_CASK_TOKEN,
        fromCaskToken: BETA_CASK_TOKEN,
      },
    });

    expect(service.getPrereleaseState()).toMatchObject({
      phase: "error",
      message: msg("settings.updates.prerelease.revertErrorMessage"),
    });
    expect(service.getState().message).not.toEqual(
      msg("settings.updates.installIncompleteMessage"),
    );
  });
});

/**
 * A rollback and a helper that never started are DIFFERENT outcomes, and card
 * 04 created the `rolled-back` variant to end exactly that conflation. Telling
 * them apart only in the log leaves the user — who is still on the channel
 * they asked to leave, under a build they never chose — reading the same
 * sentence as someone whose operation never began.
 */
describe("telling the user a channel operation rolled back", () => {
  const STALE = NOW - UPGRADE_GRACE_MS;

  it("words a rolled-back revert differently from a revert that never started", () => {
    const rolledBack = createService({
      canInstall: true,
      // The helper failed and reinstalled the beta cask at its own current
      // version, so the version moved while the revert did not happen.
      currentVersion: "0.3.0-beta.4",
      pending: {
        fromVersion: "0.2.0-beta.1",
        toVersion: "0.1.9",
        startedAt: STALE,
        appPath: INSTALLED_APP_PATH,
        caskToken: STABLE_CASK_TOKEN,
        fromCaskToken: BETA_CASK_TOKEN,
      },
    });
    const neverStarted = createService({
      canInstall: true,
      currentVersion: "0.2.0-beta.1",
      pending: {
        fromVersion: "0.2.0-beta.1",
        toVersion: "0.1.9",
        startedAt: STALE,
        appPath: INSTALLED_APP_PATH,
        caskToken: STABLE_CASK_TOKEN,
        fromCaskToken: BETA_CASK_TOKEN,
      },
    });

    expect(rolledBack.service.getPrereleaseState()).toMatchObject({
      phase: "error",
      message: msg("settings.updates.prerelease.revertRolledBackMessage", {
        currentVersion: "0.3.0-beta.4",
      }),
    });
    expect(neverStarted.service.getPrereleaseState()).toMatchObject({
      phase: "error",
      message: msg("settings.updates.prerelease.revertErrorMessage"),
    });
    expect(rolledBack.service.getPrereleaseState().message).not.toEqual(
      neverStarted.service.getPrereleaseState().message,
    );
  });

  it("words a rolled-back switch for the switch it was", () => {
    const { service } = createService({
      canInstall: true,
      // Rolled back onto the stable cask, which moved the user to stable's
      // current version rather than the one they pressed the button on.
      currentVersion: "0.3.0",
      pending: {
        fromVersion: "0.1.0",
        toVersion: "0.2.0-beta.3",
        startedAt: STALE,
        appPath: INSTALLED_APP_PATH,
        caskToken: BETA_CASK_TOKEN,
        fromCaskToken: STABLE_CASK_TOKEN,
      },
    });

    expect(service.getPrereleaseState()).toMatchObject({
      phase: "error",
      message: msg("settings.updates.prerelease.switchRolledBackMessage", {
        currentVersion: "0.3.0",
      }),
    });
  });
});
