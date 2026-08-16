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
  /**
   * A SECOND, independently-published state — see `PrereleaseState`'s doc
   * comment.
   */
  getPrereleaseState: () => PrereleaseState;
  /**
   * The ONLY place `releaseSource.getLatestPrerelease` is ever called.
   * `checkForUpdates` must never reach it — see that method's doc comment.
   */
  checkForPrerelease: () => Promise<PrereleaseState>;
  /**
   * Confirms the exact offered version with the user, downloads it with the
   * app still running, then hands off to the detached channel-switch helper
   * and quits — same shape as `installUpdate`, but stable -> beta and gated
   * by a confirm. See `UpdateServiceOptions.confirmPrereleaseSwitch`.
   */
  switchToPrerelease: () => Promise<UpdateActionResult>;
  /**
   * Same mechanics in the other direction (beta -> stable) with no confirm —
   * reverting is the safe direction, reached for exactly when a pre-release
   * build is misbehaving.
   */
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
   * `detectActiveCaskChannel`, composed with `findBrewBinary` in
   * `index.ts`). A `null` result (or this collaborator being entirely
   * absent) means "could not be determined" — `"stable"` for DISPLAY (the
   * correct default for every install this app shipped before pre-release
   * existed), but never for `canSwitch`: see `detectChannel` below.
   */
  detectActiveCaskChannel?: () => ActiveCaskChannel | null;
  /**
   * Confirms a channel switch with the user before anything else happens —
   * a native dialog in production (`index.ts`, the AWAITED
   * `dialog.showMessageBox`, never the sync form). Injected here so it is
   * testable without Electron. Absent, or a resolved `false`, refuses the
   * switch with none of its side effects run: no download, no marker write,
   * no quit. Never called by `revertToStable` — reverting needs no confirm.
   */
  confirmPrereleaseSwitch?: (targetVersion: string) => Promise<boolean>;
  /**
   * Starts the detached channel-switch helper — wraps
   * `buildChannelSwitchScript` the same way `HomebrewUpgrader.startUpgrade`
   * wraps `buildUpgradeScript`. Not a `HomebrewUpgrader` method: that type is
   * bound to a single token for its whole lifetime, but a switch needs a
   * (current, target) PAIR decided per call — stable -> beta for a switch,
   * beta -> stable for a revert — so it is injected here instead. Throws
   * when it cannot start, mirroring `startUpgrade`'s contract.
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

// New keys for card 10's catalogs — the pre-release section never writes
// into the stable flow's result line, so it gets its own wording rather than
// reusing `INSTALL_ERROR_MESSAGE`/`DOWNLOAD_ERROR_MESSAGE` above.
const SWITCH_ERROR_MESSAGE: Message = msg("settings.updates.prerelease.switchErrorMessage");
const SWITCH_CANCELLED_MESSAGE: Message = msg(
  "settings.updates.prerelease.switchCancelledMessage",
);
const REVERT_ERROR_MESSAGE: Message = msg("settings.updates.prerelease.revertErrorMessage");
const PRERELEASE_DOWNLOAD_ERROR_MESSAGE: Message = msg(
  "settings.updates.prerelease.downloadErrorMessage",
);

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

/**
 * Which of the two independently published states a pending marker's outcome
 * belongs to — and, when it is the pre-release one, which direction the user
 * actually clicked, so the failure can be worded for that operation instead
 * of the stable flow's "did not finish the last update".
 *
 * `caskToken` alone cannot answer this, even though it is the field that
 * exists to name the channel: a REVERT targets the stable token too, so its
 * marker is byte-indistinguishable from an ordinary stable upgrade's by token
 * alone. The version it came FROM is what gives it away — only a channel
 * operation can start from a beta build.
 */
type ChannelOperation = "switch" | "revert";

