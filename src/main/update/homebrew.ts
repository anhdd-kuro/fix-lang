import { execFile, spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync, statSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Homebrew is never resolved from PATH: a GUI Electron process inherits a
 * minimal environment, and an attacker-controlled PATH entry must never be
 * able to decide which binary runs an upgrade. Only these fixed, standard
 * prefixes are accepted.
 */
export const BREW_BINARY_CANDIDATES = Object.freeze([
  "/opt/homebrew/bin/brew",
  "/usr/local/bin/brew",
] as const);

/** Cask token published by `anhdd-kuro/homebrew-tap`. */
export const CASK_TOKEN = "fixlang";

const BUNDLE_ID = "com.fixlang.app";
const PROCESS_NAME = "FixLang";
const QUIT_TIMEOUT_SECONDS = 30;

/**
 * NONINTERACTIVE makes Homebrew fail rather than block on a hidden prompt.
 * Auto-update is off because the probe refreshes the tap explicitly, and an
 * implicit second refresh would only add latency to a user-facing click.
 */
const BREW_ENV = Object.freeze({
  NONINTERACTIVE: "1",
  HOMEBREW_NO_ENV_HINTS: "1",
  HOMEBREW_NO_AUTO_UPDATE: "1",
});

const BREW_PROBE_TIMEOUT_MS = 90_000;
const BREW_PROBE_MAX_BUFFER = 4 * 1024 * 1024;

export type FileProbe = (candidatePath: string) => boolean;
export type DetachedRunner = (script: string, logFilePath: string) => void;
export type BrewRunner = (
  brewBinary: string,
  args: readonly string[],
) => Promise<string>;

const isExecutableFile: FileProbe = (candidatePath) => {
  try {
    return statSync(candidatePath).isFile();
  } catch {
    return false;
  }
};

const isDirectory: FileProbe = (candidatePath) => {
  try {
    return statSync(candidatePath).isDirectory();
  } catch {
    return false;
  }
};

/** First standard Homebrew binary that exists, or null when brew is absent. */
export const findBrewBinary = (
  fileExists: FileProbe = isExecutableFile,
): string | null =>
  BREW_BINARY_CANDIDATES.find((candidate) => fileExists(candidate)) ?? null;

/** Caskroom entry Homebrew creates for an installed cask. */
export const caskroomPath = (brewBinary: string): string =>
  path.join(path.dirname(path.dirname(brewBinary)), "Caskroom", CASK_TOKEN);

/** Rejects anything that could escape the Caskroom directory. */
const SAFE_VERSION_PATTERN = /^[0-9A-Za-z][0-9A-Za-z.+_-]*$/;

/**
 * Homebrew keeps one directory per installed version, so its presence is the
 * cheapest proof that the upgrade already replaced the bundle — no subprocess,
 * and it stays true after the helper has exited.
 */
export const caskVersionPath = (
  brewBinary: string,
  version: string,
): string | null =>
  SAFE_VERSION_PATTERN.test(version) && !version.includes("..")
    ? path.join(caskroomPath(brewBinary), version)
    : null;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Cask version from `brew info --json=v2`, or null for unusable output. */
export const parseCaskVersion = (stdout: string): string | null => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return null;
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.casks)) {
    return null;
  }

  const cask = parsed.casks.find(
    (entry) => isRecord(entry) && entry.token === CASK_TOKEN,
  );
  if (!isRecord(cask) || typeof cask.version !== "string") {
    return null;
  }
  return cask.version;
};

const runBrewCommand: BrewRunner = async (brewBinary, args) => {
  const { stdout } = await execFileAsync(brewBinary, [...args], {
    env: { ...process.env, ...BREW_ENV },
    timeout: BREW_PROBE_TIMEOUT_MS,
    maxBuffer: BREW_PROBE_MAX_BUFFER,
  });
  return stdout;
};

/**
 * Version Homebrew would install right now.
 *
 * `brew update` runs first because the local tap clone lags the published
 * GitHub release: the app can see a release that the cask cannot install yet,
 * and `brew upgrade` treats that as a no-op success. Returns null when brew
 * cannot be asked at all — callers must read that as "unknown", never as
 * "too old", so a flaky probe cannot block a working install.
 */
