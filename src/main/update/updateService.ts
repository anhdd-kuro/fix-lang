import type { UpdateProgress, UpdateState } from "~/shared/update";

export type UpdateDriver = {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  allowPrerelease: boolean;
  allowDowngrade: boolean;
  on: (event: string, listener: (...args: unknown[]) => void) => unknown;
  checkForUpdates: () => Promise<unknown>;
  downloadUpdate: () => Promise<unknown>;
  quitAndInstall: () => void;
};

export type UpdateService = {
  getState: () => UpdateState;
  checkForUpdates: () => Promise<void>;
  downloadUpdate: () => Promise<void>;
  installUpdate: () => void;
  subscribe: (listener: (state: UpdateState) => void) => () => void;
};

type UpdateServiceOptions = {
  updater: UpdateDriver;
  isPackaged: boolean;
  platform: string;
  getCurrentVersion: () => string;
  onLog?: (level: "info" | "warn" | "error", message: string) => void;
};

type UpdateInfoLike = {
  version?: unknown;
  releaseNotes?: unknown;
};

type DownloadProgressLike = {
  percent?: unknown;
  transferred?: unknown;
  total?: unknown;
  bytesPerSecond?: unknown;
};

type UpdateFailureStage = "check" | "download" | "install" | "updater";

const RELEASE_NOTES_MAX_LENGTH = 12_000;

const updateErrorMessage =
  "Could not complete the update. Check your connection and try again.";

const SAFE_ERROR_NAMES = new Set([
  "AbortError",
  "CancellationError",
  "Error",
  "HttpError",
  "RangeError",
  "TypeError",
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const asUpdateInfo = (value: unknown): UpdateInfoLike =>
  isRecord(value) ? value : {};

const asFiniteNumber = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;

const normalizeReleaseNotes = (raw: unknown): string | undefined => {
  const notes =
    typeof raw === "string"
      ? raw
      : Array.isArray(raw)
        ? raw
            .map((item) =>
              isRecord(item) && typeof item.note === "string"
                ? item.note
                : "",
            )
            .filter(Boolean)
            .join("\n\n")
        : "";

  const trimmed = notes.trim();
  return trimmed.length > 0
    ? trimmed.slice(0, RELEASE_NOTES_MAX_LENGTH)
    : undefined;
};

const freezeState = (state: UpdateState): UpdateState =>
  Object.freeze({
    ...state,
    ...(state.progress
      ? { progress: Object.freeze({ ...state.progress }) }
      : {}),
  });

const versionFrom = (value: unknown): string | undefined => {
  const { version } = asUpdateInfo(value);
  return typeof version === "string" && version.trim().length > 0
    ? version
    : undefined;
};

const progressFrom = (value: unknown): UpdateProgress => {
  const progress = isRecord(value) ? (value as DownloadProgressLike) : {};
  return Object.freeze({
    percent: Math.max(0, Math.min(100, asFiniteNumber(progress.percent))),
    transferred: Math.max(0, asFiniteNumber(progress.transferred)),
    total: Math.max(0, asFiniteNumber(progress.total)),
    bytesPerSecond: Math.max(0, asFiniteNumber(progress.bytesPerSecond)),
  });
};

const safeErrorName = (error: unknown): string => {
  if (!(error instanceof Error) || !SAFE_ERROR_NAMES.has(error.name)) {
    return "UnknownError";
  }
  return error.name;
};

/**
 * Owns the updater state machine while keeping electron-updater behind an
 * injected adapter. This makes the transition rules testable without Electron.
 */
export const createUpdateService = (
  options: UpdateServiceOptions,
): UpdateService => {
  const currentVersion = options.getCurrentVersion();
  const supported = options.isPackaged && options.platform === "darwin";
  const listeners = new Set<(state: UpdateState) => void>();
  let checking = false;
  let downloading = false;
  let installing = false;
  let failureHandled = false;
  let state = freezeState({
    phase: supported ? "idle" : "unsupported",
    currentVersion,
    ...(supported
      ? {}
      : { message: "Updates are available in installed release builds." }),
  });

  const publish = (next: UpdateState): void => {
    state = freezeState(next);
    for (const listener of listeners) {
      listener(state);
    }
  };

  const fail = (stage: UpdateFailureStage, error: unknown): void => {
    // electron-updater can emit `error` and reject the active operation with
    // the same failure. Keep one renderer transition and one persisted log.
    if (failureHandled) {
      return;
    }
    failureHandled = true;
    checking = false;
    downloading = false;
    installing = false;
    // Error.message/stack may contain release URLs, query strings, or local
    // cache paths. Persist only a fixed stage and an allow-listed error name.
    options.onLog?.(
      "warn",
      `App update ${stage} failed (${safeErrorName(error)})`,
    );
    publish({
      phase: "error",
      currentVersion,
      availableVersion: state.availableVersion,
      message: updateErrorMessage,
    });
  };

  if (supported) {
    options.updater.autoDownload = false;
    options.updater.autoInstallOnAppQuit = false;
    options.updater.allowPrerelease = false;
    options.updater.allowDowngrade = false;

    options.updater.on("checking-for-update", () => {
      checking = true;
      publish({ phase: "checking", currentVersion });
    });
    options.updater.on("update-available", (info: unknown) => {
      checking = false;
      const parsed = asUpdateInfo(info);
      publish({
        phase: "available",
        currentVersion,
        availableVersion: versionFrom(info),
        releaseNotes: normalizeReleaseNotes(parsed.releaseNotes),
      });
    });
    options.updater.on("update-not-available", () => {
      checking = false;
      publish({ phase: "up-to-date", currentVersion });
    });
    options.updater.on("download-progress", (progress: unknown) => {
      publish({
        phase: "downloading",
        currentVersion,
        availableVersion: state.availableVersion,
        releaseNotes: state.releaseNotes,
        progress: progressFrom(progress),
      });
    });
    options.updater.on("update-downloaded", (info: unknown) => {
      downloading = false;
      publish({
        phase: "downloaded",
        currentVersion,
        availableVersion: versionFrom(info) ?? state.availableVersion,
        releaseNotes: state.releaseNotes,
      });
    });
    options.updater.on("error", (error: unknown) => {
      const stage: UpdateFailureStage = installing
        ? "install"
        : downloading
          ? "download"
          : checking
            ? "check"
            : "updater";
      fail(stage, error);
    });
  }

  return {
    getState: () => state,

    checkForUpdates: async (): Promise<void> => {
      if (!supported || checking || downloading || installing) {
        return;
      }
      failureHandled = false;
      checking = true;
      publish({ phase: "checking", currentVersion });
      try {
        await options.updater.checkForUpdates();
      } catch (error) {
        fail("check", error);
      } finally {
        checking = false;
      }
    },

    downloadUpdate: async (): Promise<void> => {
      if (
        !supported ||
        downloading ||
        checking ||
        installing ||
        state.phase !== "available"
      ) {
        return;
      }
      failureHandled = false;
      downloading = true;
      publish({
        phase: "downloading",
        currentVersion,
        availableVersion: state.availableVersion,
        releaseNotes: state.releaseNotes,
      });
      try {
        await options.updater.downloadUpdate();
      } catch (error) {
        fail("download", error);
      } finally {
        downloading = false;
      }
    },

    installUpdate: (): void => {
      if (!supported || installing || state.phase !== "downloaded") {
        return;
      }
      failureHandled = false;
      installing = true;
      try {
        options.updater.quitAndInstall();
      } catch (error) {
        fail("install", error);
      }
    },

    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
};