const pendingChannelOperation = (
  pending: PendingInstall,
): ChannelOperation | null => {
  if (pending.caskToken === BETA_CASK_TOKEN) return "switch";
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
  /**
   * The ordinary flow upgrades the STABLE cask IN PLACE, and only that. A
   * beta install has no stable Caskroom entry, so `startUpgrade` refuses the
   * stable token outright (`homebrew.ts` re-validates the effective token's
   * own Caskroom) — offering the button would hand exactly the beta
   * population a control that throws after they pressed it. Their route to a
   * stable release is `revertToStable`, which uninstalls the beta token
   * rather than upgrading a cask that was never installed.
   *
   * Probed only once a cask install exists at all, so an unsupported build
   * still never touches the Caskroom.
   */
  const canInstall =
    supported &&
    (options.upgrader?.canInstall ?? false) &&
    (options.detectActiveCaskChannel?.() ?? null) !== "beta";
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

  /**
   * Raw Caskroom detection, deliberately never collapsed the same way
   * `activeChannel`'s DISPLAY value is. `canSwitch` used to be `canInstall`
   * — a flag scoped to whichever token `upgrader` happens to be bound to,
   * which is always the STABLE cask (see `probeInstallableVersion`'s doc
   * comment) — so a genuine beta install, which has no stable Caskroom entry
   * at all, saw its revert button permanently dead. `canSwitch` is instead
   * true whenever the probe resolved to exactly one real token: `null`
   * (undetectable — no collaborator wired, or neither token staged, e.g. a
   * manual DMG install) and `"both"` (ambiguous) both refuse; `"stable"` and
   * `"beta"` both allow, regardless of which one.
   */
  const detectChannel = (): Pick<PrereleaseState, "activeChannel" | "canSwitch"> => {
    const raw = options.detectActiveCaskChannel?.() ?? null;
    return {
      // Undetected still defaults to "stable" for DISPLAY — the correct
      // reading for every install this app shipped before pre-release
      // existed — but that default never leaks into `canSwitch` above.
      activeChannel: raw ?? "stable",
      canSwitch: raw !== null && raw !== "both",
    };
  };

  let prereleaseState: PrereleaseState = supported
    ? freezePrereleaseState({ phase: "idle", ...detectChannel() })
    : freezePrereleaseState({
        // Never probed on an unsupported build: nothing here can ever switch
        // or revert, so a Caskroom read at construction would just be
        // wasted work.
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
   * The bundle is new but this process is not; only a restart fixes that.
   *
   * A channel operation gets this in BOTH states, and that is deliberate:
   * `restart-required` is the one outcome carrying an ACTION rather than a
   * report, and `restartForUpdate` is gated on `state.phase`. Publishing it
   * only to `PrereleaseState` would leave a user with the new build already
   * installed, a Restart button answering `RESTART_ERROR_MESSAGE`, and no way
   * out but quitting by hand. It is also simply true in both sections: the
   * app on disk really is a different version from the one running.
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
        // Re-probed rather than carried forward: the switch just landed, so
        // this is the moment the badge can finally tell the truth.
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
   * the ordinary Updates section never started this work, and
   * `INSTALL_INCOMPLETE_MESSAGE` is worded for an update — reading "Homebrew
   * did not finish the last update" after a revert names the wrong operation
   * in the wrong section, while the Pre-release section the user actually
   * pressed sits at `idle` with no trace at all.
   */
  const publishIncomplete = (
    channelOperation: ChannelOperation | null = null,
  ): void => {
    installing = false;
    options.pendingInstall?.clear();
    options.onLog?.("warn", "Homebrew update did not change the app version");
    if (channelOperation !== null) {
      publishPrerelease({
        phase: "error",
        ...detectChannel(),
        message:
          channelOperation === "switch"
            ? SWITCH_ERROR_MESSAGE
            : REVERT_ERROR_MESSAGE,
      });
      return;
    }
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
    /**
     * The marker's own token — routed defect: this used to omit it and
     * always probe the upgrader's BOUND channel (stable), so a successful
     * beta install (or a revert) never registered here and, after the grace
     * window, a genuinely correct install reported `failed`.
     * `pendingInstall.ts`'s `ReconcileContext.isTargetInstalled` doc comment
     * states this contract verbatim.
     */
    caskToken: CaskToken,
    /** Non-null when the marker belongs to a switch or a revert. */
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

    // Decided once, from the marker itself, and threaded through every branch
    // below: the state a channel switch reports into is not the one an
    // ordinary update reports into. See `pendingChannelOperation`.
    const channelOperation = pendingChannelOperation(pending);

    const outcome = reconcilePendingInstall(pending, currentVersion, {
      now: now(),
      // Resolved against the marker's OWN token, not the upgrader's bound
      // one — see `watchBackgroundUpgrade`'s doc comment for why that
      // omission was a routed defect.
      isTargetInstalled:
        options.upgrader?.isVersionInstalled(pending.toVersion, pending.caskToken) ??
        false,
      runningAppPath: appPath,
    });
    if (outcome === "none") return;

    if (outcome === "in-progress") {
      // Marker stays: the helper still owns this upgrade and will finish it.
      installing = true;
      // `installing` blocks BOTH pre-release buttons for the rest of the
      // grace window, so a channel operation that reports nowhere leaves the
      // user pressing controls that answer with a bare error.
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
        // The switch landed and this process is already running it, so the
        // freshly probed channel is the one to show from now on.
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
      // Homebrew did its job; something else reopened. Say which bundle is
      // running — a version number alone reads as a failed update, and the
      // user would have no idea a second copy of the app exists.
      options.onLog?.(
        "warn",
        `Reopened ${currentVersion} from ${appPath ?? "an unknown bundle"} instead of ${pending.toVersion} from ${pending.appPath}`,
      );
      restartTargetPath = pending.appPath;
      installing = true;
      if (channelOperation !== null) {
        // Path-free on this side on purpose: `PrereleaseState`'s contract
        // forbids file paths, and the stray-bundle detail belongs to the
        // stable state's message, which is published right below and is
        // where that exemption is documented.
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

    publishIncomplete(channelOperation);
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

  /**
   * True only for a parsed version strictly newer than the installed one.
   *
   * `current` is `OrderableVersion`, not `StableVersion`: the caller passes
   * `parseCurrentVersion`'s result, which carries `beta` once the user is on
   * the pre-release channel, and `comparePrereleaseOrder` below reads exactly
   * that field. The narrower type compiled (an extra property is allowed
   * through a non-literal assignment) while asserting the opposite of what
   * correctness depends on — anyone who trusted it and narrowed `current` on
   * the way in would drop `beta`, and a user on `1.2.3-beta.1` would be told
   * `1.2.3` is not newer.
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
   * Never rejects: a broken probe must not strand the install flow.
   *
   * `caskToken` defaults to STABLE explicitly — not merely because `upgrader`
   * (below) happens to be bound to it. This is the routed "silently
   * stable-only" gate: `checkForUpdates`/`installUpdate` must always target
   * the stable cask regardless of what token `upgrader` is ever bound to, so
   * a future rebind (e.g. for the pre-release flow) cannot silently steer
   * the ordinary update flow onto the wrong cask. `revertToStable` passes
   * this same explicit `STABLE_CASK_TOKEN` to probe what stable version it
   * would land on; the pre-release flow otherwise never calls this at all.
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
   * Shared tail of `switchToPrerelease`/`revertToStable`, run only after each
   * has resolved its own precondition (and, for a switch only, its confirm).
   * Order mirrors `installUpdate`'s stable path exactly and IS the whole
   * correctness story for the "no app installed" window: download with the
   * app still running and visible progress, THEN hand off to the detached
   * helper and quit — never the reverse, which would leave the user staring
   * at a vanished app for as long as the download takes.
   *
   * `activeChannel`/`canSwitch` are carried forward from the state already
   * published by the caller rather than re-probed here: this is a directory
   * probe that could be affected by the very switch in flight, and flipping
   * mid-operation would be a live badge lying about something the user
   * cannot act on until the switch resolves anyway.
   */
  const runChannelSwitch = async (
    { currentToken, targetToken, targetVersion }: ChannelSwitchParams,
    helperErrorMessage: Message,
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

    // Everything left is a local file move inside the detached helper, so
    // the app is only away for a few seconds — same discipline as the
    // stable flow's own "installing" phase.
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

    try {
      options.pendingInstall?.write({
        fromVersion: currentVersion,
        toVersion: targetVersion,
        startedAt: now(),
        appPath: appPath ?? "",
        // The TARGET token, never the bound upgrader's own — this is what
        // lets `reconcilePendingInstall` resolve a revert (a version LOWER
        // than the one running) against the right Caskroom.
        caskToken: targetToken,
      });
    } catch (error) {
      // The switch still runs; only the outcome report is lost.
      options.onLog?.(
        "warn",
        `Could not record the pending channel switch (${safeErrorName(error)})`,
      );
    }

    // Names both tokens and the version, never a path — matches the "leaks
    // no path" criterion for this log line.
    options.onLog?.(
      "info",
      `Channel switch from ${currentToken} to ${targetToken} started, targeting ${targetVersion}`,
    );
    options.quitApp?.();
    return { success: true };
  };

  /**
   * Re-reads the Caskroom immediately before a switch or a revert commits to
   * a SOURCE token.
   *
   * `prereleaseState.activeChannel` is a CACHED display value, last written
   * at construction or at the last check. FixLang is a tray app that stays
   * open for days: a user who runs `brew uninstall --cask fixlang@beta &&
   * brew install --cask fixlang` in a terminal leaves that panel describing a
   * cask that is no longer staged. Handing the stale token to the helper
   * makes it quit the app, uninstall a cask that is not installed, and exit
   * on the script's `|| exit 1` — after the download already succeeded, so
   * nothing on screen hints at what went wrong.
   *
   * `null` (undetectable), `"both"` (ambiguous) and any channel that
   * disagrees with the one the panel offered all refuse, and the refusal
   * republishes what was actually probed so the badge stops lying.
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
   * Confirms the exact offered version BEFORE anything else runs — no
   * download, no marker write, no quit — so a declined dialog is a complete
   * no-op: nothing published, nothing written, nothing quit. `installing` is
   * still claimed before the confirm await (mirroring `installUpdate`'s own
   * "claimed before the first await" discipline) so a second click cannot
   * start a second switch while the dialog is on screen; a decline rolls it
   * back rather than leaving it stuck.
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
    installing = true;
    const confirmed = (await options.confirmPrereleaseSwitch?.(targetVersion)) ?? false;
    if (!confirmed) {
      installing = false;
      return { success: false, error: SWITCH_CANCELLED_MESSAGE };
    }

    // The tap-lag gate the stable flow has, for the channel this actually
    // installs. `installUpdate`'s own gate cannot cover this path: it reads
    // `state.availableVersion` (always a stable version) and probes the
    // stable token, while a beta reaches GitHub hours before the tap syncs
    // `fixlang@beta`. A null or unparseable probe means brew could not be
    // asked, not that it is behind — proceed, exactly as `installUpdate`
    // does.
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
    );
  };

  /**
   * No confirm, ever: reverting to stable is the safe direction, and it is
   * exactly what a user reaches for when a pre-release build is misbehaving.
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

    // Claimed before this await too — the tap probe is slow enough that a
    // second click would otherwise start a second revert.
    installing = true;
    const targetVersion = await probeInstallableVersion(true, STABLE_CASK_TOKEN);
    if (targetVersion === null) {
      installing = false;
      // `getInstallableVersion` RESOLVES null rather than throwing when brew
      // cannot be asked, so `probeInstallableVersion`'s catch never runs and
      // this used to fail with nothing logged and nothing published — a dead
      // button and no trace of why.
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
    );
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

      const offeredRaw = await probeInstallableVersion();
      const offered =
        offeredRaw === null ? null : parseCurrentVersion(offeredRaw);
      // `parseCurrentVersion`, not `parseStableVersion`: that this state only
      // ever carries a stable string is an emergent property of
      // `checkForUpdates`, enforced nowhere near this gate, and
      // `availableVersion` is validated across IPC as a plain `string`.
      const target = parseCurrentVersion(targetVersion);
      // The two nulls mean opposite things and must not share one falsy
      // check. A null `offered` is brew declining to answer — "unknown",
      // never "too old", so it proceeds. A null `target` is our own published
      // state being unparseable, which must never sail past a never-delete
      // gate. Unreachable today (every published `availableVersion` came out
      // of a parser), so it is a defence rather than a fixed bug.
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
        // Explicit, same reasoning as `probeInstallableVersion`'s doc
        // comment: the ordinary flow always upgrades the STABLE cask.
        options.upgrader.startUpgrade(appPath, STABLE_CASK_TOKEN);
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
          // "some other copy of FixLang opened instead". `PendingInstall`
          // requires a string; `appPath` is `string | null` here.
          appPath: appPath ?? "",
          // Routed defect: this used to be omitted entirely, even though
          // `caskToken` became a required field. Always stable here — the
          // ordinary flow only ever upgrades the stable cask.
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
      // `installing` for the same reason `checkForUpdates` carries it: a
      // switch in flight owns this state, and a check would wipe its live
      // download progress and then publish `available`/`up-to-date` over the
      // top — the GitHub scan outlives the fetch, so that stale answer can
      // land moments before `quitApp` fires.
      if (!supported || prereleaseChecking || installing) return prereleaseState;

      prereleaseChecking = true;
      const { activeChannel, canSwitch } = detectChannel();

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
          canSwitch,
          message: bothCasksInstalledMessage(),
        });
        return prereleaseState;
      }

      publishPrerelease({ phase: "checking", activeChannel, canSwitch });

      try {
        const current = parseCurrentVersion(currentVersion);
        if (!current) throw new Error("Invalid installed version");

        // Called directly — NOT through a tolerant wrapper like
        // `readLatestRelease` above. The stable check can afford to swallow
        // a GitHub failure into "nothing new" because Homebrew answers
        // independently; the pre-release channel has no second source, so a
        // request failure (a 403, an offline abort) must surface as an
        // error here rather than collapse into the same `null` a genuine
        // "nothing published" produces and read as up-to-date.
        const candidate = await options.releaseSource.getLatestPrerelease();
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
