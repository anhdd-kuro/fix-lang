import { execFile, spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync, readdirSync, statSync } from "node:fs";
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

/** Stable-channel cask token published by `anhdd-kuro/homebrew-tap`. */
export const STABLE_CASK_TOKEN = "fixlang";
/**
 * Pre-release cask token — a sibling Homebrew cask, not a variant of the
 * stable one. Homebrew has no other mechanism for release channels.
 */
export const BETA_CASK_TOKEN = "fixlang@beta";
/** Kept for callers that only ever meant the stable channel. */
export const CASK_TOKEN = STABLE_CASK_TOKEN;

export type CaskToken = typeof STABLE_CASK_TOKEN | typeof BETA_CASK_TOKEN;

const KNOWN_CASK_TOKENS: ReadonlySet<string> = new Set([
  STABLE_CASK_TOKEN,
  BETA_CASK_TOKEN,
]);

/**
 * Homebrew only ever has these two casks. A pending marker, a renderer
 * channel choice, or brew's own JSON output can all hand this module an
 * arbitrary string, and any of them reaching `path.join` or an argv unchecked
 * would either read the wrong Caskroom or hand Homebrew a token it has never
 * heard of — refuse it here, once, before any path or argv is built.
 */
export const isCaskToken = (value: string): value is CaskToken =>
  KNOWN_CASK_TOKENS.has(value);

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
/** A ~101.6 MiB DMG on a slow link is minutes, not seconds. */
const BREW_FETCH_TIMEOUT_MS = 30 * 60_000;
const BREW_PROBE_MAX_BUFFER = 4 * 1024 * 1024;

export type FileProbe = (candidatePath: string) => boolean;
export type DirectoryLister = (directoryPath: string) => readonly string[];
export type FileSize = (filePath: string) => number | null;
export type DetachedRunner = (script: string, logFilePath: string) => void;
export type BrewRunner = (
  brewBinary: string,
  args: readonly string[],
  timeoutMs?: number,
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

/** An unreadable cache directory just means "nothing downloaded yet". */
const readDirectory: DirectoryLister = (directoryPath) => {
  try {
    return readdirSync(directoryPath);
  } catch {
    return [];
  }
};

const readFileSize: FileSize = (filePath) => {
  try {
    return statSync(filePath).size;
  } catch {
    return null;
  }
};

/** First standard Homebrew binary that exists, or null when brew is absent. */
export const findBrewBinary = (
  fileExists: FileProbe = isExecutableFile,
): string | null =>
  BREW_BINARY_CANDIDATES.find((candidate) => fileExists(candidate)) ?? null;

/** Caskroom root for a known token; callers must have validated it already. */
const caskroomRoot = (brewBinary: string, caskToken: CaskToken): string =>
  path.join(path.dirname(path.dirname(brewBinary)), "Caskroom", caskToken);

/**
 * Caskroom entry Homebrew creates for an installed cask. Null for a token
 * this module does not recognize — never built into a path.
 */
export const caskroomPath = (
  brewBinary: string,
  caskToken: string = STABLE_CASK_TOKEN,
): string | null =>
  isCaskToken(caskToken) ? caskroomRoot(brewBinary, caskToken) : null;

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
  caskToken: string = STABLE_CASK_TOKEN,
): string | null => {
  const root = caskroomPath(brewBinary, caskToken);
  if (root === null) return null;
  return SAFE_VERSION_PATTERN.test(version) && !version.includes("..")
    ? path.join(root, version)
    : null;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Cask version from `brew info --json=v2`, or null for unusable output. */
export const parseCaskVersion = (
  stdout: string,
  caskToken: string = STABLE_CASK_TOKEN,
): string | null => {
  if (!isCaskToken(caskToken)) return null;

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
    (entry) => isRecord(entry) && entry.token === caskToken,
  );
  if (!isRecord(cask) || typeof cask.version !== "string") {
    return null;
  }
  return cask.version;
};

/**
 * Which cask token(s) Homebrew has actually staged, read straight from the
 * Caskroom — two directory probes, no subprocess. Cheap enough to run on
 * every launch, unlike asking `brew info` which needs the tap clone to be
 * current to answer honestly.
 */
export type ActiveCaskChannel = "stable" | "beta" | "both";

export const detectActiveCaskChannel = (
  brewBinary: string,
  directoryExists: FileProbe = isDirectory,
): ActiveCaskChannel | null => {
  const stableInstalled = directoryExists(
    caskroomRoot(brewBinary, STABLE_CASK_TOKEN),
  );
  const betaInstalled = directoryExists(caskroomRoot(brewBinary, BETA_CASK_TOKEN));

  if (stableInstalled && betaInstalled) return "both";
  if (betaInstalled) return "beta";
  if (stableInstalled) return "stable";
  return null;
};

