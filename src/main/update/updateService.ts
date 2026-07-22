import type { GitHubReleaseSource } from "./githubReleaseSource";
import type { UpdateState } from "~/shared/update";

export type UpdateService = {
  getState: () => UpdateState;
  checkForUpdates: () => Promise<void>;
  getReleaseUrl: () => string | null;
  subscribe: (listener: (state: UpdateState) => void) => () => void;
};

type UpdateServiceOptions = {
  releaseSource: GitHubReleaseSource;
  isPackaged: boolean;
  platform: string;
  arch: string;
  getCurrentVersion: () => string;
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
 * Owns check-only release state. GitHub metadata is untrusted until validated;
 * the release URL is derived locally rather than accepted from the response.
 */
export const createUpdateService = (
  options: UpdateServiceOptions,
): UpdateService => {
  const currentVersion = options.getCurrentVersion();
  const supported =
    options.isPackaged && options.platform === "darwin" && options.arch === "arm64";
  const listeners = new Set<(state: UpdateState) => void>();
  let checking = false;
  let releaseUrl: string | null = null;
  let state = freezeState({
    phase: supported ? "idle" : "unsupported",
    currentVersion,
    ...(supported
      ? {}
      : { message: "Updates are available in installed release builds." }),
  });

  const publish = (next: UpdateState): void => {
    state = freezeState(next);
    for (const listener of listeners) listener(state);
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

    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
};
