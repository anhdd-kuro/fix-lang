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
import {
  RELEASE_NOTES_MAX_LENGTH,
  RELEASE_NOTES_TRUNCATION_MARKER,
} from "./releaseAsset";
import { createUpdateService } from "./updateService";
import type { PrereleaseCandidate } from "./githubReleaseSource";

/** Fixed clock so marker ages are exact rather than wall-clock dependent. */
const NOW = 1_700_000_000_000;
/** A high surrogate with no low surrogate after it — a cut astral character. */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])/;
const INSTALLED_APP_PATH = "/Applications/FixLang.app";
/** Same bundle id, different copy — a forgotten `pack:mac` build. */
const STRAY_APP_PATH = "/Users/dev/fix-lang/release/mac-arm64/FixLang.app";

// Every absolute-path SHAPE a line could leak, not one literal a later edit can
// sidestep. `Applications` is listed: the permitted path is placeholdered first.
const ABSOLUTE_PATH_SHAPE =
  /\/(Applications|Users|Library|Volumes|System|Network|opt|usr|bin|sbin|etc|var|tmp|private|home)\//;

// Blanks the one path the criterion allows: the app bundle path logged elsewhere.
const withoutTheAllowedAppBundlePath = (text: string): string =>
  text.split(INSTALLED_APP_PATH).join("<app-bundle-path>");

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

// Already validated upstream, so the fake returns a shaped candidate, not JSON.
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
     * collaborator wired, and defaults to `"stable"` only for a cask-capable
     * fixture, since a non-cask build stages nothing either.
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
  // Typed with the REAL signature: a mock blind to the cask token cannot pin it.
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

    const notes = service.getState().releaseNotes;
    expect(notes?.startsWith("<strong>")).toBe(true);
    expect(notes?.slice(0, RELEASE_NOTES_MAX_LENGTH)).toHaveLength(12_000);
    expect(notes?.slice(RELEASE_NOTES_MAX_LENGTH)).toBe(
      RELEASE_NOTES_TRUNCATION_MARKER,
    );
  });

  describe("truncating stable release notes", () => {
    const notesFor = async (body: string): Promise<string | undefined> => {
      const { service } = createService({
        getLatestRelease: () =>
          Promise.resolve(stableRelease("v0.2.0", { body })),
      });
      await service.checkForUpdates();
      return service.getState().releaseNotes;
    };

    it("marks cut notes so the reader can tell truncation from the real end", async () => {
      const notes = await notesFor("a".repeat(13_000));

      expect(notes?.endsWith(RELEASE_NOTES_TRUNCATION_MARKER)).toBe(true);
    });

    it("never leaves a lone surrogate when the cut lands inside an astral character", async () => {
      // The emoji straddles the 12,000th UTF-16 code unit.
      const notes = await notesFor(
        `${"a".repeat(RELEASE_NOTES_MAX_LENGTH - 1)}😀${"b".repeat(2_000)}`,
      );

      expect(notes).toBeDefined();
      expect(LONE_SURROGATE.test(notes ?? "")).toBe(false);
    });

    it("closes a code fence the cut left open", async () => {
      const notes = await notesFor(`\`\`\`js\n${"a".repeat(13_000)}\n\`\`\``);

      expect(notes?.endsWith(`\n\`\`\`${RELEASE_NOTES_TRUNCATION_MARKER}`)).toBe(
        true,
      );
    });

    // `releaseAsset.test.ts` pins the stripping; this pins that the stable flow
    // still runs the notes through it, which a re-forked helper would undo.
    it("strips bidi overrides that would make a link label read as another URL", async () => {
      const notes = await notesFor(
        "[https://github.com/anhdd-kuro/\u202Egnal-xif\u202C](https://evil.example/phish)",
      );

      expect(notes).toBe(
        "[https://github.com/anhdd-kuro/gnal-xif](https://evil.example/phish)",
      );
    });
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
    // The bundle is named because the id can resolve to another copy of FixLang.
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
    await service.checkForUpdates();
    expect(service.getState().phase).toBe("available");
    getInstallableVersion.mockResolvedValueOnce("0.1.0");
    await service.installUpdate();

    expect(startUpgrade).not.toHaveBeenCalled();
    expect(service.getState().phase).toBe("error");
  });
});

// The button runs Homebrew, so the check asks Homebrew: offering a release the cask
// cannot install yet is what made the button look dead for hours after a release.
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
    // Not installable, but readable: that exact release, not /releases/latest.
    expect(service.getReleaseUrl()).toBe(
      "https://github.com/anhdd-kuro/fix-lang/releases/tag/v0.2.0",
    );
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

    // `brew update` is a git fetch across every tap; a routine check must not.
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
    // The gate still covers a brew that could not answer at check time.
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

