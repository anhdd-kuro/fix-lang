import { msg, type Message } from "~/features/i18n/shared/message";
import {
  BETA_CASK_TOKEN,
  STABLE_CASK_TOKEN,
  type ActiveCaskChannel,
  type HomebrewUpgrader,
} from "./homebrew";
import {
  reconcilePendingInstall,
  UPGRADE_GRACE_MS,
  type PendingInstallStore,
} from "./pendingInstall";
import {
  comparePrereleaseOrder,
  parsePrereleaseVersion,
  type PrereleaseVersion,
} from "./prereleaseVersion";
import type { GitHubReleaseSource, PrereleaseCandidate } from "./githubReleaseSource";
import type { PrereleaseState } from "~/features/update/shared/prerelease";
import type {
  InstallUpdateResult,
  UpdateActionResult,
  UpdateState,
} from "~/features/update/shared/update";

export type UpdateService = {
  getState: () => UpdateState;
  checkForUpdates: () => Promise<void>;
  installUpdate: () => Promise<InstallUpdateResult>;
  restartForUpdate: () => UpdateActionResult;
  getReleaseUrl: () => string | null;
  subscribe: (listener: (state: UpdateState) => void) => () => void;
  /**
   * A SECOND, independently-published state — see `PrereleaseState`'s doc
   * comment. Discovery only: `switchToPrerelease`/`revertToStable` (the
   * actions `PrereleaseUpdateService` in
   * `~/features/update/main/update.ts` also needs) are added by a later card.
   */
  getPrereleaseState: () => PrereleaseState;
  /**
   * The ONLY place `releaseSource.getLatestPrerelease` is ever called.
   * `checkForUpdates` must never reach it — see that method's doc comment.
   */
  checkForPrerelease: () => Promise<PrereleaseState>;
  subscribeToPrereleaseState: (
    listener: (state: PrereleaseState) => void,
  ) => () => void;
};

type UpdateServiceOptions = {
  releaseSource: GitHubReleaseSource;
  isPackaged: boolean;
  platform: string;
  arch: string;
  getCurrentVersion: () => string;
  /** Absent in unsupported builds; then one-click install is simply off. */
  upgrader?: HomebrewUpgrader;
  pendingInstall?: PendingInstallStore;
  /**
   * `.app` root of the running process. Recorded in the pending marker so the
   * helper reopens this exact bundle and the next launch can tell it apart
   * from another copy of FixLang carrying the same bundle id.
   */
  appPath?: string | null;
  /** Called after the detached helper starts, so it can replace the bundle. */
  quitApp?: () => void;
  /**
   * Restarts into the updated app. With a target path, that bundle is opened
   * (this process is running a different one); otherwise the current bundle —
   * which Homebrew already replaced — is re-executed.
   */
  relaunchApp?: (targetPath: string | null) => void;
  onLog?: (level: "info" | "warn" | "error", message: string) => void;
  /** Injectable clock so marker ages are testable. */
  now?: () => number;
  /** Injectable repeating timer; returns its own cancel function. */
  schedulePoll?: (run: () => void, intervalMs: number) => () => void;
  /**
   * Which cask token(s) are actually staged in the Caskroom right now — two
   * cheap directory probes, no subprocess (`homebrew.ts`'s
   * `detectActiveCaskChannel`). Absent here on purpose: that function needs
   * a resolved `brewBinary` that `HomebrewUpgrader` computes internally and
   * never exposes, so wiring a real implementation means resolving the
   * binary path outside this module and passing the bound function in —
   * `src/main/update/index.ts` is out of this card's scope, so that wiring
   * is left to the card that adds the switch/revert actions. Undefined (and
   * a null result) both resolve to `"stable"`, the correct default for every
   * install this app has ever shipped.
   */
  detectActiveCaskChannel?: () => ActiveCaskChannel | null;
};

type StableVersion = Readonly<{
  raw: string;
  major: number;
  minor: number;
  patch: number;
}>;

