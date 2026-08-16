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

/**
 * Deliberately not a member of {@link HomebrewUpgrader}: this is the primitive
 * a caller composes with {@link findBrewBinary} — `detectActiveCaskChannel(
 * findBrewBinary(fileExists))` — to learn which token to bind BEFORE
 * constructing the upgrader. Neither growing the interface to expose this
 * (and the `brewBinary` this module resolves internally) nor resolving the
 * channel entirely outside it has been decided yet; both functions are
 * exported top-level today so either shape stays reachable without this
 * module pre-empting that call.
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
 * Nothing that could end, or reach outside, the double-quoted shell string the
 * value is interpolated into. The script is text handed to `/bin/sh`, so every
 * value that reaches it is checked at the boundary instead of trusted by
 * provenance — including the ones that come from this process rather than from
 * any input.
 *
 * Quoting handles spaces; these characters would escape the quotes. Control
 * characters are rejected by the printable test rather than by a regex, so
 * nothing rests on how a control escape happens to be spelled.
 */
const isSafeDoubleQuotedText = (candidate: string): boolean =>
  !/["`$\\]/.test(candidate) && [...candidate].every((character) => character >= " ");

const isSafeShellPath = (candidate: string): boolean =>
  candidate.startsWith("/") && isSafeDoubleQuotedText(candidate);

const isSafeBundlePath = (candidate: string): boolean =>
  isSafeShellPath(candidate) && candidate.endsWith(".app");

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

/**
 * The reopen has to be reachable from a trap, and a trap body is quoted shell
 * text — so spelling the command inside the trap would make the trap the one
 * place a bundle path's own quoting could escape. A function makes the trap
 * argument a single bare word instead.
 */
const REOPEN_FUNCTION_NAME = "reopen_fixlang";

/**
 * The one exit the EXIT trap must NOT reopen through.
 *
 * A signal kills the helper shell, but it does not kill the `brew` child the
 * shell was waiting on — that child keeps running, orphaned, and finishes
 * replacing `/Applications/FixLang.app` seconds later. Reopening on the way
 * out therefore launches the app into the middle of the bundle swap, which is
 * exactly the corruption the wait loop above exists to prevent; inside the
 * channel switch's no-app window it is worse still, because the reopen falls
 * through to the bundle id and LaunchServices starts some other copy that brew
 * then overwrites underneath.
 *
 * So the signal handler disarms the EXIT trap before exiting. Leaving the app
 * closed after a signal is the same outcome the user got before any trap
 * existed, and it is the one the machine can recover from: the bundle ends up
 * whole and one double-click away.
 *
 * Spelled as a function for the same reason the reopen is — `trap` takes
 * quoted shell text, so a bare word is the only argument shape with no quoting
 * of its own to get wrong.
 */
const SIGNAL_ABORT_FUNCTION_NAME = "abort_without_reopen";

/** POSIX-named, so `/bin/sh` needs no signal-number table to agree with us. */
const ABORTING_SIGNALS = "HUP INT TERM";

/**
 * The helper log is the only channel left once the app has quit, so the one
 * exit that leaves FixLang closed has to say so — otherwise the user meets a
 * missing app and a log that stops mid-sentence.
 */
const SIGNAL_ABORT_MESSAGE =
  "Interrupted while Homebrew was working; leaving FixLang closed because its bundle may be half-replaced. Reopen it once Homebrew has finished.";

type HelperScriptParts = {
  readonly brewBinary: string;
  readonly appPath: string | null;
  readonly quitTimeoutMessage: string;
  /** The brew verbs, and only those — everything else is identical. */
  readonly steps: readonly string[];
};

/**
 * Every helper this module builds runs detached, after the app has quit, and
 * shares the same three obligations around whatever brew verbs it carries:
 * run Homebrew non-interactively, refuse to touch the bundle while FixLang is
 * still running, and bring the app back afterwards.
 *
 * The third one is the reason this is a shared function rather than two
 * similar string literals. `... || exit 1` reads like a safe abort, but every
 * line below the wait loop executes with the user's app already gone from the
 * screen, so an abort that skips the reopen strands them — and a builder that
 * spells the reopen at the end of the success path invites exactly that
 * mistake once per author. `trap` states the invariant once, structurally:
 * after the app has quit, every exit path the shell can *choose* reopens it,
 * including one nobody anticipated — with the single deliberate exception the
 * shell does not choose, {@link SIGNAL_ABORT_FUNCTION_NAME}.
 */
const buildHelperScript = ({
  brewBinary,
  appPath,
  quitTimeoutMessage,
  steps,
}: HelperScriptParts): string => {
  // Refused before it ever becomes argv text handed to `/bin/sh`. The tokens
  // and the bundle path are both checked at this boundary; the brew path is
  // no different for coming from a filesystem probe, and the helper it lands
  // in is detached and already allowed to uninstall an application.
  if (!isSafeShellPath(brewBinary)) {
    throw new Error(
      `Refusing to build a helper script around an unsafe brew path: ${brewBinary}`,
    );
  }
  // The message lands inside `echo "..."`, which runs command substitution and
  // expands variables exactly like every other double-quoted string in this
  // text. Today both call sites pass a literal built from a numeric constant,
  // so this refuses nothing — which is the point of checking it here rather
  // than trusting that the day it comes from a catalog or a profile somebody
  // remembers to look.
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
    // Deliberately no reopen: this abort fires BECAUSE the app never quit,
    // so there is nothing to bring back.
    "    exit 1",
    "  fi",
    "  /bin/sleep 1",
    "  waited=$((waited + 1))",
    "done",
    // Past this line the app is gone from the user's screen. The trap is what
    // makes "then reopen it" true of every exit below, rather than of only
    // the paths whose author remembered.
    `trap ${REOPEN_FUNCTION_NAME} EXIT`,
    // Armed together with it, and only here: below this line there is a brew
    // child that outlives a signal to the shell, so the one exit that must
    // NOT reopen becomes possible at exactly the same line as the ones that
    // must. Above it, a signal already reopens nothing — no trap is set yet.
    `trap ${SIGNAL_ABORT_FUNCTION_NAME} ${ABORTING_SIGNALS}`,
    ...steps,
  ].join("\n");
};