// The app quits in a second while Homebrew works for minutes; calling that window a
// failure re-arms a button whose second click dies on the download lock.
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

// The download runs with the app still open; only the bundle swap follows the quit.
describe("downloading before quitting", () => {
  const ready = async (
    overrides: Parameters<typeof createService>[0] = {},
  ) => {
    const harness = createService({ canInstall: true, ...overrides });
    await harness.service.checkForUpdates();
    return harness;
  };

  // Fetching one cask and upgrading another throws after the download succeeded.
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

// `open -b` cannot replace a running app — LaunchServices focuses it — so a user
// who reopened early is stuck on the old binary until the bundle is re-executed.
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

  // The helper's `open -b` can resolve the shared bundle id to a stray, older build.
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
    expect(releaseSource.getLatestPrerelease).not.toHaveBeenCalled();
  });

  // Switch and revert both refuse `"both"`, so the ORDINARY button has to as well:
  // it upgraded a bundle the beta cask also claims, and the app quits first, so the
  // failure landed with no UI left to report it.
  it("withholds one-click from the ordinary flow while both casks are staged", async () => {
    const { service, startUpgrade, downloadUpdate } = createService({
      canInstall: true,
      activeChannel: "both",
      currentVersion: "0.1.0",
      installableVersion: "0.2.0",
    });

    expect(service.getState().canInstall).toBe(false);

    const result = await service.installUpdate();

    expect(result.success).toBe(false);
    expect(startUpgrade).not.toHaveBeenCalled();
    expect(downloadUpdate).not.toHaveBeenCalled();
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

  // `canInstall` is scoped to the bound (stable) token, and a beta install has no
  // stable Caskroom entry — the exact population Revert exists to serve.
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

    // Display says "stable" — correct for a manual DMG — but proves nothing staged.
    expect(result).toMatchObject({ activeChannel: "stable", canSwitch: false });
  });

  // The source THROWS on a failed request but resolves `null` when nothing qualifies:
  // one tolerant wrapper over both publishes a 403 as "up-to-date".
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

// Probing the BOUND channel rather than the marker's own leaves a good beta `failed`.
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
    // LIMIT: this pins the token the poll probes, not which state it lands on —
    // the pre-release state is simply where a switch's marker reports.
    expect(service.getPrereleaseState().phase).toBe("installing");

    betaInstalledVersions.add("0.2.0-beta.2");
    tickPoll();

    expect(service.getState().phase).toBe("restart-required");
    expect(pendingInstall.clear).toHaveBeenCalledTimes(1);
    expect(cancelPoll).toHaveBeenCalledTimes(1);
  });

  // A pre-resolved boolean records neither version nor token, so landed-or-rolled-
  // back falls back to the version's SHAPE; the resolver lets the Caskroom answer.
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

    // On the shape alone, "0.2.0" reads as stable and a working switch as a rollback.
    expect(service.getPrereleaseState().phase).toBe("up-to-date");
    expect(service.getState()).toMatchObject({ phase: "up-to-date" });
    expect(pendingInstall.clear).toHaveBeenCalledTimes(1);
  });

  it("names a rollback as a rollback in the log rather than an unchanged version", () => {
    const onLog = vi.fn();
    createService({
      canInstall: true,
      onLog,
      // Moved onto the channel the revert was LEAVING, by a failed helper.
      currentVersion: "0.3.0-beta.4",
      pending: {
        fromVersion: "0.2.0-beta.1",
        toVersion: "0.1.9",
        startedAt: STALE,
        appPath: INSTALLED_APP_PATH,
        caskToken: STABLE_CASK_TOKEN,
      },
    });

    // "did not change the app version" would be false: it changed, onto the wrong one.
    const logged = onLog.mock.calls.map(([, message]) => String(message));
    expect(logged).toContainEqual(expect.stringContaining("rolled back"));
    expect(logged).not.toContainEqual(
      expect.stringContaining("did not change the app version"),
    );
  });
});

