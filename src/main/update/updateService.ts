import { msg, type Message } from "~/features/i18n/shared/message";
import {
  BETA_CASK_TOKEN,
  STABLE_CASK_TOKEN,
  type ActiveCaskChannel,
  type CaskToken,
  type HomebrewUpgrader,
} from "./homebrew";
import {
  reconcilePendingInstall,
  UPGRADE_GRACE_MS,
  type PendingInstall,
  type PendingInstallStore,
} from "./pendingInstall";
import {
  comparePrereleaseOrder,
  parsePrereleaseVersion,
  type OrderableVersion,
  type PrereleaseVersion,
} from "./prereleaseVersion";
import { normalizeReleaseNotes } from "./releaseAsset";
import type { GitHubReleaseSource } from "./githubReleaseSource";
import type {
  PrereleaseChannel,
  PrereleaseState,
} from "~/features/update/shared/prerelease";
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
  /** Second, independently published state — see `PrereleaseState`. */
  getPrereleaseState: () => PrereleaseState;
  /** The only caller of `releaseSource.getLatestPrerelease`. */
  checkForPrerelease: () => Promise<PrereleaseState>;
  /** stable -> beta, gated by `confirmPrereleaseSwitch`. */
  switchToPrerelease: () => Promise<UpdateActionResult>;
  /** beta -> stable, with no confirm — reverting is the safe direction. */
  revertToStable: () => Promise<UpdateActionResult>;
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
   * next launch can tell it from another copy sharing the same bundle id.
   */
  appPath?: string | null;
  /** Called after the detached helper starts, so it can replace the bundle. */
  quitApp?: () => void;
  /** Restarts into the updated app: a given path is opened, else re-exec. */
  relaunchApp?: (targetPath: string | null) => void;
  onLog?: (level: "info" | "warn" | "error", message: string) => void;
  /** Injectable clock so marker ages are testable. */
  now?: () => number;
  /** Injectable repeating timer; returns its own cancel function. */
  schedulePoll?: (run: () => void, intervalMs: number) => () => void;
  /**
   * Which cask token(s) are staged in the Caskroom now. `null` means "could
   * not be determined": displayed as `"stable"`, never allowed into
   * `canSwitch` — see `detectChannel`.
   */
  detectActiveCaskChannel?: () => ActiveCaskChannel | null;
  /**
   * Confirms a channel switch before any side effect runs. Absent, or a
   * resolved `false`, refuses the switch outright. Never used by a revert.
   */
  confirmPrereleaseSwitch?: (targetVersion: string) => Promise<boolean>;
  /**
   * Starts the detached channel-switch helper. Not a `HomebrewUpgrader`
   * method: that type is bound to one token for life, while a switch needs a
   * (current, target) pair decided per call. Throws when it cannot start.
   */
  startChannelSwitch?: (
    currentToken: CaskToken,
    targetToken: CaskToken,
    appPath: string | null,
  ) => void;
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

// Locale-free descriptors: the renderer resolves them via `tm()`, so an open
// Settings panel re-renders on a locale switch instead of freezing.
const UPDATE_ERROR_MESSAGE: Message = msg("settings.updates.checkErrorMessage");
const INSTALL_ERROR_MESSAGE: Message = msg("settings.updates.installErrorMessage");
const INSTALL_INCOMPLETE_MESSAGE: Message = msg(
  "settings.updates.installIncompleteMessage",
);
const RESTART_ERROR_MESSAGE: Message = msg("settings.updates.restartErrorMessage");
const DOWNLOAD_ERROR_MESSAGE: Message = msg("settings.updates.downloadErrorMessage");

const SWITCH_ERROR_MESSAGE: Message = msg("settings.updates.prerelease.switchErrorMessage");
const SWITCH_CANCELLED_MESSAGE: Message = msg(
  "settings.updates.prerelease.switchCancelledMessage",
);
const REVERT_ERROR_MESSAGE: Message = msg("settings.updates.prerelease.revertErrorMessage");
const PRERELEASE_DOWNLOAD_ERROR_MESSAGE: Message = msg(
  "settings.updates.prerelease.downloadErrorMessage",
);

/**
 * A channel operation that ended back on the cask it started from, at that
 * channel's CURRENT version. `PrereleaseState` carries no outcome
 * discriminator, so `message` is the only way this outcome reaches the user.
 */
const switchRolledBackMessage = (current: string): Message =>
  msg("settings.updates.prerelease.switchRolledBackMessage", {
    currentVersion: current,
  });
const revertRolledBackMessage = (current: string): Message =>
  msg("settings.updates.prerelease.revertRolledBackMessage", {
    currentVersion: current,
  });

