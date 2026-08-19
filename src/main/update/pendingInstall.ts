import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  BETA_CASK_TOKEN,
  isCaskToken,
  STABLE_CASK_TOKEN,
  type CaskToken,
} from "./homebrew";
import { parsePrereleaseVersion } from "./prereleaseVersion";

/**
 * The Homebrew upgrade finishes after the app has quit, so a marker written
 * before quitting and read on the next launch is the only way to report it.
 */

export type { CaskToken };

/**
 * Also the migration default for markers written before the token field
 * existed, which is the right answer for them: every upgrade before
 * pre-release was stable-to-stable.
 */
export { STABLE_CASK_TOKEN };

export type PendingInstall = Readonly<{
  fromVersion: string;
  toVersion: string;
  /** Epoch ms the helper was started; 0 for markers written before this field. */
  startedAt: number;
  /**
   * The exact bundle Homebrew replaces. Empty for markers that predate the
   * field. Tells "the upgrade landed" from "another copy of the app opened".
   */
  appPath: string;
  /**
   * The token TARGETED — the stable one for a revert, so this field alone
   * never says which channel the app came from.
   */
  caskToken: CaskToken;
  /**
   * The cask a failed channel switch reinstalls when it rolls back. Optional
   * because markers on disk predate it; {@link sourceCaskToken} then recovers
   * it from `fromVersion`. Without either, a rollback reads as success.
   */
  fromCaskToken?: CaskToken;
}>;

export type PendingInstallStore = Readonly<{
  read: () => PendingInstall | null;
  write: (pending: PendingInstall) => void;
  clear: () => void;
}>;

export type InstallOutcome =
  | "none"
  | "installed"
  | "restart-required"
  | "wrong-bundle"
  | "in-progress"
  /**
   * A switch or revert that ended back on the channel it started from: the
   * install failed and the helper reinstalled the source cask, at that
   * channel's CURRENT version — so the version moved without the operation
   * succeeding. Reports as unfinished, never as an update.
   */
  | "rolled-back"
  | "failed";

type VersionInstalledResolver = (
  version: string,
  caskToken: CaskToken,
) => boolean;

type ReconcileContextBase = Readonly<{
  now: number;
  /** `.app` root of the process doing the reconcile; null when unknown. */
  runningAppPath: string | null;
}>;

/**
 * Exactly one of these two, never neither. Pass `isVersionInstalled`: the
 * probe must aim at `pending.caskToken`'s own Caskroom, and a pre-resolved
 * boolean records neither the version nor the token the caller used.
 * Drop `isTargetInstalled` once every call site passes the resolver.
 */
export type ReconcileContext = ReconcileContextBase &
  (
    | Readonly<{
        isVersionInstalled: VersionInstalledResolver;
        isTargetInstalled?: boolean;
      }>
    | Readonly<{
        isVersionInstalled?: undefined;
        isTargetInstalled: boolean;
      }>
  );

/**
 * How long the detached helper may still be working before an unchanged
 * version counts as a failure: a ~101.6 MiB download is minutes, not seconds.
 */
export const UPGRADE_GRACE_MS = 20 * 60_000;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Missing or nonsensical timestamps read as "long ago", never as "just now". */
const parseStartedAt = (value: unknown): number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : 0;

/**
 * Missing, corrupt, or foreign values fall back to the stable token rather
 * than rejecting the marker: a real marker on disk predates this field.
 */
const parseCaskToken = (value: unknown): CaskToken =>
  typeof value === "string" && isCaskToken(value) ? value : STABLE_CASK_TOKEN;

/**
 * The source token has no safe default: guessing "stable" asserts the app
 * started there, which is what turns a rolled-back revert into a success.
 */
const parseOptionalCaskToken = (value: unknown): CaskToken | undefined =>
  typeof value === "string" && isCaskToken(value) ? value : undefined;

/** Parses the marker defensively; a corrupt file must never break startup. */
export const parsePendingInstall = (raw: string): PendingInstall | null => {
  try {
    const value: unknown = JSON.parse(raw);
    if (
      !isRecord(value) ||
      typeof value.fromVersion !== "string" ||
      typeof value.toVersion !== "string" ||
      value.fromVersion.length === 0 ||
      value.toVersion.length === 0
    ) {
      return null;
    }
    return Object.freeze({
      fromVersion: value.fromVersion,
      toVersion: value.toVersion,
      startedAt: parseStartedAt(value.startedAt),
      appPath: typeof value.appPath === "string" ? value.appPath : "",
      caskToken: parseCaskToken(value.caskToken),
      fromCaskToken: parseOptionalCaskToken(value.fromCaskToken),
    });
  } catch {
    return null;
  }
};