// A channel switch replaces the running cask token, with a real window where nothing
// is installed. Everything asserted here is externally observable.
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
      // Recorded, so reconcile need not guess the source channel from a version shape.
      fromCaskToken: STABLE_CASK_TOKEN,
    });
    const logText = JSON.stringify(onLog.mock.calls);
    expect(logText).toContain(STABLE_CASK_TOKEN);
    expect(logText).toContain(BETA_CASK_TOKEN);
    expect(logText).toContain("0.2.0-beta.3");
    // Stricter than the criterion: no path at all, not even the permitted one.
    expect(logText).not.toContain(INSTALLED_APP_PATH);
    // "No path BEYOND the app bundle path", as a shape after placeholdering the one
    // permitted: a single-literal check lets every other path through.
    expect(withoutTheAllowedAppBundlePath(logText)).not.toMatch(
      ABSOLUTE_PATH_SHAPE,
    );
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

  // The never-delete tap-lag gate, for the channel a switch installs: the stable
  // flow's own gate reads `state.availableVersion` and probes the stable token.
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

  // `activeChannel` is a CACHED display value on an app open for days; a stale token
  // exits the helper with the app already quit.
  it("refuses a switch when the live Caskroom no longer matches the offered channel", async () => {
    const harness = await readyToSwitch();
    harness.detectActiveCaskChannel.mockReturnValue("both");

    const result = await harness.service.switchToPrerelease();

    expect(result.success).toBe(false);
    expect(harness.downloadUpdate).not.toHaveBeenCalled();
    expect(harness.startChannelSwitch).not.toHaveBeenCalled();
    expect(harness.quitApp).not.toHaveBeenCalled();
    expect(harness.pendingInstall.write).not.toHaveBeenCalled();
    // The refusal republishes what was probed, so the badge stops lying.
    expect(harness.service.getPrereleaseState()).toMatchObject({
      phase: "error",
      activeChannel: "both",
      canSwitch: false,
    });
  });

  // Without the stable check's `installing` guard, a check during a switch wipes live
  // progress and can publish `available` moments before the quit.
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

  // `getInstallableVersion` resolves null rather than throwing, so no catch runs.
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

  // The same staleness in the revert direction, where the stale token exits the
  // helper on `|| exit 1` with the app already quit.
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
 * Both tokens staged at once — what a partially-failed switch leaves behind. These
 * pin the ENTRY GUARD on the two actions, which the switch's own `"both"` test does
 * not: it flips the probe AFTER a successful check, so `canSwitch` is still true
 * there and `brew info` has already run. It matters most for Revert, which asks no
 * confirmation: `brew uninstall --cask` removes artifacts by PATH, and both tokens
 * ship the same `/Applications/FixLang.app`.
 */
describe("both cask tokens staged at check time", () => {
  const bothStaged = async (): Promise<ReturnType<typeof createService>> => {
    const harness = createService({
      canInstall: true,
      activeChannel: "both",
      currentVersion: "0.2.0-beta.1",
      installableVersion: "0.1.9",
      getLatestPrerelease: () =>
        Promise.resolve(prereleaseCandidate("0.2.0-beta.3")),
    });
    // The ambiguity is present BEFORE the press, so `canSwitch` is false at the entry
    // guard — unlike the switch test, which flips the probe after a check.
    await harness.service.checkForPrerelease();
    return harness;
  };

  const bothCasksMessage = msg("settings.updates.prerelease.bothCasksMessage", {
    stableToken: STABLE_CASK_TOKEN,
    betaToken: BETA_CASK_TOKEN,
    fixCommand: `brew uninstall --cask ${BETA_CASK_TOKEN}`,
  });

  // "Not called at all", not "not called with the wrong token": an ambiguous install
  // is decided from the two directory probes alone.
  const expectNoBrewWork = (
    harness: ReturnType<typeof createService>,
  ): void => {
    expect(harness.getInstallableVersion).not.toHaveBeenCalled(); // brew info
    expect(harness.downloadUpdate).not.toHaveBeenCalled(); // brew fetch
    expect(harness.startUpgrade).not.toHaveBeenCalled(); // brew upgrade
    expect(harness.startChannelSwitch).not.toHaveBeenCalled(); // switch helper
    expect(harness.quitApp).not.toHaveBeenCalled();
    expect(harness.pendingInstall.write).not.toHaveBeenCalled();
  };

  it("refuses a switch, with no brew work and the descriptor left standing", async () => {
    const harness = await bothStaged();

    const result = await harness.service.switchToPrerelease();

    expect(result.success).toBe(false);
    expect(harness.confirmPrereleaseSwitch).not.toHaveBeenCalled();
    expectNoBrewWork(harness);
    expect(harness.service.getPrereleaseState()).toMatchObject({
      phase: "error",
      activeChannel: "both",
      canSwitch: false,
      message: bothCasksMessage,
    });
  });

  it("refuses a revert, with no brew work and the descriptor left standing", async () => {
    const harness = await bothStaged();

    const result = await harness.service.revertToStable();

    expect(result.success).toBe(false);
    expectNoBrewWork(harness);
    expect(harness.service.getPrereleaseState()).toMatchObject({
      phase: "error",
      activeChannel: "both",
      canSwitch: false,
      message: bothCasksMessage,
    });
  });

  // Both refusals publish nothing, so the ambiguity and its remedy survive both.
  it("still refuses after the other action has already been refused", async () => {
    const harness = await bothStaged();

    const switched = await harness.service.switchToPrerelease();
    const reverted = await harness.service.revertToStable();

    expect([switched.success, reverted.success]).toEqual([false, false]);
    expectNoBrewWork(harness);
    expect(harness.service.getPrereleaseState()).toMatchObject({
      activeChannel: "both",
      canSwitch: false,
      message: bothCasksMessage,
    });
  });
});