/** How often a background upgrade is re-checked while the app is reopened. */
const UPGRADE_POLL_INTERVAL_MS = 15_000;
/** Fast enough that a progress bar looks live without churning the renderer. */
const DOWNLOAD_POLL_INTERVAL_MS = 500;

const backgroundInstallMessage = (target: string): Message =>
  msg("settings.updates.backgroundInstallMessage", { targetVersion: target });

/** Bundle on disk is new; only this process is stale — see `restartForUpdate`. */
const restartRequiredMessage = (target: string): Message =>
  msg("settings.updates.restartRequiredMessage", { targetVersion: target });

/**
 * `open -b` resolves by bundle id, so a forgotten `pack:mac` build can win.
 * Names both paths — nothing else on screen reveals a second copy exists.
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
 * The tap lags GitHub, so the app can advertise a version the cask cannot
 * install yet. Saying so beats quitting for an upgrade that would no-op.
 */
const tapBehindMessage = (target: string, offered: string): Message =>
  msg("settings.updates.tapBehindMessage", {
    targetVersion: target,
    offeredVersion: offered,
  });

const tapPendingMessage = (published: string): Message =>
  msg("settings.updates.tapPendingMessage", { publishedVersion: published });

/**
 * Both tokens staged means a previous switch died between installing the
 * target and uninstalling the source. Guessing which is active risks
 * uninstalling the running bundle, so this names the fix instead.
 */
const BOTH_CASKS_FIX_COMMAND = `brew uninstall --cask ${BETA_CASK_TOKEN}`;
const bothCasksInstalledMessage = (): Message =>
  msg("settings.updates.prerelease.bothCasksMessage", {
    stableToken: STABLE_CASK_TOKEN,
    betaToken: BETA_CASK_TOKEN,
    fixCommand: BOTH_CASKS_FIX_COMMAND,
  });

/**
 * Which published state a pending marker's outcome belongs to, and for a
 * channel operation which direction the user clicked. `caskToken` cannot
 * answer it — a revert targets the stable token too — so `fromCaskToken` wins
 * over any inference, and `fromVersion`'s shape is a lossy fallback for older
 * markers: a rollback can stage a plain `X.Y.Z` build on the beta cask.
 */
type ChannelOperation = "switch" | "revert";

const pendingChannelOperation = (
  pending: PendingInstall,
): ChannelOperation | null => {
  if (pending.caskToken === BETA_CASK_TOKEN) return "switch";
  if (pending.fromCaskToken !== undefined) {
    return pending.fromCaskToken === BETA_CASK_TOKEN ? "revert" : null;
  }
  return parsePrereleaseVersion(pending.fromVersion) === null ? null : "revert";
};

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
 * The installed version is `X.Y.Z`, or `X.Y.Z-beta.N` on the pre-release
 * channel. Both satisfy `OrderableVersion`, so the two can be ranked.
 */
const parseCurrentVersion = (
  value: string,
): StableVersion | PrereleaseVersion | null =>
  parseStableVersion(value) ?? parsePrereleaseVersion(value);

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
 * untrusted: the release URL is derived locally, never read off the response.
 */