const readInstallableVersion = async (
  brewBinary: string,
  runBrew: BrewRunner,
): Promise<string | null> => {
  try {
    await runBrew(brewBinary, ["update", "--quiet"]);
  } catch {
    // A failed refresh only means the answer may be stale; still ask for it.
  }
  try {
    return parseCaskVersion(
      await runBrew(brewBinary, ["info", "--cask", CASK_TOKEN, "--json=v2"]),
    );
  } catch {
    return null;
  }
};

/**
 * The upgrade cannot run inside this process: Homebrew replaces the very app
 * bundle that is executing. The script therefore waits for FixLang to exit,
 * upgrades, and reopens the app. It refuses to touch the bundle while the app
 * is still running, so a stuck quit fails loudly instead of corrupting it.
 *
 * NONINTERACTIVE makes Homebrew fail rather than block on a hidden prompt in a
 * process with no terminal.
 */
export const buildUpgradeScript = (brewBinary: string): string =>
  [
    "set -u",
    "export NONINTERACTIVE=1",
    "export HOMEBREW_NO_ENV_HINTS=1",
    "waited=0",
    `while /usr/bin/pgrep -x ${PROCESS_NAME} >/dev/null 2>&1; do`,
    `  if [ "$waited" -ge ${QUIT_TIMEOUT_SECONDS} ]; then`,
    `    echo "FixLang did not quit within ${QUIT_TIMEOUT_SECONDS}s; upgrade aborted." >&2`,
    "    exit 1",
    "  fi",
    "  /bin/sleep 1",
    "  waited=$((waited + 1))",
    "done",
    `"${brewBinary}" update || exit 1`,
    `"${brewBinary}" upgrade --cask ${CASK_TOKEN} || exit 1`,
    `/usr/bin/open -b ${BUNDLE_ID} || /usr/bin/open -a ${PROCESS_NAME}`,
  ].join("\n");

const runDetached: DetachedRunner = (script, logFilePath) => {
  mkdirSync(path.dirname(logFilePath), { recursive: true });
  const logFd = openSync(logFilePath, "a");

  try {
    const child = spawn("/bin/sh", ["-c", script], {
      detached: true,
      stdio: ["ignore", logFd, logFd],
    });
    // Detach fully: the helper must outlive the app it is replacing.
    child.unref();
  } finally {
    // The child keeps its own duplicated descriptor.
    closeSync(logFd);
  }
};

export type HomebrewUpgraderOptions = Readonly<{
  /** True only for a packaged app launched from a standard Applications folder. */
  isInstalledApp: boolean;
  logFilePath: string;
  fileExists?: FileProbe;
  directoryExists?: FileProbe;
  startDetached?: DetachedRunner;
  runBrew?: BrewRunner;
}>;

export type HomebrewUpgrader = Readonly<{
  /** True when a one-click upgrade is actually possible for this install. */
  canInstall: boolean;
  /** Version the tap can install now; null when brew could not be asked. */
  getInstallableVersion: () => Promise<string | null>;
  /** True once Homebrew has staged that version in the Caskroom. */
  isVersionInstalled: (version: string) => boolean;
  /** Launches the detached upgrade helper. Throws when it cannot start. */
  startUpgrade: () => void;
}>;

/**
 * One-click updates only apply to the Homebrew cask install, which is the sole
 * distribution path that can replace the bundle without automating Gatekeeper.
 * Manual DMG installs keep the documented manual flow.
 */
export const createHomebrewUpgrader = (
  options: HomebrewUpgraderOptions,
): HomebrewUpgrader => {
  const fileExists = options.fileExists ?? isExecutableFile;
  const directoryExists = options.directoryExists ?? isDirectory;
  const startDetached = options.startDetached ?? runDetached;
  const runBrew = options.runBrew ?? runBrewCommand;

  const brewBinary = options.isInstalledApp ? findBrewBinary(fileExists) : null;
  const canInstall =
    brewBinary !== null && directoryExists(caskroomPath(brewBinary));

  return Object.freeze({
    canInstall,
    getInstallableVersion: (): Promise<string | null> =>
      canInstall && brewBinary !== null
        ? readInstallableVersion(brewBinary, runBrew)
        : Promise.resolve(null),
    isVersionInstalled: (version: string): boolean => {
      if (brewBinary === null) return false;
      const versionPath = caskVersionPath(brewBinary, version);
      return versionPath !== null && directoryExists(versionPath);
    },
    startUpgrade: (): void => {
      if (!canInstall || brewBinary === null) {
        throw new Error("FixLang was not installed with the Homebrew cask");
      }
      startDetached(buildUpgradeScript(brewBinary), options.logFilePath);
    },
  });
};