type ValidatedRelease = Readonly<{
  version: StableVersion;
  releaseNotes?: string;
  /** DMG byte count from the release asset — the denominator for progress. */
  dmgSize: number;
}>;

const RELEASE_NOTES_MAX_LENGTH = 12_000;
// These are locale-free descriptors, not prose — the strings underneath
// live in `settings.updates.*` (en/ja), and the renderer resolves them via
// `tm()` so an already-open Settings panel updates on a locale switch
// instead of freezing in whatever locale was active when this state was
// published (see `~/features/update/shared/update.ts`'s `UpdateState.message`).
const UPDATE_ERROR_MESSAGE: Message = msg("settings.updates.checkErrorMessage");
const INSTALL_ERROR_MESSAGE: Message = msg("settings.updates.installErrorMessage");
const INSTALL_INCOMPLETE_MESSAGE: Message = msg(
  "settings.updates.installIncompleteMessage",
);
const RESTART_ERROR_MESSAGE: Message = msg("settings.updates.restartErrorMessage");
const DOWNLOAD_ERROR_MESSAGE: Message = msg("settings.updates.downloadErrorMessage");

/** How often a background upgrade is re-checked while the app is reopened. */
const UPGRADE_POLL_INTERVAL_MS = 15_000;
/** Fast enough that a progress bar looks live without churning the renderer. */
const DOWNLOAD_POLL_INTERVAL_MS = 500;

/**
 * Homebrew is still working and this app was reopened before it finished. Not
 * an error — saying so is the whole point.
 */
const backgroundInstallMessage = (target: string): Message =>
  msg("settings.updates.backgroundInstallMessage", { targetVersion: target });

/**
 * The bundle on disk is already the new version; only this process is stale.
 * The helper's closing `open -b` cannot fix that — it just focuses the running
 * app — so the user is offered an explicit restart instead.
 */
const restartRequiredMessage = (target: string): Message =>
  msg("settings.updates.restartRequiredMessage", { targetVersion: target });

/**
 * The upgrade succeeded, but a *different* copy of FixLang was reopened — one
 * that shares the bundle id, so `open -b` could resolve to it. Naming the
 * upgraded bundle is the whole point: the stray copy is usually a forgotten
 * `pack:mac` build in a checkout, and nothing else on screen would reveal it.
 */
const wrongBundleMessage = (target: string, targetPath: string): Message =>
  msg("settings.updates.wrongBundleMessage", {
    targetVersion: target,
    targetPath,
  });

const defaultSchedulePoll = (
  run: () => void,
  intervalMs: number,
): (() => void) => {
  const timer = setInterval(run, intervalMs);
  // Never hold the process open just to watch an upgrade.
  timer.unref?.();
  return () => clearInterval(timer);
};

/**
 * Releases reach GitHub before the Homebrew tap picks them up, so the app can
 * advertise a version the cask cannot install yet. Say so instead of quitting
 * for an upgrade that would silently no-op.
 */
const tapBehindMessage = (target: string, offered: string): Message =>
  msg("settings.updates.tapBehindMessage", {
    targetVersion: target,
    offeredVersion: offered,
  });

/**
 * A release exists but Homebrew cannot install it yet. Reported instead of
 * offering a button that would have nothing to do — the check now answers
 * "what can be installed", not "what has been published".
 */
const tapPendingMessage = (published: string): Message =>
  msg("settings.updates.tapPendingMessage", { publishedVersion: published });

/**
 * Both cask tokens staged at once only happens when a previous channel
 * switch died mid-flight — it installed the target and never got to
 * uninstall the source. Guessing which one is "really" active risks
 * uninstalling the app bundle that is still running, so this refuses to
 * pick a side and names the exact fix instead. New key for card 10's
 * catalogs: `settings.updates.prerelease.bothCasksMessage`.
 */
