import { spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync, statSync } from "node:fs";
import path from "node:path";

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

export type FileProbe = (candidatePath: string) => boolean;
export type DetachedRunner = (script: string, logFilePath: string) => void;

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
}>;

export type HomebrewUpgrader = Readonly<{
  /** True when a one-click upgrade is actually possible for this install. */
  canInstall: boolean;
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

  const brewBinary = options.isInstalledApp ? findBrewBinary(fileExists) : null;
  const canInstall =
    brewBinary !== null && directoryExists(caskroomPath(brewBinary));

  return Object.freeze({
    canInstall,
    startUpgrade: (): void => {
      if (!canInstall || brewBinary === null) {
        throw new Error("FixLang was not installed with the Homebrew cask");
      }
      startDetached(buildUpgradeScript(brewBinary), options.logFilePath);
    },
  });
};
