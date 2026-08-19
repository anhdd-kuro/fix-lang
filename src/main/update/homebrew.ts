import { execFile, spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Never resolved from PATH: a GUI Electron process inherits a minimal
 * environment, and an attacker-controlled PATH entry must never decide which
 * binary runs an upgrade.
 */
export const BREW_BINARY_CANDIDATES = Object.freeze([
  "/opt/homebrew/bin/brew",
  "/usr/local/bin/brew",
] as const);

/** Stable-channel cask token published by `anhdd-kuro/homebrew-tap`. */
export const STABLE_CASK_TOKEN = "fixlang";
/**
 * A sibling Homebrew cask, not a variant — Homebrew has no other mechanism
 * for release channels.
 */
export const BETA_CASK_TOKEN = "fixlang@beta";
/** Legacy spelling of the stable token, not a third channel. */
export const CASK_TOKEN = STABLE_CASK_TOKEN;

export type CaskToken = typeof STABLE_CASK_TOKEN | typeof BETA_CASK_TOKEN;

const KNOWN_CASK_TOKENS: ReadonlySet<string> = new Set([
  STABLE_CASK_TOKEN,
  BETA_CASK_TOKEN,
]);

/**
 * A pending marker, a renderer channel choice, or brew's own JSON output can
 * all hand this module an arbitrary string. Refuse it once, here, before any
 * path or argv is built.
 */
export const isCaskToken = (value: string): value is CaskToken =>
  KNOWN_CASK_TOKENS.has(value);

const BUNDLE_ID = "com.fixlang.app";
const PROCESS_NAME = "FixLang";
const QUIT_TIMEOUT_SECONDS = 30;

/**
 * NONINTERACTIVE makes Homebrew fail rather than block on a hidden prompt;
 * auto-update is off because the probe refreshes the tap explicitly.
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

export const findBrewBinary = (
  fileExists: FileProbe = isExecutableFile,
): string | null =>
  BREW_BINARY_CANDIDATES.find((candidate) => fileExists(candidate)) ?? null;

/** Caskroom root for a known token; callers must have validated it already. */
const caskroomRoot = (brewBinary: string, caskToken: CaskToken): string =>
  path.join(path.dirname(path.dirname(brewBinary)), "Caskroom", caskToken);

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
 * and still true after the helper has exited.
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

export type ActiveCaskChannel = "stable" | "beta" | "both";

/**
 * Composed by the caller with {@link findBrewBinary} rather than exposed as an
 * upgrader method, so the channel is known BEFORE the upgrader is built.
 */
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

export const downloadsCacheDir = (
  env: NodeJS.ProcessEnv = process.env,
): string =>
  path.join(
    env.HOMEBREW_CACHE ?? path.join(env.HOME ?? "", "Library", "Caches", "Homebrew"),
    "downloads",
  );

/**
 * Homebrew names cached downloads `<url-digest>--<basename>` and appends
 * `.incomplete` until the transfer finishes. The digest is an implementation
 * detail, so match on the basename.
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
 * `brew update` runs first because the local tap clone lags the published
 * GitHub release: the app can see a release the cask cannot install yet, and
 * `brew upgrade` treats that as a no-op success. Null means "unknown", never
 * "too old", so a flaky probe cannot block a working install.
 */
const readInstallableVersion = async (
  brewBinary: string,
  runBrew: BrewRunner,
  refreshTap: boolean,
  caskToken: string,
): Promise<string | null> => {
  // Refused before either brew call.
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
 * Nothing that could end, or reach outside, the double-quoted shell string the
 * value is interpolated into. Control characters are rejected by a printable
 * test rather than a regex, so nothing rests on how an escape is spelled.
 */
const isSafeDoubleQuotedText = (candidate: string): boolean =>
  !/["`$\\]/.test(candidate) && [...candidate].every((character) => character >= " ");

const isSafeShellPath = (candidate: string): boolean =>
  candidate.startsWith("/") && isSafeDoubleQuotedText(candidate);

const isSafeBundlePath = (candidate: string): boolean =>
  isSafeShellPath(candidate) && candidate.endsWith(".app");

/**
 * `open -b <bundle id>` is wrong here: a stray build of FixLang carries the
 * same id, and Homebrew has just deleted and recreated
 * `/Applications/FixLang.app`, so LaunchServices can resolve the id to that
 * copy and reopen an OLDER app. The id is only a fallback.
 */
const buildReopenCommand = (appPath: string | null): string =>
  appPath !== null && isSafeBundlePath(appPath)
    ? `/usr/bin/open -a "${appPath}" || /usr/bin/open -b ${BUNDLE_ID}`
    : `/usr/bin/open -b ${BUNDLE_ID} || /usr/bin/open -a ${PROCESS_NAME}`;

/**
 * `trap` takes quoted shell text, so a function name keeps a bundle path's own
 * quoting out of the trap argument.
 */
const REOPEN_FUNCTION_NAME = "reopen_fixlang";

/**
 * The one exit the EXIT trap must NOT reopen through. A signal kills the
 * helper shell but not the `brew` child it was waiting on, and that child
 * finishes replacing `/Applications/FixLang.app` seconds later — reopening on
 * the way out would launch the app into the middle of the bundle swap.
 */
const SIGNAL_ABORT_FUNCTION_NAME = "abort_without_reopen";

/** POSIX-named, so `/bin/sh` needs no signal-number table to agree with us. */
const ABORTING_SIGNALS = "HUP INT TERM";

const SIGNAL_ABORT_MESSAGE =
  "Interrupted while Homebrew was working; leaving FixLang closed because its bundle may be half-replaced. Reopen it once Homebrew has finished.";

type HelperScriptParts = {
  readonly brewBinary: string;
  readonly appPath: string | null;
  readonly quitTimeoutMessage: string;
  readonly steps: readonly string[];
};

/**
 * Every helper runs detached, after the app has quit, so each shares the same
 * obligations around its brew verbs: run Homebrew non-interactively, refuse to
 * touch the bundle while FixLang still runs, and bring the app back. `trap`
 * states that last one structurally — every exit path the shell can CHOOSE
 * reopens the app, bar {@link SIGNAL_ABORT_FUNCTION_NAME}.
 */
const buildHelperScript = ({
  brewBinary,
  appPath,
  quitTimeoutMessage,
  steps,
}: HelperScriptParts): string => {
  // Refused before it becomes argv text handed to `/bin/sh`.
  if (!isSafeShellPath(brewBinary)) {
    throw new Error(
      `Refusing to build a helper script around an unsafe brew path: ${brewBinary}`,
    );
  }
  // The message lands inside `echo "..."`, which substitutes and expands.
  if (!isSafeDoubleQuotedText(quitTimeoutMessage)) {
    throw new Error(
      `Refusing to build a helper script around an unsafe quit-timeout message: ${quitTimeoutMessage}`,
    );
  }

  return [
    "set -u",
    "export NONINTERACTIVE=1",
    "export HOMEBREW_NO_ENV_HINTS=1",
    `${REOPEN_FUNCTION_NAME}() {`,
    `  ${buildReopenCommand(appPath)}`,
    "}",
    `${SIGNAL_ABORT_FUNCTION_NAME}() {`,
    // Disarm before exiting, or this handler's own `exit` runs the EXIT trap
    // and reopens the app anyway — the whole point of the handler.
    "  trap - EXIT",
    `  echo "${SIGNAL_ABORT_MESSAGE}" >&2`,
    "  exit 1",
    "}",
    "waited=0",
    `while /usr/bin/pgrep -x ${PROCESS_NAME} >/dev/null 2>&1; do`,
    `  if [ "$waited" -ge ${QUIT_TIMEOUT_SECONDS} ]; then`,
    `    echo "${quitTimeoutMessage}" >&2`,
    // Deliberately no reopen: this abort fires BECAUSE the app never quit.
    "    exit 1",
    "  fi",
    "  /bin/sleep 1",
    "  waited=$((waited + 1))",
    "done",
    // Past this line the app is gone from the user's screen.
    `trap ${REOPEN_FUNCTION_NAME} EXIT`,
    // Armed here and not earlier: below this line a brew child outlives a
    // signal to the shell.
    `trap ${SIGNAL_ABORT_FUNCTION_NAME} ${ABORTING_SIGNALS}`,
    ...steps,
  ].join("\n");
};

export const buildUpgradeScript = (
  brewBinary: string,
  appPath: string | null = null,
  caskToken: string = STABLE_CASK_TOKEN,
): string => {
  if (!isCaskToken(caskToken)) {
    throw new Error(`Refusing to build an upgrade script for an unknown cask token: ${caskToken}`);
  }

  return buildHelperScript({
    brewBinary,
    appPath,
    quitTimeoutMessage: `FixLang did not quit within ${QUIT_TIMEOUT_SECONDS}s; upgrade aborted.`,
    steps: [
      // No `brew update`: the tap probe refreshed it moments ago and the DMG is
      // already cached, so this window stays seconds rather than a minute.
      `"${brewBinary}" upgrade --cask ${caskToken} || exit 1`,
    ],
  });
};

/**
 * A channel switch is not an upgrade: the two cask tokens conflict on the same
 * `/Applications/FixLang.app` path, and Homebrew cask has no downgrade. The
 * only path from one token to the other is uninstall-then-install, and the
 * ORDER below is the entire correctness story — installing first fails on the
 * occupied bundle path, and uninstalling last would delete the NEWLY installed
 * app, because cask uninstall removes artifacts by PATH, not by identity.
 *
 * Between the two there is a window with no app at all in `/Applications`, so
 * every step that can fail after it opens ends by putting some FixLang back,
 * and names its own outcome in the helper log — the user's only report.
 */
export const buildChannelSwitchScript = (
  brewBinary: string,
  currentToken: string,
  targetToken: string,
  appPath: string | null = null,
): string => {
  if (!isCaskToken(currentToken)) {
    throw new Error(
      `Refusing to build a channel-switch script for an unknown current cask token: ${currentToken}`,
    );
  }
  if (!isCaskToken(targetToken)) {
    throw new Error(
      `Refusing to build a channel-switch script for an unknown target cask token: ${targetToken}`,
    );
  }
  if (currentToken === targetToken) {
    throw new Error(
      "Refusing to build a channel-switch script that switches a cask token to itself",
    );
  }

  return buildHelperScript({
    brewBinary,
    appPath,
    quitTimeoutMessage: `FixLang did not quit within ${QUIT_TIMEOUT_SECONDS}s; channel switch aborted.`,
    steps: [
      // Fetch BEFORE any uninstall: a failed fetch then leaves the user exactly
      // where they started, with the current cask still installed.
      `"${brewBinary}" fetch --cask ${targetToken} || exit 1`,
      // ...and for the ORIGINAL too, so the rollback below is cache-only. Best
      // effort: an unreachable rollback DMG must not block a working switch.
      `"${brewBinary}" fetch --cask ${currentToken} || echo "Could not pre-stage the ${currentToken} download; restoring it after a failed switch may need the network." >&2`,
      // The bundle path only frees up once the CURRENT token's cask is gone.
      `if ! "${brewBinary}" uninstall --cask ${currentToken}; then`,
      // A partway-failed uninstall can already have deleted the bundle.
      `  echo "Failed to uninstall ${currentToken}; abandoning the switch to ${targetToken}." >&2`,
      `  "${brewBinary}" install --cask ${currentToken} || echo "Could not reinstall ${currentToken}. If FixLang is missing, recover with: brew install --cask ${currentToken}" >&2`,
      "  exit 1",
      "fi",
      // No app exists in /Applications until the install below succeeds.
      `if ! "${brewBinary}" install --cask ${targetToken}; then`,
      `  if ! "${brewBinary}" install --cask ${targetToken}; then`,
      `    echo "Failed to install ${targetToken} after a retry; restoring ${currentToken}." >&2`,
      // The ORIGINAL token: naming the target retries what just failed twice.
      `    if "${brewBinary}" install --cask ${currentToken}; then`,
      // The rollback worked, so the switch did not; say which happened.
      `      echo "Restored ${currentToken}; the switch to ${targetToken} did not happen." >&2`,
      "      exit 1",
      "    fi",
      // Once the rollback has failed it is "some FixLang" versus "none".
      `    echo "Failed to restore ${currentToken}; trying ${targetToken} once more." >&2`,
      `    if ! "${brewBinary}" install --cask ${targetToken}; then`,
      // Nothing is installed and nothing is left running to report through, so
      // this line is the user's whole recovery. It names the TARGET, because on
      // a revert the current token is the pre-release they asked to leave.
      `      echo "FixLang is no longer installed. Recover with: brew install --cask ${targetToken}" >&2`,
      "      exit 1",
      "    fi",
      // The last resort landed, so this exits 0 and says so.
      `    echo "Restoring ${currentToken} failed, but ${targetToken} installed on the last attempt; FixLang is on the ${targetToken} channel." >&2`,
      "  fi",
      "fi",
    ],
  });
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
  canInstall: boolean;
  /**
   * Null when brew could not be asked. `refreshTap` runs `brew update` first,
   * which is a git fetch across EVERY tap, so routine checks read the local
   * clone as-is.
   */
  getInstallableVersion: (
    refreshTap?: boolean,
    caskToken?: string,
  ) => Promise<string | null>;
  isVersionInstalled: (version: string, caskToken?: string) => boolean;
  downloadUpdate: (caskToken?: string) => Promise<void>;
  /**
   * `caskToken` only gates validation — the lookup keys purely on `version`,
   * because Homebrew's cached DMG name carries no channel marker. Safe only
   * because a stable version string and a beta one are never equal.
   */
  getDownloadedBytes: (version: string, caskToken?: string) => number | null;
  /**
   * `appPath` is the bundle to reopen once Homebrew is done. Omit it only when
   * unknown; the helper then falls back to the bundle id, which can resolve to
   * a different copy of FixLang.
   */
  startUpgrade: (appPath?: string | null, caskToken?: string) => void;
}>;

/**
 * One-click updates only apply to the Homebrew cask install — the one
 * distribution path that can replace the bundle without automating Gatekeeper.
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
  // Routed through `caskroomPath`, not the raw `caskroomRoot`: `CaskToken` is
  // only a compile-time promise, and `caskroomRoot` would normalize
  // "../../../../Applications" to "/Applications" and probe whatever lives there.
  const boundCaskroomPath =
    brewBinary !== null ? caskroomPath(brewBinary, boundCaskToken) : null;
  const canInstall = boundCaskroomPath !== null && directoryExists(boundCaskroomPath);

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
      if (!isCaskToken(caskToken)) {
        throw new Error(`Refusing to fetch an unknown cask token: ${caskToken}`);
      }
      // `fetch` fills the download cache only, so it is safe with the app open.
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
      if (brewBinary === null) {
        throw new Error("FixLang was not installed with the Homebrew cask");
      }
      // `canInstall` only answers for the BOUND token, so a per-call override is
      // checked against ITS OWN Caskroom entry — otherwise a beta-bound
      // upgrader would spawn a helper for a stable upgrade that cannot run.
      const targetCaskroomPath = caskroomPath(brewBinary, caskToken);
      if (targetCaskroomPath === null || !directoryExists(targetCaskroomPath)) {
        throw new Error("FixLang was not installed with the Homebrew cask");
      }
      startDetached(
        buildUpgradeScript(brewBinary, appPath, caskToken),
        options.logFilePath,
      );
    },
  });
};