// Both directions share the exact same `installing` flag the stable flow uses: a
// SECOND flag would let two operations run while each path still passed alone.
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

    // As with two concurrent stable installs, the second call reports the first's win.
    expect(result).toEqual({ success: true });
    expect(startUpgrade).not.toHaveBeenCalled();
    expect(quitApp).not.toHaveBeenCalled();
  });
});

// The entry guards above only stop a check that STARTS during a channel operation;
// one already awaiting GitHub needs the flag read again at PUBLISH time.
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

    // Unfixed this publishes a beta offer, spinner gone, while Homebrew fetches the
    // stable DMG.
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

    // Unfixed the stale offer is the last thing the renderer sees before the quit.
    expect(phases).toEqual(["checking", "downloading", "installing"]);
    expect(service.getPrereleaseState()).toMatchObject({
      phase: "installing",
      offeredVersion: "0.1.9",
    });
  });

  // A failing check overwrites a live operation too: `error` over `downloading`
  // replaces the progress bar with "could not check".
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

    // Unfixed the ordinary section arms Install on an app quitting into a switch.
    expect(service.getState()).toMatchObject({
      phase: "checking",
      canInstall: true,
    });
    expect(service.getState()).not.toMatchObject({ phase: "available" });
  });
});

// A collaborator throwing between the claim and its release strands the flag for the
// process lifetime, with `installUpdate` still answering `{success: true}`.
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

    // A stranded flag makes the check return its old state without asking GitHub.
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

    expect(await service.revertToStable()).toEqual({ success: true });
    expect(startChannelSwitch).toHaveBeenCalledTimes(1);
  });
});

/**
 * An outcome belongs to the section whose button was pressed: routed through
 * `UpdateState`, a revert's failure lands in the ordinary Updates section worded
 * for an update, while the Pre-release section sits at `idle` with both buttons
 * inert. `caskToken` alone cannot route it — a revert targets the STABLE token
 * too, so its marker is token-identical to an ordinary upgrade, and `fromVersion`
 * is what gives it away.
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

  // `restartForUpdate` is gated on `UpdateState.phase`, so this outcome goes to BOTH
  // states or the Restart button errors on an installed build.
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

// The ordinary flow upgrades the STABLE cask only; a beta install reverts instead.
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

// The claim's boundary is the HAND-OFF, not the returned result: released once the
// helper is spawned, a second press starts a SECOND helper over the same casks.
describe("claiming the app for the whole hand-off, not just the return value", () => {
  it("keeps the claim once the channel-switch helper is spawned, even if a later step throws", async () => {
    const { service, startChannelSwitch, quitApp } = createService({
      canInstall: true,
      activeChannel: "beta",
      currentVersion: "0.2.0-beta.1",
      installableVersion: "0.1.9",
      onLog: (_level, message) => {
        // The last statement before `quitApp`, and the first after the hand-off.
        if (message.startsWith("Channel switch from")) {
          throw new Error("log sink blew up");
        }
      },
    });

    await expect(service.revertToStable()).rejects.toThrow("log sink blew up");

    expect(startChannelSwitch).toHaveBeenCalledTimes(1);
    expect(quitApp).not.toHaveBeenCalled();

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

    await service.checkForUpdates();
    expect(service.getState().phase).toBe("available");
    await expect(service.installUpdate()).resolves.toEqual({ success: true });
    expect(startUpgrade).toHaveBeenCalledTimes(1);
  });
});

// The ordinary flow NAMES the stable cask at every call, never riding whatever token
// `upgrader` is bound to — mixing them is invisible only while a beta cannot install.
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

// The marker records the token the operation STARTED on, so this is not a guess.
describe("routing a marker by its recorded source token", () => {
  const STALE = NOW - UPGRADE_GRACE_MS;

  it("reports a revert whose beta build carried a stable-shaped version in the pre-release section", () => {
    const { service } = createService({
      canInstall: true,
      // Staged under the beta cask with no `-beta.N`, so only `fromCaskToken` knows.
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

// A rollback and a helper that never started are DIFFERENT outcomes: told apart only
// in the log, both users read the same sentence on screen.
describe("telling the user a channel operation rolled back", () => {
  const STALE = NOW - UPGRADE_GRACE_MS;

  it("words a rolled-back revert differently from a revert that never started", () => {
    const rolledBack = createService({
      canInstall: true,
      // The beta cask was reinstalled at its own version: moved, but not reverted.
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
      // Rolled back onto stable's CURRENT version, not the one pressed on.
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