export const buildUpgradeScript = (
  brewBinary: string,
  appPath: string | null = null,
  caskToken: string = STABLE_CASK_TOKEN,
): string => {
  // Refused before it ever becomes argv text handed to `/bin/sh`.
  if (!isCaskToken(caskToken)) {
    throw new Error(`Refusing to build an upgrade script for an unknown cask token: ${caskToken}`);
  }

  return buildHelperScript({
    brewBinary,
    appPath,
    quitTimeoutMessage: `FixLang did not quit within ${QUIT_TIMEOUT_SECONDS}s; upgrade aborted.`,
    steps: [
      // No `brew update` here: the tap probe refreshed it moments ago, and the
      // DMG is already in the download cache. Everything slow happens while the
      // app is still running, so this window stays a few seconds instead of a
      // minute — which is how long the user is staring at a vanished app.
      //
      // A failed upgrade still reaches the trap, so the app the helper made
      // quit comes back on the version it was already running.
      `"${brewBinary}" upgrade --cask ${caskToken} || exit 1`,
    ],
  });
};

/**
 * A channel switch is not an upgrade: the two cask tokens conflict on the
 * same `/Applications/FixLang.app` path, and Homebrew cask has no downgrade.
 * The only path from one token to the other is uninstall-then-install, and
 * the order below is the entire correctness story:
 *
 * - Installing before uninstalling fails outright — the bundle path is
 *   already occupied by the current token's cask.
 * - Uninstalling after installing would delete the NEWLY installed app,
 *   because cask uninstall removes artifacts by path, not by identity.
 *
 * Between the uninstall and the install there is a window with no app at all
 * in `/Applications`. One retry absorbs a transient failure there (a flaky
 * mirror, a momentary disk hiccup); if that also fails, the ORIGINAL token is
 * reinstalled so a failed switch leaves the user where they started rather
 * than with nothing.
 *
 * Every step that can fail *after* that window opens ends by putting some
 * FixLang back, because a helper that aborts here aborts with the user's app
 * already gone from the screen and nothing left running to report through:
 * a failed uninstall reinstalls the current token, a failed restore falls
 * back to the target (at that point the choice is "some FixLang" versus
 * "none", not "which channel"), and a failure of that last attempt writes
 * the one `brew install` line that gets the user back. The reopen itself is
 * a `trap` installed by {@link buildHelperScript}, so it is not something
 * this ladder has to remember at each rung.
 *
 * The helper log is the only report the user ever sees, so every rung that
 * ends the script names its own outcome rather than leaving it to be inferred
 * from which line came last. That includes the good surprise: when the
 * rollback fails and the last-resort install then works, the user is on the
 * channel they asked for, and the script says so and exits 0.
 */