const BOTH_CASKS_FIX_COMMAND = `brew uninstall --cask ${BETA_CASK_TOKEN}`;
const bothCasksInstalledMessage = (): Message =>
  msg("settings.updates.prerelease.bothCasksMessage", {
    stableToken: STABLE_CASK_TOKEN,
    betaToken: BETA_CASK_TOKEN,
    fixCommand: BOTH_CASKS_FIX_COMMAND,
  });

const RELEASES_URL = "https://github.com/anhdd-kuro/fix-lang/releases";
const STABLE_VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

const SAFE_ERROR_NAMES = new Set([
  "AbortError",
  "Error",
  "RangeError",
  "TypeError",
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const parseStableVersion = (value: unknown): StableVersion | null => {
  if (typeof value !== "string") return null;
  const match = STABLE_VERSION_PATTERN.exec(value);
  if (!match) return null;

  const [major, minor, patch] = match.slice(1).map(Number);
  if (![major, minor, patch].every(Number.isSafeInteger)) return null;

  return Object.freeze({ raw: value, major, minor, patch });
};

/**
 * The installed version parses as either grammar: a stable `X.Y.Z`, or —
 * once a user is on the pre-release channel — `X.Y.Z-beta.N`. Both shapes
 * satisfy `OrderableVersion` structurally (see `prereleaseVersion.ts`), so
 * `comparePrereleaseOrder` below can rank a stable release against a
 * beta-current without either module knowing about the other's type.
 */
const parseCurrentVersion = (
  value: string,
): StableVersion | PrereleaseVersion | null =>
  parseStableVersion(value) ?? parsePrereleaseVersion(value);

const normalizeReleaseNotes = (raw: string | undefined): string | undefined => {
  const trimmed = raw?.trim();
  return trimmed && trimmed.length > 0
    ? trimmed.slice(0, RELEASE_NOTES_MAX_LENGTH)
    : undefined;
};

/** Size of the expected, fully uploaded DMG asset, or null when absent. */
const expectedDmgSize = (
  assets: unknown,
  version: StableVersion,
): number | null => {
  if (!Array.isArray(assets)) return null;
  const expectedName = `FixLang-${version.raw}-arm64.dmg`;

  const asset = assets.find(
    (candidate) =>
      isRecord(candidate) &&
      candidate.name === expectedName &&
      candidate.state === "uploaded" &&
      typeof candidate.size === "number" &&
      Number.isSafeInteger(candidate.size) &&
      candidate.size > 0,
  );
  return isRecord(asset) && typeof asset.size === "number" ? asset.size : null;
};

const validateRelease = (value: unknown): ValidatedRelease | null => {
  if (!isRecord(value) || value.draft !== false || value.prerelease !== false) {
    return null;
  }
  if (typeof value.tag_name !== "string") return null;

  const tagMatch = /^v(.+)$/.exec(value.tag_name);
  const version = tagMatch ? parseStableVersion(tagMatch[1]) : null;
  const dmgSize = version === null ? null : expectedDmgSize(value.assets, version);
  if (!version || dmgSize === null) return null;
  // GitHub returns JSON null when a release has no notes.
  if (value.body != null && typeof value.body !== "string") return null;

  return Object.freeze({
    version,
    dmgSize,
    releaseNotes: normalizeReleaseNotes(
      typeof value.body === "string" ? value.body : undefined,
    ),
  });
};

const safeErrorName = (error: unknown): string => {
  if (!(error instanceof Error) || !SAFE_ERROR_NAMES.has(error.name)) {
    return "UnknownError";
  }
  return error.name;
};

const freezeState = (state: UpdateState): UpdateState =>
  Object.freeze({ ...state });

const freezePrereleaseState = (state: PrereleaseState): PrereleaseState =>
  Object.freeze({ ...state });

/**
 * Owns release state plus the Homebrew-only install action. GitHub metadata is
 * untrusted until validated; the release URL is derived locally rather than
 * accepted from the response, and the upgrade itself is delegated to Homebrew
 * so nothing here has to automate Gatekeeper.
 */
export const createUpdateService = (
  options: UpdateServiceOptions,
): UpdateService => {
  const currentVersion = options.getCurrentVersion();
  const supported =
    options.isPackaged && options.platform === "darwin" && options.arch === "arm64";
  const canInstall = supported && (options.upgrader?.canInstall ?? false);
  const listeners = new Set<(state: UpdateState) => void>();
  const now = options.now ?? Date.now;
  const schedulePoll = options.schedulePoll ?? defaultSchedulePoll;
  let checking = false;
  let installing = false;
  let releaseUrl: string | null = null;
  /** Denominator for download progress; only known after a successful check. */
  let availableDmgSize: number | null = null;
  const appPath = options.appPath ?? null;
  /**
   * Bundle a restart must open instead of re-executing this one. Set only when
   * this process turns out to be a different copy of FixLang than the one that
   * was upgraded, where re-exec would just relaunch the wrong app again.
   */
  let restartTargetPath: string | null = null;

  const withCanInstall = (next: Omit<UpdateState, "canInstall">): UpdateState =>
    freezeState({ ...next, canInstall });

  let state = withCanInstall({
    phase: supported ? "idle" : "unsupported",
    currentVersion,
    ...(supported
      ? {}
      : { message: msg("settings.updates.unsupported") }),
  });

  const publish = (next: Omit<UpdateState, "canInstall">): void => {
    state = withCanInstall(next);
    for (const listener of listeners) listener(state);
  };

  /**
   * SECOND, independent state — see `PrereleaseState`'s doc comment for why
   * this never shares a field, a broadcast channel, or a listener set with
   * `state`/`publish` above.
   */
  let prereleaseChecking = false;
  const prereleaseListeners = new Set<(state: PrereleaseState) => void>();

  const withCanSwitch = (
    next: Omit<PrereleaseState, "canSwitch">,
  ): PrereleaseState => freezePrereleaseState({ ...next, canSwitch: canInstall });

  let prereleaseState = withCanSwitch({
    phase: supported ? "idle" : "unsupported",
    // Never probed on an unsupported build: nothing here can ever switch or
    // revert, so a Caskroom read at construction would just be wasted work.
    activeChannel: supported
      ? (options.detectActiveCaskChannel?.() ?? "stable")
      : "stable",
    ...(supported ? {} : { message: msg("settings.updates.unsupported") }),
  });

  const publishPrerelease = (next: Omit<PrereleaseState, "canSwitch">): void => {
    prereleaseState = withCanSwitch(next);
    for (const listener of prereleaseListeners) listener(prereleaseState);
  };

  /** The bundle is new but this process is not; only a restart fixes that. */
  const publishRestartRequired = (targetVersion: string): void => {
    // Keeps the install button inert: there is nothing left to install.
    installing = true;
    options.onLog?.(
      "info",
      `Homebrew installed ${targetVersion}; restart required to run it`,
    );
    publish({
      phase: "restart-required",
      currentVersion,
      availableVersion: targetVersion,
      message: restartRequiredMessage(targetVersion),
    });
  };

  const publishIncomplete = (): void => {
    installing = false;
    options.pendingInstall?.clear();
    options.onLog?.("warn", "Homebrew update did not change the app version");
    publish({
      phase: "error",
      currentVersion,
      message: INSTALL_INCOMPLETE_MESSAGE,
    });
  };

  /**
   * The helper reopens FixLang when it is done, but a user who reopened it
   * early is already running: that `open -b` only focuses the stale process.
   * Poll the Caskroom so this session still learns the upgrade landed.
   */
  const watchBackgroundUpgrade = (
    targetVersion: string,
    /** Measured from when the helper started, not from this launch. */
    deadline: number,
  ): void => {
    const stop = schedulePoll(() => {
      if (options.upgrader?.isVersionInstalled(targetVersion) === true) {
        stop();
        options.pendingInstall?.clear();
        publishRestartRequired(targetVersion);
        return;
      }
      if (now() < deadline) return;

      stop();
      publishIncomplete();
    }, UPGRADE_POLL_INTERVAL_MS);
  };

  /**
   * Homebrew finishes after this app has quit, so the previous run's marker is
   * the only evidence of what happened.
   *
   * Reopening FixLang while the helper is mid-download must not be mistaken
   * for a failed upgrade: that used to clear the marker, show an error, and
   * leave the button live, so the next click raced the running helper and died
   * on Homebrew's download lock. An unchanged version is only a failure once
   * the grace window has passed with nothing installed.
   */
  const reconcileLastInstall = (): void => {
    const store = options.pendingInstall;
    if (!supported || !store) return;

    const pending = store.read();
    if (pending === null) return;

    const outcome = reconcilePendingInstall(pending, currentVersion, {
      now: now(),
      isTargetInstalled:
        options.upgrader?.isVersionInstalled(pending.toVersion) ?? false,
      runningAppPath: appPath,
    });
    if (outcome === "none") return;

    if (outcome === "in-progress") {
      // Marker stays: the helper still owns this upgrade and will finish it.
      installing = true;
      publish({
        phase: "installing",
        currentVersion,
        availableVersion: pending.toVersion,
        message: backgroundInstallMessage(pending.toVersion),
      });
      watchBackgroundUpgrade(
        pending.toVersion,
        pending.startedAt + UPGRADE_GRACE_MS,
      );
      return;
    }

    store.clear();
    if (outcome === "installed") {
      options.onLog?.("info", `App updated to ${currentVersion} via Homebrew`);
      publish({ phase: "up-to-date", currentVersion });
      return;
    }

    if (outcome === "restart-required") {
      publishRestartRequired(pending.toVersion);
      return;
    }

    if (outcome === "wrong-bundle") {
      // Homebrew did its job; something else reopened. Say which bundle is
      // running — a version number alone reads as a failed update, and the
      // user would have no idea a second copy of the app exists.
      options.onLog?.(
        "warn",
        `Reopened ${currentVersion} from ${appPath ?? "an unknown bundle"} instead of ${pending.toVersion} from ${pending.appPath}`,
      );
      restartTargetPath = pending.appPath;
      installing = true;
      publish({
        phase: "restart-required",
        currentVersion,
        availableVersion: pending.toVersion,
        message: wrongBundleMessage(pending.toVersion, pending.appPath),
      });
      return;
    }

    publishIncomplete();
  };

  reconcileLastInstall();

  /**
   * Runs `brew fetch` while publishing byte progress from the download cache.
   *
   * Progress is read from the cache file rather than parsed out of brew's
   * output: the `.incomplete` file grows in place, its final size is the
   * release asset size GitHub already told us, and no output format can drift
   * underneath us. Resolves false when the download failed.
   */
  const downloadWithProgress = async (
    targetVersion: string,
  ): Promise<boolean> => {
    const publishProgress = (): void => {
      const downloadedBytes =
        options.upgrader?.getDownloadedBytes(targetVersion) ?? null;
      if (downloadedBytes === null) return;
      publish({
        phase: "downloading",
        currentVersion,
        availableVersion: targetVersion,
        downloadedBytes,
        totalBytes: availableDmgSize ?? undefined,
      });
    };

    const stop = schedulePoll(publishProgress, DOWNLOAD_POLL_INTERVAL_MS);
    try {
      await options.upgrader?.downloadUpdate();
      return true;
    } catch (error) {
      options.onLog?.(
        "error",
        `Homebrew could not download ${targetVersion} (${safeErrorName(error)})`,
      );
      publish({
        phase: "error",
        currentVersion,
        availableVersion: targetVersion,
        message: DOWNLOAD_ERROR_MESSAGE,
      });
      return false;
    } finally {
      stop();
    }
  };

  /** True only for a parsed version strictly newer than the installed one. */
  const isNewerThan = (
    candidate: string | null,
    current: StableVersion,
  ): boolean => {
    const parsed = parseStableVersion(candidate);
    return parsed !== null && comparePrereleaseOrder(parsed, current) > 0;
  };

  /** Never rejects: GitHub is optional once Homebrew can answer. */
  const readLatestRelease = async (): Promise<ValidatedRelease | null> => {
    try {
      return validateRelease(await options.releaseSource.getLatestRelease());
    } catch (error) {
      options.onLog?.(
        "warn",
        `Could not read the latest GitHub release (${safeErrorName(error)})`,
      );
      return null;
    }
  };

  /**
   * Never rejects, same discipline as `readLatestRelease`. Only ever called
   * from `checkForPrerelease` — `getLatestPrerelease` hits the release-*list*
   * endpoint, which an ordinary check must not pay for on every press (a
   * shared, unauthenticated GitHub rate limit per address).
   */
  const readLatestPrerelease = async (): Promise<PrereleaseCandidate | null> => {
    try {
      return await options.releaseSource.getLatestPrerelease();
    } catch (error) {
      options.onLog?.(
        "warn",
        `Could not read the latest GitHub pre-release (${safeErrorName(error)})`,
      );
      return null;
    }
  };

  /** Never rejects: a broken probe must not strand the install flow. */
  const probeInstallableVersion = async (
    refreshTap = true,
  ): Promise<string | null> => {
    try {
      return (await options.upgrader?.getInstallableVersion(refreshTap)) ?? null;
    } catch (error) {
      options.onLog?.(
        "warn",
        `Could not read the installable Homebrew version (${safeErrorName(error)})`,
      );
      return null;
    }
  };

  const fail = (error: unknown): void => {
    checking = false;
    options.onLog?.("warn", `App update check failed (${safeErrorName(error)})`);
    publish({
      phase: "error",
      currentVersion,
      message: UPDATE_ERROR_MESSAGE,
    });
  };

  return {
    getState: () => state,

    getReleaseUrl: () => releaseUrl,

    checkForUpdates: async (): Promise<void> => {
      // An upgrade already in flight owns the state; a check would overwrite
      // it with "available" and re-arm a button that must stay inert.
      if (!supported || checking || installing) return;

      checking = true;
      publish({ phase: "checking", currentVersion });
      try {
        const current = parseCurrentVersion(currentVersion);
        if (!current) throw new Error("Invalid installed version");

        // GitHub is asked in parallel because it is the only source of release
        // notes and of the DMG size the download bar needs. It does not get to
        // decide what is offered.
        const [release, cached] = await Promise.all([
          readLatestRelease(),
          // Cheap read of the local tap clone: `brew update` is a git fetch
          // across every tap, far too heavy for a routine check.
          canInstall ? probeInstallableVersion(false) : Promise.resolve(null),
        ]);

        const newerOnGitHub =
          release !== null && comparePrereleaseOrder(release.version, current) > 0;
        // The clone can lag a release that already exists. Pay for one refresh
        // only when GitHub says there is something to look for.
        const installable = parseStableVersion(
          canInstall && newerOnGitHub && !isNewerThan(cached, current)
            ? await probeInstallableVersion(true)
            : cached,
        );

        // For a cask install Homebrew has the only answer that matters: it is
        // what the button runs. GitHub is the fallback for manual installs,
        // and for a cask whose brew probe could not answer at all.
        const target =
          (canInstall ? installable : null) ?? release?.version ?? null;
        if (target === null) {
          throw new Error("No usable update source");
        }

        if (comparePrereleaseOrder(target, current) > 0) {
          releaseUrl = `${RELEASES_URL}/tag/v${target.raw}`;
          // Only attach notes and a download size when GitHub is describing
          // the very version being offered; otherwise they belong to a
          // different release and would misreport both.
          const describesTarget =
            release !== null && comparePrereleaseOrder(release.version, target) === 0;
          availableDmgSize = describesTarget ? release.dmgSize : null;
          publish({
            phase: "available",
            currentVersion,
            availableVersion: target.raw,
            releaseNotes: describesTarget ? release.releaseNotes : undefined,
          });
          return;
        }

        const pendingRelease = newerOnGitHub && release !== null ? release : null;
        // Nothing installable, but a release does exist — say so rather than
        // claiming the app is current, and never offer an install button that
        // cannot work yet. The release page still can be opened, so point at
        // that exact tag rather than at the generic /releases/latest fallback.
        releaseUrl =
          pendingRelease === null
            ? null
            : `${RELEASES_URL}/tag/v${pendingRelease.version.raw}`;
        availableDmgSize = null;
        publish({
          phase: "up-to-date",
          currentVersion,
          // Notes are safe to show here: unlike the size, they describe the
          // release the message names, not some other version.
          ...(pendingRelease === null
            ? {}
            : {
                message: tapPendingMessage(pendingRelease.version.raw),
                releaseNotes: pendingRelease.releaseNotes,
              }),
        });
      } catch (error) {
        releaseUrl = null;
        availableDmgSize = null;
        fail(error);
      } finally {
        checking = false;
      }
    },

    /**
     * Starts the detached Homebrew helper and quits so it can replace this
     * bundle. Only a validated `available` state may trigger it, and only for
     * a cask install — never for a manually placed DMG copy.
     *
     * The tap is checked first: `brew upgrade` exits 0 when it has nothing
     * newer, so without this gate a lagging tap would quit and reopen the app
     * unchanged, which reads as the button doing nothing at all.
     */
    installUpdate: async (): Promise<InstallUpdateResult> => {
      if (!canInstall || !options.upgrader) {
        return { success: false, error: INSTALL_ERROR_MESSAGE };
      }
      if (installing) return { success: true };
      if (state.phase !== "available" || state.availableVersion === undefined) {
        return { success: false, error: INSTALL_ERROR_MESSAGE };
      }

      const targetVersion = state.availableVersion;
      // Claimed before the first await: the tap probe is slow enough that a
      // second click would otherwise start a second upgrade.
      installing = true;
      publish({
        phase: "downloading",
        currentVersion,
        availableVersion: targetVersion,
        downloadedBytes: 0,
        totalBytes: availableDmgSize ?? undefined,
      });

      const offered = parseStableVersion(await probeInstallableVersion());
      const target = parseStableVersion(targetVersion);
      // A null probe means brew could not be asked, not that it is behind.
      if (offered && target && comparePrereleaseOrder(offered, target) < 0) {
        installing = false;
        options.onLog?.(
          "warn",
          `Homebrew still offers ${offered.raw}; ${targetVersion} is not installable yet`,
        );
        const message = tapBehindMessage(targetVersion, offered.raw);
        publish({
          phase: "error",
          currentVersion,
          availableVersion: targetVersion,
          message,
        });
        return { success: false, error: message };
      }

      // Download first, with the app still running. `brew fetch` only fills
      // the download cache, so nothing is replaced yet and the user can watch
      // progress instead of staring at an app that vanished for a minute.
      const downloaded = await downloadWithProgress(targetVersion);
      if (!downloaded) {
        installing = false;
        return { success: false, error: DOWNLOAD_ERROR_MESSAGE };
      }

      // Everything left is a local file move, so the app is only away for a
      // few seconds.
      publish({
        phase: "installing",
        currentVersion,
        availableVersion: targetVersion,
      });

      try {
        options.upgrader.startUpgrade(appPath);
      } catch (error) {
        installing = false;
        options.onLog?.(
          "error",
          `Homebrew update could not start (${safeErrorName(error)})`,
        );
        publish({
          phase: "error",
          currentVersion,
          availableVersion: targetVersion,
          message: INSTALL_ERROR_MESSAGE,
        });
        return { success: false, error: INSTALL_ERROR_MESSAGE };
      }

      try {
        options.pendingInstall?.write({
          fromVersion: currentVersion,
          toVersion: targetVersion,
          // Stamped so the next launch can tell "still working" from "failed".
          startedAt: now(),
          // Recorded so the next launch can tell "the upgrade landed" from
          // "some other copy of FixLang opened instead".
          appPath,
        });
      } catch (error) {
        // The upgrade still runs; only the outcome report is lost.
        options.onLog?.(
          "warn",
          `Could not record the pending update (${safeErrorName(error)})`,
        );
      }

      options.onLog?.("info", `Homebrew update to ${targetVersion} started`);
      options.quitApp?.();
      return { success: true };
    },

    /**
     * Re-executes the bundle Homebrew already replaced. Allowed only from
     * `restart-required`, so a renderer message can never restart the app at
     * an arbitrary moment. Re-exec is not `open -b`: LaunchServices would find
     * this process and merely focus it, which is exactly the trap that leaves
     * the user on the old binary.
     *
     * When the running process is a different copy of FixLang, re-exec would
     * relaunch that same wrong copy forever, so the upgraded bundle's path is
     * handed over instead.
     */
    restartForUpdate: (): UpdateActionResult => {
      if (state.phase !== "restart-required" || !options.relaunchApp) {
        return { success: false, error: RESTART_ERROR_MESSAGE };
      }
      try {
        options.relaunchApp(restartTargetPath);
      } catch (error) {
        options.onLog?.(
          "error",
          `Could not restart for the update (${safeErrorName(error)})`,
        );
        return { success: false, error: RESTART_ERROR_MESSAGE };
      }
      options.onLog?.("info", "Restarting to run the installed update");
      return { success: true };
    },

    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    getPrereleaseState: () => prereleaseState,

    /**
     * Discovers what beta is offered and which cask token(s) are actually
     * installed. Never touched by `checkForUpdates` — this is the only path
     * that calls `releaseSource.getLatestPrerelease`, so an ordinary check
     * keeps costing one GitHub request, not two, against a rate limit shared
     * per address.
     */
    checkForPrerelease: async (): Promise<PrereleaseState> => {
      if (!supported || prereleaseChecking) return prereleaseState;

      prereleaseChecking = true;
      const activeChannel = options.detectActiveCaskChannel?.() ?? "stable";

      // Both tokens staged at once means a previous channel switch died
      // mid-flight — installed the target, never got to uninstall the
      // source. Guessing which one is "really" active risks uninstalling
      // the app bundle that is still running, so this refuses instead of
      // picking a side, and never starts brew to find out more.
      if (activeChannel === "both") {
        prereleaseChecking = false;
        publishPrerelease({
          phase: "error",
          activeChannel,
          message: bothCasksInstalledMessage(),
        });
        return prereleaseState;
      }

      publishPrerelease({ phase: "checking", activeChannel });

      try {
        const current = parseCurrentVersion(currentVersion);
        if (!current) throw new Error("Invalid installed version");

        const candidate = await readLatestPrerelease();
        if (
          candidate !== null &&
          comparePrereleaseOrder(candidate.version, current) > 0
        ) {
          publishPrerelease({
            phase: "available",
            activeChannel,
            offeredVersion: candidate.version.raw,
            releaseNotes: candidate.releaseNotes,
          });
          return prereleaseState;
        }

        publishPrerelease({ phase: "up-to-date", activeChannel });
        return prereleaseState;
      } catch (error) {
        options.onLog?.(
          "warn",
          `Pre-release check failed (${safeErrorName(error)})`,
        );
        publishPrerelease({
          phase: "error",
          activeChannel,
          message: UPDATE_ERROR_MESSAGE,
        });
        return prereleaseState;
      } finally {
        prereleaseChecking = false;
      }
    },

    subscribeToPrereleaseState: (listener) => {
      prereleaseListeners.add(listener);
      return () => prereleaseListeners.delete(listener);
    },
  };
};