/**
 * A version names its own channel: the beta cask is the only publisher of
 * `X.Y.Z-beta.N`, the stable cask the only publisher of plain triples.
 */
const caskTokenForVersion = (version: string): CaskToken =>
  parsePrereleaseVersion(version) === null ? STABLE_CASK_TOKEN : BETA_CASK_TOKEN;

/**
 * Recovered from `fromVersion` when `fromCaskToken` is unset, which is exact
 * here: only a beta build can start a revert, only a stable one a switch.
 */
const sourceCaskToken = (pending: PendingInstall): CaskToken =>
  pending.fromCaskToken ?? caskTokenForVersion(pending.fromVersion);

/**
 * A PRECEDENCE, never a disjunct. OR-ing the probe with the shape guess lets
 * the guess overrule a `false` probe, which turns a rollback onto the
 * pre-release cask into a reported success with its marker cleared.
 */
const landedOnTargetChannel = (
  currentVersion: string,
  pending: PendingInstall,
  context: ReconcileContext,
): boolean =>
  context.isVersionInstalled === undefined
    ? caskTokenForVersion(currentVersion) === pending.caskToken
    : context.isVersionInstalled(currentVersion, pending.caskToken);

/**
 * Decides what the previous run's marker means for this launch.
 *
 * An unchanged version is not proof of failure: the app quits in under a second
 * while Homebrew downloads for minutes, and calling that a failure clears the
 * marker and collides a second click with the helper's download lock. A CHANGED
 * version is not proof of success either — a second copy sharing the bundle id
 * can be reopened instead — and a version that moved onto the SOURCE channel is
 * a rollback. Nor may anything assume the target is the NEWER version: a revert
 * lands strictly lower, so every check below is an equality or a token/path
 * comparison.
 */
export const reconcilePendingInstall = (
  pending: PendingInstall | null,
  currentVersion: string,
  context: ReconcileContext,
): InstallOutcome => {
  if (pending === null) return "none";

  // Bundle identity first, version second: a revert targets a version the user
  // was running until recently, so a stray copy at exactly that version is an
  // ordinary thing to find on disk. Testing the version first would answer
  // "installed" for it and throw away the mismatch this exists to catch.
  if (
    pending.appPath.length > 0 &&
    context.runningAppPath !== null &&
    context.runningAppPath !== pending.appPath
  ) {
    return "wrong-bundle";
  }

  if (currentVersion === pending.toVersion) return "installed";

  // The version moved, but onto the channel the operation was leaving: the
  // install failed and the helper reinstalled the source cask. Guarded on the
  // version having moved, because mid-flight the source cask is legitimate.
  if (
    sourceCaskToken(pending) !== pending.caskToken &&
    currentVersion !== pending.fromVersion &&
    !landedOnTargetChannel(currentVersion, pending, context)
  ) {
    return "rolled-back";
  }

  // The user changed the version by hand between the click and this launch.
  if (currentVersion !== pending.fromVersion) return "installed";

  // The bundle is already replaced; only this stale process is still old.
  // Probed through the caller's resolver, so the token comes from the marker.
  const isTargetInstalled =
    context.isVersionInstalled?.(pending.toVersion, pending.caskToken) ??
    context.isTargetInstalled === true;
  if (isTargetInstalled) return "restart-required";
  return context.now - pending.startedAt < UPGRADE_GRACE_MS
    ? "in-progress"
    : "failed";
};

export const createPendingInstallStore = (
  filePath: string,
): PendingInstallStore => ({
  read: (): PendingInstall | null => {
    try {
      return parsePendingInstall(readFileSync(filePath, "utf8"));
    } catch {
      return null;
    }
  },

  write: (pending: PendingInstall): void => {
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, `${JSON.stringify(pending)}\n`, "utf8");
  },

  clear: (): void => {
    rmSync(filePath, { force: true });
  },
});