const runBrewCommand: BrewRunner = async (brewBinary, args, timeoutMs) => {
  const { stdout } = await execFileAsync(brewBinary, [...args], {
    env: { ...process.env, ...BREW_ENV },
    timeout: timeoutMs ?? BREW_PROBE_TIMEOUT_MS,
    maxBuffer: BREW_PROBE_MAX_BUFFER,
  });
  return stdout;
};

/**
 * Where Homebrew parks downloads. `HOMEBREW_CACHE` wins when the user set it;
 * otherwise this is the documented macOS default.
 */
export const downloadsCacheDir = (
  env: NodeJS.ProcessEnv = process.env,
): string =>
  path.join(
    env.HOMEBREW_CACHE ?? path.join(env.HOME ?? "", "Library", "Caches", "Homebrew"),
    "downloads",
  );

/**
 * Homebrew names cached downloads `<url-digest>--<basename>`, and appends
 * `.incomplete` until the transfer finishes. The digest is an implementation
 * detail, so match on the basename instead of trying to recompute it.
 */
export const matchCachedDownload = (
  entries: readonly string[],
  version: string,
): string | null => {
  if (!SAFE_VERSION_PATTERN.test(version)) return null;
  const basename = `FixLang-${version}-arm64.dmg`;

  return (
    entries.find((entry) => entry.endsWith(`--${basename}`)) ??
    entries.find((entry) => entry.endsWith(`--${basename}.incomplete`)) ??
    null
  );
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
  refreshTap: boolean,
  caskToken: string,
): Promise<string | null> => {
  // Refused before either brew call: neither a stale tap nor a wasted
  // subprocess is worth spending on a token Homebrew has no cask for.
  if (!isCaskToken(caskToken)) return null;

  if (refreshTap) {
    try {
      await runBrew(brewBinary, ["update", "--quiet"]);
    } catch {
      // A failed refresh only means the answer may be stale; still ask for it.
    }
  }
  try {
    return parseCaskVersion(
      await runBrew(brewBinary, ["info", "--cask", caskToken, "--json=v2"]),
      caskToken,
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
/**
 * Only an absolute `.app` path, with nothing that could end the shell string
 * it is interpolated into. The value comes from `app.getPath("exe")` rather
 * than from any input, but the script is still text handed to `/bin/sh`, so it
 * is checked at the boundary instead of trusted by provenance.
 */
const isSafeBundlePath = (candidate: string): boolean =>
  candidate.startsWith("/") &&
  candidate.endsWith(".app") &&
  // Quoting handles spaces; these characters would escape the quotes. Control
  // characters are rejected by the printable test below rather than by a
  // regex, so nothing rests on how a control escape happens to be spelled.
  !/["`$\\]/.test(candidate) &&
  [...candidate].every((character) => character >= " ");

/**
 * How the helper brings FixLang back.
 *
 * `open -b <bundle id>` is wrong here even though it looks tidier: a stray
 * build of FixLang elsewhere on disk carries the same id, and Homebrew has
 * just deleted and recreated `/Applications/FixLang.app`, so LaunchServices
 * can resolve the id to that other copy and reopen an *older* app. The path
 * Homebrew replaced is unambiguous, so reopen that; the id is only a fallback
 * for when no usable path was recorded.
 */
const buildReopenCommand = (appPath: string | null): string =>
  appPath !== null && isSafeBundlePath(appPath)
    ? `/usr/bin/open -a "${appPath}" || /usr/bin/open -b ${BUNDLE_ID}`
    : `/usr/bin/open -b ${BUNDLE_ID} || /usr/bin/open -a ${PROCESS_NAME}`;

export const buildUpgradeScript = (
  brewBinary: string,
  appPath: string | null = null,
  caskToken: string = STABLE_CASK_TOKEN,
): string => {
  // Refused before it ever becomes argv text handed to `/bin/sh`.
  if (!isCaskToken(caskToken)) {
    throw new Error(`Refusing to build an upgrade script for an unknown cask token: ${caskToken}`);
  }

  return [
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
    // No `brew update` here: the tap probe refreshed it moments ago, and the
    // DMG is already in the download cache. Everything slow happens while the
    // app is still running, so this window stays a few seconds instead of a
    // minute — which is how long the user is staring at a vanished app.
    `"${brewBinary}" upgrade --cask ${caskToken} || exit 1`,
    buildReopenCommand(appPath),
  ].join("\n");
};

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
  /** Which cask this upgrader manages; defaults to the stable channel. */
  caskToken?: CaskToken;
  fileExists?: FileProbe;
  directoryExists?: FileProbe;
  listDirectory?: DirectoryLister;
  fileSize?: FileSize;
  cacheDir?: string;
  startDetached?: DetachedRunner;
  runBrew?: BrewRunner;
}>;

export type HomebrewUpgrader = Readonly<{
  /** True when a one-click upgrade is actually possible for this install. */
  canInstall: boolean;
  /**
   * Version the tap can install now; null when brew could not be asked.
   *
   * `refreshTap` runs `brew update` first. That is a git fetch across every
   * tap, so routine checks read the local clone as-is and only pay for a
   * refresh when something suggests it went stale.
   *
   * `caskToken` defaults to the token this upgrader was created for; an
   * unrecognized override resolves to null without asking brew anything.
   */
  getInstallableVersion: (
    refreshTap?: boolean,
    caskToken?: string,
  ) => Promise<string | null>;
  /** True once Homebrew has staged that version in the Caskroom. */
  isVersionInstalled: (version: string, caskToken?: string) => boolean;
  /**
   * Downloads the DMG without touching the installed bundle, so the slow part
   * of an upgrade happens while the app is still running. Rejects on failure,
   * including for a cask token this module does not recognize.
   */
  downloadUpdate: (caskToken?: string) => Promise<void>;
  /** Bytes cached for that version so far; null when nothing is cached yet. */
  getDownloadedBytes: (version: string, caskToken?: string) => number | null;
  /**
   * Launches the detached upgrade helper. Throws when it cannot start,
   * including for a cask token this module does not recognize.
   *
   * `appPath` is the `.app` root to reopen once Homebrew is done — the bundle
   * it replaced. Omit it only when the path is unknown; the helper then falls
   * back to the bundle id, which can resolve to a different copy of FixLang.
   */
  startUpgrade: (appPath?: string | null, caskToken?: string) => void;
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
  const listDirectory = options.listDirectory ?? readDirectory;
  const fileSize = options.fileSize ?? readFileSize;
  const cacheDir = options.cacheDir ?? downloadsCacheDir();
  const startDetached = options.startDetached ?? runDetached;
  const runBrew = options.runBrew ?? runBrewCommand;
  const boundCaskToken: CaskToken = options.caskToken ?? STABLE_CASK_TOKEN;

  const brewBinary = options.isInstalledApp ? findBrewBinary(fileExists) : null;
  const canInstall =
    brewBinary !== null && directoryExists(caskroomRoot(brewBinary, boundCaskToken));

  return Object.freeze({
    canInstall,
    getInstallableVersion: (
      refreshTap = true,
      caskToken: string = boundCaskToken,
    ): Promise<string | null> =>
      canInstall && brewBinary !== null
        ? readInstallableVersion(brewBinary, runBrew, refreshTap, caskToken)
        : Promise.resolve(null),
    isVersionInstalled: (
      version: string,
      caskToken: string = boundCaskToken,
    ): boolean => {
      if (brewBinary === null) return false;
      const versionPath = caskVersionPath(brewBinary, version, caskToken);
      return versionPath !== null && directoryExists(versionPath);
    },
    downloadUpdate: async (caskToken: string = boundCaskToken): Promise<void> => {
      if (!canInstall || brewBinary === null) {
        throw new Error("FixLang was not installed with the Homebrew cask");
      }
      // Refused before the argv is built, same as every other probe here.
      if (!isCaskToken(caskToken)) {
        throw new Error(`Refusing to fetch an unknown cask token: ${caskToken}`);
      }
      // `fetch` only fills the download cache — the installed bundle is
      // untouched, so this is safe to run with the app still open.
      await runBrew(
        brewBinary,
        ["fetch", "--cask", caskToken],
        BREW_FETCH_TIMEOUT_MS,
      );
    },
    getDownloadedBytes: (
      version: string,
      caskToken: string = boundCaskToken,
    ): number | null => {
      if (!isCaskToken(caskToken)) return null;
      const entry = matchCachedDownload(listDirectory(cacheDir), version);
      return entry === null ? null : fileSize(path.join(cacheDir, entry));
    },
    startUpgrade: (
      appPath: string | null = null,
      caskToken: string = boundCaskToken,
    ): void => {
      if (!canInstall || brewBinary === null) {
        throw new Error("FixLang was not installed with the Homebrew cask");
      }
      startDetached(
        buildUpgradeScript(brewBinary, appPath, caskToken),
        options.logFilePath,
      );
    },
  });
};