export const createUpdateService = (
  options: UpdateServiceOptions,
): UpdateService => {
  const currentVersion = options.getCurrentVersion();
  const supported =
    options.isPackaged && options.platform === "darwin" && options.arch === "arm64";
  /**
   * The ordinary flow upgrades the STABLE cask in place, so it requires exactly
   * that channel: a beta install has no stable Caskroom entry and `startUpgrade`
   * would throw only after the press, and with `"both"` staged ownership of
   * `/Applications/FixLang.app` is ambiguous. Beta's route out is `revertToStable`.
   */
  const canInstall =
    supported &&
    (options.upgrader?.canInstall ?? false) &&
    (options.detectActiveCaskChannel?.() ?? null) === "stable";
  const listeners = new Set<(state: UpdateState) => void>();
  const now = options.now ?? Date.now;
  const schedulePoll = options.schedulePoll ?? defaultSchedulePoll;
  let checking = false;
  let installing = false;
  let releaseUrl: string | null = null;
  /** Denominator for download progress; only known after a successful check. */
  let availableDmgSize: number | null = null;
  /** Same role as `availableDmgSize`, for the pre-release channel's offer. */
  let availablePrereleaseDmgSize: number | null = null;
  const appPath = options.appPath ?? null;
  /**
   * Bundle a restart must open instead of re-executing this one — set only
   * when this process is a different copy from the one that was upgraded.
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

  /** Second, independent state — shares nothing with `state`/`publish`. */
  let prereleaseChecking = false;
  const prereleaseListeners = new Set<(state: PrereleaseState) => void>();

  /**
   * `canSwitch` needs exactly one real token: `null` (undetectable, e.g. a
   * manual DMG install) and `"both"` (ambiguous) refuse, `"stable"` and
   * `"beta"` both allow. Never `canInstall`, which is scoped to the stable
   * cask a beta install does not have.
   */
  const detectChannel = (): Pick<PrereleaseState, "activeChannel" | "canSwitch"> => {
    const raw = options.detectActiveCaskChannel?.() ?? null;
    return {
      // Undetected displays as "stable"; never reaches `canSwitch` below.
      activeChannel: raw ?? "stable",
      canSwitch: raw !== null && raw !== "both",
    };
  };

  let prereleaseState: PrereleaseState = supported
    ? freezePrereleaseState({ phase: "idle", ...detectChannel() })
    : freezePrereleaseState({
        phase: "unsupported",
        activeChannel: "stable",
        canSwitch: false,
        message: msg("settings.updates.unsupported"),
      });

  const publishPrerelease = (next: PrereleaseState): void => {
    prereleaseState = freezePrereleaseState(next);
    for (const listener of prereleaseListeners) listener(prereleaseState);
  };

  /**
   * Whether an install or a channel operation claimed the app while a check was
   * awaiting GitHub. Read again at PUBLISH time, not only at entry, and the
   * operation wins: making it wait would kill a Revert press for the length of
   * a GitHub scan.
   */
  const inFlightOperationOwnsState = (): boolean => {
    if (!installing) return false;
    options.onLog?.(
      "info",
      "Discarding a stale update check: an install or channel operation claimed the app while it was in flight",
    );
    return true;
  };

  /**
   * Published into BOTH states even for a channel operation: `restartForUpdate`
   * is gated on `state.phase`, so a pre-release-only publish would leave the
   * Restart button refusing an install that already landed.
   */
  const publishRestartRequired = (
    targetVersion: string,
    channelOperation: ChannelOperation | null = null,
  ): void => {
    // Keeps the install button inert: there is nothing left to install.
    installing = true;
    options.onLog?.(
      "info",
      `Homebrew installed ${targetVersion}; restart required to run it`,
    );
    if (channelOperation !== null) {
      publishPrerelease({
        phase: "restart-required",
        ...detectChannel(),
        offeredVersion: targetVersion,
        message: restartRequiredMessage(targetVersion),
      });
    }
    publish({
      phase: "restart-required",
      currentVersion,
      availableVersion: targetVersion,
      message: restartRequiredMessage(targetVersion),
    });
  };

  /**
   * A channel operation reports its failure ONLY into the pre-release state:
   * the ordinary section never started that work, and its wording names an
   * update rather than a switch or a revert.
   */
  const publishIncomplete = (
    channelOperation: ChannelOperation | null = null,
    /** Overridden by a rollback: the version DID change, onto the source. */
    logMessage = "Homebrew update did not change the app version",
    /** Overridden too, so a rollback is visible in the UI, not just the log. */
    channelMessage?: Message,
  ): void => {
    installing = false;
    options.pendingInstall?.clear();
    options.onLog?.("warn", logMessage);
    if (channelOperation !== null) {
      publishPrerelease({
        phase: "error",
        ...detectChannel(),
        message:
          channelMessage ??
          (channelOperation === "switch"
            ? SWITCH_ERROR_MESSAGE
            : REVERT_ERROR_MESSAGE),
      });
      return;
    }
    publish({
      phase: "error",
      currentVersion,
      message: INSTALL_INCOMPLETE_MESSAGE,
    });
  };

  /** The helper only focuses this process, so poll to see the upgrade land. */
  const watchBackgroundUpgrade = (
    targetVersion: string,
    /** Measured from when the helper started, not from this launch. */
    deadline: number,
    /** The marker's own token, never the upgrader's bound (stable) channel. */
    caskToken: CaskToken,
    channelOperation: ChannelOperation | null,
  ): void => {
    const stop = schedulePoll(() => {
      if (options.upgrader?.isVersionInstalled(targetVersion, caskToken) === true) {
        stop();
        options.pendingInstall?.clear();
        publishRestartRequired(targetVersion, channelOperation);
        return;
      }
      if (now() < deadline) return;

      stop();
      publishIncomplete(channelOperation);
    }, UPGRADE_POLL_INTERVAL_MS);
  };

  /**
   * Homebrew finishes after this app has quit, so the previous run's marker is
   * the only evidence. An unchanged version counts as a failure only after the
   * grace window — otherwise a live button races the helper into brew's lock.
   */
  const reconcileLastInstall = (): void => {
    const store = options.pendingInstall;
    if (!supported || !store) return;

    const pending = store.read();
    if (pending === null) return;

    const channelOperation = pendingChannelOperation(pending);

    const outcome = reconcilePendingInstall(pending, currentVersion, {
      now: now(),
      // The resolver, never a pre-resolved boolean: reconcile has to aim the
      // probe at `pending.caskToken`, and at the source cask for a rollback.
      isVersionInstalled: (version, caskToken) =>
        options.upgrader?.isVersionInstalled(version, caskToken) ?? false,
      runningAppPath: appPath,
    });
    if (outcome === "none") return;

    if (outcome === "in-progress") {
      // Marker stays: the helper still owns this upgrade and will finish it.
      installing = true;
      if (channelOperation !== null) {
        publishPrerelease({
          phase: "installing",
          ...detectChannel(),
          offeredVersion: pending.toVersion,
          message: backgroundInstallMessage(pending.toVersion),
        });
      } else {
        publish({
          phase: "installing",
          currentVersion,
          availableVersion: pending.toVersion,
          message: backgroundInstallMessage(pending.toVersion),
        });
      }
      watchBackgroundUpgrade(
        pending.toVersion,
        pending.startedAt + UPGRADE_GRACE_MS,
        pending.caskToken,
        channelOperation,
      );
      return;
    }

    store.clear();
    if (outcome === "installed") {
      options.onLog?.("info", `App updated to ${currentVersion} via Homebrew`);
      if (channelOperation !== null) {
        publishPrerelease({ phase: "up-to-date", ...detectChannel() });
      }
      publish({ phase: "up-to-date", currentVersion });
      return;
    }

    if (outcome === "restart-required") {
      publishRestartRequired(pending.toVersion, channelOperation);
      return;
    }

    if (outcome === "wrong-bundle") {
      options.onLog?.(
        "warn",
        `Reopened ${currentVersion} from ${appPath ?? "an unknown bundle"} instead of ${pending.toVersion} from ${pending.appPath}`,
      );
      restartTargetPath = pending.appPath;
      installing = true;
      if (channelOperation !== null) {
        // Path-free: `PrereleaseState`'s contract forbids file paths, so the
        // stray-bundle detail rides the stable message published below.
        publishPrerelease({
          phase: "restart-required",
          ...detectChannel(),
          offeredVersion: pending.toVersion,
          message: restartRequiredMessage(pending.toVersion),
        });
      }
      publish({
        phase: "restart-required",
        currentVersion,
        availableVersion: pending.toVersion,
        message: wrongBundleMessage(pending.toVersion, pending.appPath),
      });
      return;
    }

    if (outcome === "rolled-back") {
      // The helper put the source cask back, normally at that channel's
      // current version — so the version moved while the operation failed.
      publishIncomplete(
        channelOperation,
        `Channel ${channelOperation ?? "operation"} rolled back: now running ${currentVersion} on the cask it started from`,
        channelOperation === "switch"
          ? switchRolledBackMessage(currentVersion)
          : revertRolledBackMessage(currentVersion),
      );
      return;
    }

    publishIncomplete(channelOperation);
  };

  reconcileLastInstall();

  /**
   * Runs `brew fetch` while publishing byte progress read from the growing
   * cache file — never parsed out of brew's output, whose format can drift.
   * Names the STABLE token explicitly; see `probeInstallableVersion`.
   */
  const downloadWithProgress = async (
    targetVersion: string,
  ): Promise<boolean> => {
    const publishProgress = (): void => {
      const downloadedBytes =
        options.upgrader?.getDownloadedBytes(targetVersion, STABLE_CASK_TOKEN) ??
        null;
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
      await options.upgrader?.downloadUpdate(STABLE_CASK_TOKEN);
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

  /**
   * `current` must stay `OrderableVersion`: narrowing it to `StableVersion`
   * still compiles but drops `beta`, so `1.2.3-beta.1` would rank as older.
   */
  const isNewerThan = (
    candidate: string | null,
    current: OrderableVersion,
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
   * Never rejects: a broken probe must not strand the install flow. DOCTRINE
   * FOR THIS FILE: every Homebrew call names the cask it means and none
   * inherits `upgrader`'s binding, which does not expose its own token — so a
   * future rebind cannot silently steer this flow onto the wrong cask.
   */
  const probeInstallableVersion = async (
    refreshTap = true,
    caskToken: CaskToken = STABLE_CASK_TOKEN,
  ): Promise<string | null> => {
    try {
      return (
        (await options.upgrader?.getInstallableVersion(refreshTap, caskToken)) ?? null
      );
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

  type ChannelSwitchParams = Readonly<{
    currentToken: CaskToken;
    targetToken: CaskToken;
    targetVersion: string;
  }>;

  /**
   * Shared tail of `switchToPrerelease`/`revertToStable`. ORDER is the whole
   * correctness story: download with the app still running, THEN hand off to
   * the helper and quit — the reverse leaves the user staring at a vanished
   * app. `activeChannel`/`canSwitch` are carried forward, not re-probed: the
   * switch in flight is what changes the Caskroom this would read.
   */
  const runChannelSwitch = async (
    { currentToken, targetToken, targetVersion }: ChannelSwitchParams,
    helperErrorMessage: Message,
    /** Held from the moment the helper is spawned — see `withInstallingClaim`. */
    markHandedOff: () => void,
  ): Promise<UpdateActionResult> => {
    const { activeChannel, canSwitch } = prereleaseState;
    const totalBytes =
      targetToken === BETA_CASK_TOKEN ? (availablePrereleaseDmgSize ?? undefined) : undefined;

    installing = true;
    publishPrerelease({
      phase: "downloading",
      activeChannel,
      canSwitch,
      offeredVersion: targetVersion,
      downloadedBytes: 0,
      totalBytes,
    });

    const publishProgress = (): void => {
      const downloadedBytes =
        options.upgrader?.getDownloadedBytes(targetVersion, targetToken) ?? null;
      if (downloadedBytes === null) return;
      publishPrerelease({
        phase: "downloading",
        activeChannel,
        canSwitch,
        offeredVersion: targetVersion,
        downloadedBytes,
        totalBytes,
      });
    };

    const stopPoll = schedulePoll(publishProgress, DOWNLOAD_POLL_INTERVAL_MS);
    let downloaded = false;
    try {
      await options.upgrader?.downloadUpdate(targetToken);
      downloaded = true;
    } catch (error) {
      options.onLog?.(
        "warn",
        `Could not download ${targetToken} (${safeErrorName(error)})`,
      );
    } finally {
      stopPoll();
    }

    if (!downloaded) {
      installing = false;
      publishPrerelease({
        phase: "error",
        activeChannel,
        canSwitch,
        message: PRERELEASE_DOWNLOAD_ERROR_MESSAGE,
      });
      return { success: false, error: PRERELEASE_DOWNLOAD_ERROR_MESSAGE };
    }

    publishPrerelease({
      phase: "installing",
      activeChannel,
      canSwitch,
      offeredVersion: targetVersion,
    });

    try {
      options.startChannelSwitch?.(currentToken, targetToken, appPath);
    } catch (error) {
      installing = false;
      options.onLog?.(
        "error",
        `Channel switch helper could not start (${safeErrorName(error)})`,
      );
      publishPrerelease({
        phase: "error",
        activeChannel,
        canSwitch,
        message: helperErrorMessage,
      });
      return { success: false, error: helperErrorMessage };
    }

    // The helper owns both casks now; the claim is never released from here.
    markHandedOff();

    try {
      options.pendingInstall?.write({
        fromVersion: currentVersion,
        toVersion: targetVersion,
        startedAt: now(),
        appPath: appPath ?? "",
        // The TARGET token, so reconcile resolves a revert (a version LOWER
        // than the one running) against the right Caskroom.
        caskToken: targetToken,
        // Recorded rather than inferred from `fromVersion`'s shape, which
        // cannot tell a rolled-back operation from a completed update.
        fromCaskToken: currentToken,
      });
    } catch (error) {
      // The switch still runs; only the outcome report is lost.
      options.onLog?.(
        "warn",
        `Could not record the pending channel switch (${safeErrorName(error)})`,
      );
    }

    // Tokens and version only: this log line must not leak a path.
    options.onLog?.(
      "info",
      `Channel switch from ${currentToken} to ${targetToken} started, targeting ${targetVersion}`,
    );
    options.quitApp?.();
    return { success: true };
  };

  /**
   * Re-reads the Caskroom before committing to a SOURCE token: this tray app
   * stays open for days, and `prereleaseState.activeChannel` is a cached value
   * a terminal `brew install` can invalidate. A stale token makes the helper
   * quit the app and then exit on `|| exit 1` with nothing on screen to say why.
   */
  const activeChannelStillIs = (
    expected: PrereleaseChannel,
    errorMessage: Message,
  ): boolean => {
    const probed = detectChannel();
    if (probed.canSwitch === true && probed.activeChannel === expected) {
      return true;
    }
    options.onLog?.(
      "warn",
      `Refusing a channel switch: expected the ${expected} cask, the Caskroom now reports ${
        probed.canSwitch === true ? probed.activeChannel : "no single staged cask"
      }`,
    );
    publishPrerelease({ phase: "error", ...probed, message: errorMessage });
    return false;
  };

  /**
   * Claims the shared in-flight flag and releases it unless the operation
   * handed off. The HAND-OFF, not the returned result, is the boundary: a log
   * line and `quitApp` follow the spawn and either can throw, and releasing
   * there would let the next press spawn a SECOND helper against casks the
   * first already owns. A resolved `success` also counts, so a body that
   * forgets `markHandedOff` fails in the safe direction. The explicit releases
   * inside the bodies stay: they run BEFORE their failure state is published.
   */
  const withInstallingClaim = async (
    operation: (markHandedOff: () => void) => Promise<UpdateActionResult>,
  ): Promise<UpdateActionResult> => {
    installing = true;
    let handedOff = false;
    const markHandedOff = (): void => {
      handedOff = true;
    };
    try {
      const result = await operation(markHandedOff);
      if (result.success) markHandedOff();
      return result;
    } finally {
      if (!handedOff) installing = false;
    }
  };

  /** Everything a switch does once `installing` is claimed. */
  const runPrereleaseSwitch = async (
    targetVersion: string,
    markHandedOff: () => void,
  ): Promise<UpdateActionResult> => {
    const confirmed = (await options.confirmPrereleaseSwitch?.(targetVersion)) ?? false;
    if (!confirmed) {
      installing = false;
      return { success: false, error: SWITCH_CANCELLED_MESSAGE };
    }

    // Tap-lag gate for the beta cask: a beta reaches GitHub hours before the
    // tap syncs `fixlang@beta`. A null or unparseable probe means brew could
    // not be asked, not that it is behind — proceed.
    const offeredRaw = await probeInstallableVersion(true, BETA_CASK_TOKEN);
    const offered = offeredRaw === null ? null : parseCurrentVersion(offeredRaw);
    const target = parseCurrentVersion(targetVersion);
    if (offered && target && comparePrereleaseOrder(offered, target) < 0) {
      installing = false;
      options.onLog?.(
        "warn",
        `Homebrew still offers ${offered.raw} on the pre-release channel; ${targetVersion} is not installable yet`,
      );
      const message = tapBehindMessage(targetVersion, offered.raw);
      publishPrerelease({
        phase: "error",
        ...detectChannel(),
        offeredVersion: targetVersion,
        message,
      });
      return { success: false, error: message };
    }

    if (!activeChannelStillIs("stable", SWITCH_ERROR_MESSAGE)) {
      installing = false;
      return { success: false, error: SWITCH_ERROR_MESSAGE };
    }

    return runChannelSwitch(
      { currentToken: STABLE_CASK_TOKEN, targetToken: BETA_CASK_TOKEN, targetVersion },
      SWITCH_ERROR_MESSAGE,
      markHandedOff,
    );
  };

  /**
   * Confirms the offered version before any side effect, so a decline is a
   * complete no-op. `installing` is claimed before the confirm await so a
   * second click cannot start a second switch while the dialog is up.
   */
  const switchToPrerelease = async (): Promise<UpdateActionResult> => {
    if (!prereleaseState.canSwitch || !options.upgrader) {
      return { success: false, error: SWITCH_ERROR_MESSAGE };
    }
    if (installing) {
      return { success: false, error: SWITCH_ERROR_MESSAGE };
    }
    if (
      prereleaseState.phase !== "available" ||
      prereleaseState.offeredVersion === undefined ||
      prereleaseState.activeChannel !== "stable"
    ) {
      return { success: false, error: SWITCH_ERROR_MESSAGE };
    }

    const targetVersion = prereleaseState.offeredVersion;
    return withInstallingClaim((markHandedOff) =>
      runPrereleaseSwitch(targetVersion, markHandedOff),
    );
  };

  const runRevertToStable = async (
    markHandedOff: () => void,
  ): Promise<UpdateActionResult> => {
    const targetVersion = await probeInstallableVersion(true, STABLE_CASK_TOKEN);
    if (targetVersion === null) {
      installing = false;
      // `getInstallableVersion` resolves null rather than throwing when brew
      // cannot be asked, so `probeInstallableVersion`'s catch never runs here.
      options.onLog?.(
        "warn",
        "Cannot revert: Homebrew could not say which stable version it would install",
      );
      publishPrerelease({
        phase: "error",
        ...detectChannel(),
        message: REVERT_ERROR_MESSAGE,
      });
      return { success: false, error: REVERT_ERROR_MESSAGE };
    }

    if (!activeChannelStillIs("beta", REVERT_ERROR_MESSAGE)) {
      installing = false;
      return { success: false, error: REVERT_ERROR_MESSAGE };
    }

    return runChannelSwitch(
      { currentToken: BETA_CASK_TOKEN, targetToken: STABLE_CASK_TOKEN, targetVersion },
      REVERT_ERROR_MESSAGE,
      markHandedOff,
    );
  };

  /**
   * No confirm, ever: reverting is the safe direction. The claim precedes the
   * tap probe, which is slow enough for a second click to land inside it.
   */
  const revertToStable = async (): Promise<UpdateActionResult> => {
    if (!prereleaseState.canSwitch || !options.upgrader) {
      return { success: false, error: REVERT_ERROR_MESSAGE };
    }
    if (installing) {
      return { success: false, error: REVERT_ERROR_MESSAGE };
    }
    if (prereleaseState.activeChannel !== "beta") {
      return { success: false, error: REVERT_ERROR_MESSAGE };
    }

    return withInstallingClaim(runRevertToStable);
  };

  const runInstallUpdate = async (
    /** Passed in: the presence guard lives in the caller, so no assertion. */
    upgrader: HomebrewUpgrader,
    targetVersion: string,
    markHandedOff: () => void,
  ): Promise<InstallUpdateResult> => {
    publish({
      phase: "downloading",
      currentVersion,
      availableVersion: targetVersion,
      downloadedBytes: 0,
      totalBytes: availableDmgSize ?? undefined,
    });

    const offeredRaw = await probeInstallableVersion();
    const offered =
      offeredRaw === null ? null : parseCurrentVersion(offeredRaw);
    const target = parseCurrentVersion(targetVersion);
    // The two nulls mean opposite things: a null `offered` is brew declining
    // to answer ("unknown", so proceed), while a null `target` is our own
    // published state being unparseable and must never pass this gate.
    if (target === null) {
      installing = false;
      options.onLog?.("error", "Refusing to install an unparseable version");
      publish({
        phase: "error",
        currentVersion,
        message: INSTALL_ERROR_MESSAGE,
      });
      return { success: false, error: INSTALL_ERROR_MESSAGE };
    }
    if (offered && comparePrereleaseOrder(offered, target) < 0) {
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

    // `brew fetch` only fills the download cache, so nothing is replaced yet
    // and the app can stay up showing progress.
    const downloaded = await downloadWithProgress(targetVersion);
    if (!downloaded) {
      installing = false;
      return { success: false, error: DOWNLOAD_ERROR_MESSAGE };
    }

    publish({
      phase: "installing",
      currentVersion,
      availableVersion: targetVersion,
    });

    try {
      // The STABLE token, named rather than inherited (see
      // `probeInstallableVersion`); `homebrew.ts` re-validates it against its
      // own Caskroom, so a wrong binding fails loudly into the catch below.
      upgrader.startUpgrade(appPath, STABLE_CASK_TOKEN);
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

    markHandedOff();

    try {
      options.pendingInstall?.write({
        fromVersion: currentVersion,
        toVersion: targetVersion,
        // Stamped so the next launch can tell "still working" from "failed".
        startedAt: now(),
        appPath: appPath ?? "",
        // The ordinary flow only ever upgrades the stable cask.
        caskToken: STABLE_CASK_TOKEN,
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
  };

  return {
    getState: () => state,

    getReleaseUrl: () => releaseUrl,

    checkForUpdates: async (): Promise<void> => {
      // An in-flight upgrade owns the state; a check would re-arm the button.
      if (!supported || checking || installing) return;

      checking = true;
      publish({ phase: "checking", currentVersion });
      try {
        const current = parseCurrentVersion(currentVersion);
        if (!current) throw new Error("Invalid installed version");

        // GitHub only supplies notes and the DMG size; it never decides the
        // offer.
        const [release, cached] = await Promise.all([
          readLatestRelease(),
          // Local tap clone only: `brew update` is a git fetch across every
          // tap, far too heavy for a routine check.
          canInstall ? probeInstallableVersion(false) : Promise.resolve(null),
        ]);

        const newerOnGitHub =
          release !== null && comparePrereleaseOrder(release.version, current) > 0;
        // Pay for a tap refresh only when GitHub says something is newer.
        const installable = parseStableVersion(
          canInstall && newerOnGitHub && !isNewerThan(cached, current)
            ? await probeInstallableVersion(true)
            : cached,
        );

        // Second read — see `inFlightOperationOwnsState`. Everything below
        // publishes, and the app may already be quitting into an operation.
        if (inFlightOperationOwnsState()) return;

        // Homebrew is what the button runs, so it decides for a cask install;
        // GitHub is the fallback for manual installs and unanswered probes.
        const target =
          (canInstall ? installable : null) ?? release?.version ?? null;
        if (target === null) {
          throw new Error("No usable update source");
        }

        if (comparePrereleaseOrder(target, current) > 0) {
          releaseUrl = `${RELEASES_URL}/tag/v${target.raw}`;
          // Notes and size only when GitHub describes the exact version
          // offered; otherwise they belong to a different release.
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
        // A release exists but is not installable yet: point at its exact tag
        // rather than the generic /releases/latest fallback.
        releaseUrl =
          pendingRelease === null
            ? null
            : `${RELEASES_URL}/tag/v${pendingRelease.version.raw}`;
        availableDmgSize = null;
        publish({
          phase: "up-to-date",
          currentVersion,
          ...(pendingRelease === null
            ? {}
            : {
                message: tapPendingMessage(pendingRelease.version.raw),
                releaseNotes: pendingRelease.releaseNotes,
              }),
        });
      } catch (error) {
        // Unreachable today but kept: any `await` added ahead of a throw
        // would let a failed check publish `error` over a live operation.
        if (inFlightOperationOwnsState()) return;
        releaseUrl = null;
        availableDmgSize = null;
        fail(error);
      } finally {
        checking = false;
      }
    },

    /**
     * Starts the detached Homebrew helper and quits so it can replace this
     * bundle. Never delete the tap gate: `brew upgrade` exits 0 when it has
     * nothing newer, so a lagging tap would quit and reopen the app unchanged.
     */
    installUpdate: async (): Promise<InstallUpdateResult> => {
      const upgrader = options.upgrader;
      if (!canInstall || !upgrader) {
        return { success: false, error: INSTALL_ERROR_MESSAGE };
      }
      if (installing) return { success: true };
      if (state.phase !== "available" || state.availableVersion === undefined) {
        return { success: false, error: INSTALL_ERROR_MESSAGE };
      }

      const targetVersion = state.availableVersion;
      // Claimed before the first publish: the tap probe is slow enough for a
      // second click to land inside it.
      return withInstallingClaim((markHandedOff) =>
        runInstallUpdate(upgrader, targetVersion, markHandedOff),
      );
    },

    /**
     * Re-executes the bundle Homebrew replaced, gated on `restart-required` so
     * a renderer message cannot restart at will. Re-exec, not `open -b`:
     * LaunchServices would find this process and merely focus it. A different
     * copy of FixLang is restarted by path instead.
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
     * The only caller of `releaseSource.getLatestPrerelease`, so an ordinary
     * check still costs one unauthenticated GitHub request, not two.
     */
    checkForPrerelease: async (): Promise<PrereleaseState> => {
      // `installing`: a switch in flight owns this state — same reason
      // `checkForUpdates` carries it.
      if (!supported || prereleaseChecking || installing) return prereleaseState;

      prereleaseChecking = true;
      const { activeChannel, canSwitch } = detectChannel();

      if (activeChannel === "both") {
        prereleaseChecking = false;
        publishPrerelease({
          phase: "error",
          activeChannel,
          canSwitch,
          message: bothCasksInstalledMessage(),
        });
        return prereleaseState;
      }

      publishPrerelease({ phase: "checking", activeChannel, canSwitch });

      try {
        const current = parseCurrentVersion(currentVersion);
        if (!current) throw new Error("Invalid installed version");

        // Called directly, not through a tolerant wrapper: this channel has
        // no second source, so a request failure must surface as an error
        // rather than collapse into the `null` that means nothing published.
        const candidate = await options.releaseSource.getLatestPrerelease();
        // Second read — the entry guard only stops a check that STARTS during
        // an operation, not one already waiting on GitHub.
        if (inFlightOperationOwnsState()) return prereleaseState;
        if (
          candidate !== null &&
          comparePrereleaseOrder(candidate.version, current) > 0
        ) {
          availablePrereleaseDmgSize = candidate.dmgSize;
          publishPrerelease({
            phase: "available",
            activeChannel,
            canSwitch,
            offeredVersion: candidate.version.raw,
            releaseNotes: candidate.releaseNotes,
          });
          return prereleaseState;
        }

        availablePrereleaseDmgSize = null;
        publishPrerelease({ phase: "up-to-date", activeChannel, canSwitch });
        return prereleaseState;
      } catch (error) {
        options.onLog?.(
          "warn",
          `Pre-release check failed (${safeErrorName(error)})`,
        );
        // Logged before this check, so the failure is recorded even when an
        // operation owns the state and the message is dropped.
        if (inFlightOperationOwnsState()) return prereleaseState;
        publishPrerelease({
          phase: "error",
          activeChannel,
          canSwitch,
          message: UPDATE_ERROR_MESSAGE,
        });
        return prereleaseState;
      } finally {
        prereleaseChecking = false;
      }
    },

    switchToPrerelease,

    revertToStable,

    subscribeToPrereleaseState: (listener) => {
      prereleaseListeners.add(listener);
      return () => prereleaseListeners.delete(listener);
    },
  };
};