export const buildChannelSwitchScript = (
  brewBinary: string,
  currentToken: string,
  targetToken: string,
  appPath: string | null = null,
): string => {
  // Refused before either becomes argv text handed to `/bin/sh`.
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
      // Fills the download cache for the TARGET while the current cask is
      // still installed, so a failed fetch leaves the user exactly where they
      // started — no uninstall has happened yet, and the trap brings the app
      // back.
      `"${brewBinary}" fetch --cask ${targetToken} || exit 1`,
      // ...and for the ORIGINAL too, because the rollback below is the one
      // step that only ever runs when something has already gone wrong.
      // Staging it here makes the restore cache-only, so a switch that fails
      // BECAUSE the network died can still put the user back. Best effort on
      // purpose: a rollback download that is no longer reachable must not
      // block a switch that would otherwise work.
      `"${brewBinary}" fetch --cask ${currentToken} || echo "Could not pre-stage the ${currentToken} download; restoring it after a failed switch may need the network." >&2`,
      // The bundle path only frees up once the CURRENT token's cask is gone —
      // installing first would fail outright with "already exists".
      `if ! "${brewBinary}" uninstall --cask ${currentToken}; then`,
      // Not a bare abort: a cask uninstall that fails partway can already
      // have deleted the bundle, so the honest recovery is to put back the
      // cask the user asked us to leave alone rather than to walk away from
      // an empty /Applications.
      `  echo "Failed to uninstall ${currentToken}; abandoning the switch to ${targetToken}." >&2`,
      `  "${brewBinary}" install --cask ${currentToken} || echo "Could not reinstall ${currentToken}. If FixLang is missing, recover with: brew install --cask ${currentToken}" >&2`,
      "  exit 1",
      "fi",
      // No app exists in /Applications between this line and a successful
      // install below. One retry covers a transient failure without
      // immediately giving up on the switch.
      `if ! "${brewBinary}" install --cask ${targetToken}; then`,
      `  if ! "${brewBinary}" install --cask ${targetToken}; then`,
      `    echo "Failed to install ${targetToken} after a retry; restoring ${currentToken}." >&2`,
      // Restore the ORIGINAL token, never the target, in THIS position:
      // naming the target here would just retry the thing that already failed
      // twice while the user is still on neither channel.
      `    if "${brewBinary}" install --cask ${currentToken}; then`,
      // The rollback worked, so the switch itself did not: the user is back on
      // the channel they started from, which is a failed switch and says so.
      `      echo "Restored ${currentToken}; the switch to ${targetToken} did not happen." >&2`,
      "      exit 1",
      "    fi",
      // Once the rollback itself has failed the choice is no longer "the
      // channel they asked for" versus "the one they had" — it is "some
      // FixLang" versus "none". The target gets one last attempt in the only
      // position where it is the sole remaining candidate, and its own DMG is
      // already cached from the fetch above.
      `    echo "Failed to restore ${currentToken}; trying ${targetToken} once more." >&2`,
      `    if ! "${brewBinary}" install --cask ${targetToken}; then`,
      // Nothing is installed and nothing is left running to report through, so
      // this line is the whole of the user's recovery. It names the TARGET:
      // that is the channel they asked for, its DMG is the one still cached,
      // and on a revert naming the current token would hand somebody who just
      // asked to leave the pre-release the pre-release as their only
      // instruction.
      `      echo "FixLang is no longer installed. Recover with: brew install --cask ${targetToken}" >&2`,
      "      exit 1",
      "    fi",
      // The last resort landed. The user IS on the channel they asked for, so
      // this exits 0 like any other successful switch — an outcome that is
      // reported only by the ABSENCE of a further line is one nobody reads
      // correctly.
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
  /**
   * Bytes cached for that version so far; null when nothing is cached yet.
   *
   * `caskToken` only gates validation here (an unrecognized token still
   * returns null) — the lookup itself is `matchCachedDownload`, which keys
   * purely on `version`. Homebrew names a cached DMG
   * `<digest>--FixLang-<version>-arm64.dmg` with no channel marker in the
   * basename, and that is safe only because a stable version string and a
   * beta one are never equal (betas always carry a `-beta.N` suffix). If a
   * caller ever threads the wrong (but still valid) token for a version that
   * collided across channels, this would attribute cached bytes to the wrong
   * channel with nothing here to catch it.
   */
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
  // Routed through `caskroomPath` (which calls `isCaskToken` first) rather
  // than the raw `caskroomRoot` — `boundCaskToken`'s `CaskToken` type is only
  // a compile-time promise, and a value that reaches here already cast (a
  // persisted marker, a renderer channel choice) is not guaranteed to satisfy
  // it. An unrecognized token must be refused here exactly like every other
  // accessor below, not walked straight into `path.join`: `caskroomRoot`
  // normalizes something like "../../../../Applications" to "/Applications"
  // and would report `canInstall` off of whatever happens to live there.
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
      if (brewBinary === null) {
        throw new Error("FixLang was not installed with the Homebrew cask");
      }
      // `canInstall` only answers for the BOUND token. A per-call override
      // must be checked against ITS OWN Caskroom entry — otherwise a
      // beta-bound upgrader's stale (and true) `canInstall` could wave
      // through a request to upgrade the stable token with no stable
      // Caskroom entry at all. That would spawn the detached helper anyway,
      // and `buildUpgradeScript`'s `upgrade --cask ... || exit 1` would then
      // fail AFTER the app has already quit. The helper's EXIT trap now
      // reopens the app on that path, but the user would still have watched
      // their app vanish for an upgrade that could never have run.
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
