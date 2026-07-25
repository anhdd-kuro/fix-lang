import { reconcilePendingInstall, type PendingInstallStore } from "./pendingInstall";
import type { GitHubReleaseSource } from "./githubReleaseSource";
import type { HomebrewUpgrader } from "./homebrew";
import type { InstallUpdateResult, UpdateState } from "~/shared/update";

export type UpdateService = {
  getState: () => UpdateState;
  checkForUpdates: () => Promise<void>;
  installUpdate: () => InstallUpdateResult;
  getReleaseUrl: () => string | null;
  subscribe: (listener: (state: UpdateState) => void) => () => void;
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
  /** Called after the detached helper starts, so it can replace the bundle. */
  quitApp?: () => void;
  onLog?: (level: "info" | "warn" | "error", message: string) => void;
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
}>;

const RELEASE_NOTES_MAX_LENGTH = 12_000;
const UPDATE_ERROR_MESSAGE = "Could not check for updates. Try again later.";
const INSTALL_ERROR_MESSAGE =
  "Could not start the Homebrew update. Update manually with the command below.";
const INSTALL_INCOMPLETE_MESSAGE =
  "Homebrew did not finish the last update. Update manually with the command below.";
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

const compareVersions = (left: StableVersion, right: StableVersion): number => {
  for (const part of ["major", "minor", "patch"] as const) {
    if (left[part] !== right[part]) return left[part] - right[part];
  }
  return 0;
};

const normalizeReleaseNotes = (raw: string | undefined): string | undefined => {
  const trimmed = raw?.trim();
  return trimmed && trimmed.length > 0
    ? trimmed.slice(0, RELEASE_NOTES_MAX_LENGTH)
    : undefined;
};

const hasExpectedDmg = (assets: unknown, version: StableVersion): boolean => {
  if (!Array.isArray(assets)) return false;
  const expectedName = `FixLang-${version.raw}-arm64.dmg`;

  return assets.some(
    (asset) =>
      isRecord(asset) &&
      asset.name === expectedName &&
      asset.state === "uploaded" &&
      typeof asset.size === "number" &&
      Number.isSafeInteger(asset.size) &&
      asset.size > 0,
  );
};

const validateRelease = (value: unknown): ValidatedRelease | null => {
  if (!isRecord(value) || value.draft !== false || value.prerelease !== false) {
    return null;
  }
  if (typeof value.tag_name !== "string") return null;

  const tagMatch = /^v(.+)$/.exec(value.tag_name);
  const version = tagMatch ? parseStableVersion(tagMatch[1]) : null;
  if (!version || !hasExpectedDmg(value.assets, version)) return null;
  // GitHub returns JSON null when a release has no notes.
  if (value.body != null && typeof value.body !== "string") return null;

  return Object.freeze({
    version,
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
  let checking = false;
  let installing = false;
  let releaseUrl: string | null = null;

  const withCanInstall = (next: Omit<UpdateState, "canInstall">): UpdateState =>
    freezeState({ ...next, canInstall });

  let state = withCanInstall({
    phase: supported ? "idle" : "unsupported",
    currentVersion,
    ...(supported
      ? {}
      : { message: "Updates are available in installed release builds." }),
  });

  const publish = (next: Omit<UpdateState, "canInstall">): void => {
    state = withCanInstall(next);
    for (const listener of listeners) listener(state);
  };

  /**
   * Homebrew finishes after this app has quit, so the previous run's marker is
   * the only evidence of what happened. Report a stalled upgrade loudly.
   */
  const reconcileLastInstall = (): void => {
    const store = options.pendingInstall;
    if (!supported || !store) return;

    const pending = store.read();
    const outcome = reconcilePendingInstall(pending, currentVersion);
    if (outcome === "none") return;

    store.clear();
    if (outcome === "installed") {
      options.onLog?.("info", `App updated to ${currentVersion} via Homebrew`);
      publish({ phase: "up-to-date", currentVersion });
      return;
    }

    options.onLog?.("warn", "Homebrew update did not change the app version");
    publish({
      phase: "error",
      currentVersion,
      message: INSTALL_INCOMPLETE_MESSAGE,
    });
  };

  reconcileLastInstall();

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
      if (!supported || checking) return;

      checking = true;
      publish({ phase: "checking", currentVersion });
      try {
        const current = parseStableVersion(currentVersion);
        const release = validateRelease(await options.releaseSource.getLatestRelease());
        if (!current || !release) {
          throw new Error("Invalid GitHub release metadata");
        }

        if (compareVersions(release.version, current) > 0) {
          releaseUrl = `${RELEASES_URL}/tag/v${release.version.raw}`;
          publish({
            phase: "available",
            currentVersion,
            availableVersion: release.version.raw,
            releaseNotes: release.releaseNotes,
          });
          return;
        }

        releaseUrl = null;
        publish({ phase: "up-to-date", currentVersion });
      } catch (error) {
        releaseUrl = null;
        fail(error);
      } finally {
        checking = false;
      }
    },

    /**
     * Starts the detached Homebrew helper and quits so it can replace this
     * bundle. Only a validated `available` state may trigger it, and only for
     * a cask install — never for a manually placed DMG copy.
     */
    installUpdate: (): InstallUpdateResult => {
      if (!canInstall || !options.upgrader) {
        return { success: false, error: INSTALL_ERROR_MESSAGE };
      }
      if (installing) return { success: true };
      if (state.phase !== "available" || state.availableVersion === undefined) {
        return { success: false, error: INSTALL_ERROR_MESSAGE };
      }

      const targetVersion = state.availableVersion;
      try {
        options.upgrader.startUpgrade();
      } catch (error) {
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

      installing = true;
      try {
        options.pendingInstall?.write({
          fromVersion: currentVersion,
          toVersion: targetVersion,
        });
      } catch (error) {
        // The upgrade still runs; only the outcome report is lost.
        options.onLog?.(
          "warn",
          `Could not record the pending update (${safeErrorName(error)})`,
        );
      }

      options.onLog?.("info", `Homebrew update to ${targetVersion} started`);
      publish({
        phase: "installing",
        currentVersion,
        availableVersion: targetVersion,
      });
      options.quitApp?.();
      return { success: true };
    },

    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
};
