import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * The Homebrew upgrade finishes after the app has already quit, so the only
 * way to report its outcome is a marker written before quitting and read on
 * the next launch. A silent no-op update is worse than a loud failure.
 */

/**
 * The cask token Homebrew installed the target under. `fixlang` is the
 * published stable tap entry; `fixlang@beta` is the pre-release channel. A
 * channel switch can move in either direction and a revert specifically
 * lands a version LOWER than the one running — so the token, never the
 * version's direction, is what tells reconcile which Caskroom the install
 * actually landed in.
 */
export type CaskToken = "fixlang" | "fixlang@beta";

/**
 * Every marker defaults to this token — including one written before the
 * field existed. That default is also the correct answer for those markers,
 * not just a safe placeholder: every upgrade before pre-release existed was
 * stable-to-stable.
 */
export const STABLE_CASK_TOKEN: CaskToken = "fixlang";

export type PendingInstall = Readonly<{
  fromVersion: string;
  toVersion: string;
  /** Epoch ms the helper was started; 0 for markers written before this field. */
  startedAt: number;
  /**
   * `.app` root that was running when the upgrade started — the exact bundle
   * Homebrew replaces. Empty for markers written before this field, and for a
   * non-macOS layout. Lets the next launch tell "the upgrade landed" from "a
   * different copy of the app opened instead".
   */
  appPath: string;
  /** See {@link CaskToken}. */
  caskToken: CaskToken;
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
  | "failed";

export type ReconcileContext = Readonly<{
  /** Epoch ms at reconcile time. */
  now: number;
  /**
   * True once the Caskroom holds the target version, i.e. Homebrew finished.
   * The caller must resolve this against `pending.caskToken`'s own Caskroom
   * — not always the stable one — or a successful install under a different
   * token (a pre-release switch, or a revert back to stable) never shows up
   * here and reads as a stalled, then failed, upgrade instead.
   */
  isTargetInstalled: boolean;
  /** `.app` root of the process doing the reconcile; null when unknown. */
  runningAppPath: string | null;
}>;

/**
 * How long the detached helper may still be working before an unchanged
 * version counts as a failure. A cold `brew update` plus a ~101.6 MiB download on
 * a slow link is minutes, not seconds, and the app can be reopened by hand
 * long before any of it finishes.
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
 * Missing, corrupt, or foreign token values fall back to the stable token
 * rather than rejecting the whole marker — a real marker on a user's disk
 * predates this field entirely, and a marker must never fail to parse over
 * one field going unrecognized.
 */
const parseCaskToken = (value: unknown): CaskToken =>
  value === "fixlang" || value === "fixlang@beta"
    ? value
    : STABLE_CASK_TOKEN;

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
    });
  } catch {
    return null;
  }
};

/**
 * Decides what the previous run's marker means for this launch.
 *
 * An unchanged version is not proof of failure: the app quits in under a
 * second while Homebrew keeps downloading for minutes, and a user who reopens
 * FixLang in the meantime lands here with the upgrade still in flight. Calling
 * that a failure both lies and clears the marker, so the real outcome is never
 * reported and a second click collides with the running helper's download
 * lock. Only a grace window with no installed result means it genuinely failed.
 *
 * Nor is a *changed* version proof of success. When a second copy of FixLang
 * shares the bundle id, `open -b` can reopen that copy instead of the upgraded
 * one, and a bare "version differs from before" test reports an unrelated
 * version change as a completed update. Bundle path is the reliable identity:
 * the target one is the path Homebrew replaced, and anything else is a
 * different app.
 *
 * Nothing here may assume the target version is the *newer* one: a revert
 * lands a version strictly lower than the one running, under a different
 * cask token, and it must reconcile exactly as correctly as an upgrade does.
 * Every check below is an equality or a token/path comparison, never an
 * ordering — direction is not information this function has.
 */
export const reconcilePendingInstall = (
  pending: PendingInstall | null,
  currentVersion: string,
  context: ReconcileContext,
): InstallOutcome => {
  if (pending === null) return "none";
  if (currentVersion === pending.toVersion) return "installed";

  // Running from somewhere else entirely — a stray build with the same bundle
  // id won the `open` race. Never report that as an update.
  if (
    pending.appPath.length > 0 &&
    context.runningAppPath !== null &&
    context.runningAppPath !== pending.appPath
  ) {
    return "wrong-bundle";
  }

  // Same bundle, version moved anyway: the user changed the installed
  // version by hand between the click and this launch, in either direction.
  // Still an update.
  if (currentVersion !== pending.fromVersion) return "installed";

  // The bundle is already replaced; only this stale process is still old.
  if (context.isTargetInstalled) return "restart-required";
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
