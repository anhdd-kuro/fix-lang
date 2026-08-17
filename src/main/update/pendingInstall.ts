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
 *
 * Imported from `./homebrew` rather than redeclared: that module's
 * `KNOWN_CASK_TOKENS` is the one runtime allow-list, so a third channel token
 * added there is automatically recognized here too, instead of silently
 * coercing back to stable on read until this file is also edited.
 */
export type { CaskToken };

/**
 * Every marker defaults to this token — including one written before the
 * field existed. That default is also the correct answer for those markers,
 * not just a safe placeholder: every upgrade before pre-release existed was
 * stable-to-stable.
 *
 * Re-exported from `./homebrew` rather than re-spelled: the literal is the
 * dangerous half. A `: CaskToken` annotation catches an outright rename, but
 * not a third channel token being added while `"fixlang"` stays in
 * `KNOWN_CASK_TOKENS` for legacy markers — `homebrew.ts` would move its
 * stable token forward while this module's MIGRATION DEFAULT still pointed at
 * the legacy string, with no type error and no test failure.
 */
export { STABLE_CASK_TOKEN };

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
  /**
   * The token the operation targeted — for a revert that is the STABLE one,
   * so this field alone never says which channel the app came from. See
   * {@link CaskToken}.
   */
  caskToken: CaskToken;
  /**
   * The token the app was installed under when the operation started, i.e.
   * the cask a failed channel switch reinstalls when it rolls back. Optional
   * because markers written before this field exist on disk, and because the
   * writer that fills it in is not this module's to change; when it is
   * absent, {@link sourceCaskToken} recovers the same answer from
   * `fromVersion`. Without it (or that fallback) the marker cannot express
   * "the switch rolled back onto the source channel", and reconcile has no
   * choice but to read the rollback's moved version as a completed update.
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
   * A channel switch or revert that ended back on the channel it started
   * from: the install failed and the helper reinstalled the source cask,
   * normally at that channel's CURRENT version rather than the one the user
   * had. The version therefore moved without the operation succeeding, which
   * is the one state "the version moved, so it worked" gets exactly backwards
   * — a user who asked to leave the pre-release channel is still on it, under
   * a build they never chose. Reports as an unfinished operation, never as an
   * update.
   */
  | "rolled-back"
  | "failed";

type VersionInstalledResolver = (
  version: string,
  caskToken: CaskToken,
) => boolean;

type ReconcileContextBase = Readonly<{
  /** Epoch ms at reconcile time. */
  now: number;
  /** `.app` root of the process doing the reconcile; null when unknown. */
  runningAppPath: string | null;
}>;

/**
 * Exactly one of two ways to answer "what does the Caskroom hold" — either
 * form satisfies the type, neither may be omitted.
 *
 * `isVersionInstalled` is the one to pass. A pre-resolved `isTargetInstalled`
 * boolean discards the very thing the contract is about: reconcile needs the
 * probe aimed at `pending.caskToken`'s own Caskroom — not always the stable
 * one — and a boolean records neither which version nor which token the
 * caller used. That omission has already shipped once (see
 * `updateService.ts`'s `watchBackgroundUpgrade` doc comment), because a
 * boolean can only be described in prose, never checked. The resolver makes
 * reconcile pass the token itself, so getting it wrong stops being possible,
 * and it is also what lets a rollback onto the source channel be detected
 * from the Caskroom rather than inferred from the version's shape.
 *
 * The boolean member remains only so existing callers keep compiling; drop it
 * from this union once every call site passes the resolver.
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
 *
 * Delegates to `./homebrew`'s `isCaskToken` instead of re-spelling the two
 * literals here, so this file's runtime allow-list can never drift from the
 * one it imports its `CaskToken` type from.
 */
const parseCaskToken = (value: unknown): CaskToken =>
  typeof value === "string" && isCaskToken(value) ? value : STABLE_CASK_TOKEN;

/**
 * The source token, unlike the target one, has no safe default: guessing
 * "stable" for a marker that omitted it would assert the app started on the
 * stable channel, and a wrong answer there is what turns a rolled-back revert
 * into a reported success. Absent stays absent, and reconcile falls back to
 * the version it started from instead.
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
 * Which channel's cask publishes a given version. FixLang's beta channel is
 * the only publisher of `X.Y.Z-beta.N` builds and the stable channel is the
 * only publisher of plain triples, so a version names its own channel — the
 * same rule `updateService.ts`'s `pendingChannelOperation` relies on to tell
 * a revert from an ordinary stable upgrade.
 */
const caskTokenForVersion = (version: string): CaskToken =>
  parsePrereleaseVersion(version) === null ? STABLE_CASK_TOKEN : BETA_CASK_TOKEN;

/**
 * The channel the operation started on. Recorded explicitly when the writer
 * fills in `fromCaskToken`; recovered from `fromVersion` otherwise, which is
 * exact for every marker that matters here — only a beta build can start a
 * revert, and only a stable one a switch.
 */
const sourceCaskToken = (pending: PendingInstall): CaskToken =>
  pending.fromCaskToken ?? caskTokenForVersion(pending.fromVersion);

/**
 * Whether the running version is where the operation was trying to put it.
 *
 * A PRECEDENCE, never a disjunct. The Caskroom probe is the real evidence and
 * is the whole answer whenever the caller supplies one; the shape comparison
 * is the fallback for callers that still pass only the pre-resolved boolean,
 * and it is what makes a rolled-back switch detectable for them at all.
 *
 * The two must not be OR'd, however honest that reads. An OR can only ever
 * flip the probe's `false` up to `true`, so the shape overrules the probe in
 * exactly one direction: when the Caskroom says the target cask does NOT hold
 * the running version and the version string merely looks like that channel's,
 * the guess wins. That is the direction that turns a rollback into a reported
 * success — a revert that rolled back onto the pre-release cask, which is
 * holding a build with no `-beta.N` in its version, reads as a completed
 * update, clears the marker, and leaves both panels saying up-to-date while
 * the user is still on the channel they asked to leave.
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
 *
 * Nor is a version that moved onto the *source* channel any kind of success.
 * A failed channel switch rolls back by reinstalling the cask it came from,
 * which lands that channel's current version — normally not the one the user
 * had, since a newer beta is the ordinary case for someone on that channel.
 * That moved version used to read as "updated by hand, still an update",
 * which is how a revert that left the user on the pre-release channel got
 * reported as a completed one with its marker cleared.
 */
export const reconcilePendingInstall = (
  pending: PendingInstall | null,
  currentVersion: string,
  context: ReconcileContext,
): InstallOutcome => {
  if (pending === null) return "none";

  // Bundle identity first, version second: a revert targets a version the
  // user was running until recently, so a leftover copy at exactly that
  // version is an ordinary thing to find on disk — an upgrade's target never
  // existed on the machine before. Testing the version first would answer
  // "installed" for that stray copy and throw away the mismatch this exists
  // to catch.
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
  // version having moved at all, because while the helper is still working
  // the source cask is legitimately the installed one — calling that a
  // rollback would clear the marker mid-flight and re-arm the button into the
  // running helper's download lock.
  if (
    sourceCaskToken(pending) !== pending.caskToken &&
    currentVersion !== pending.fromVersion &&
    !landedOnTargetChannel(currentVersion, pending, context)
  ) {
    return "rolled-back";
  }

  // Same bundle, version moved anyway: the user changed the installed
  // version by hand between the click and this launch, in either direction.
  // Still an update.
  if (currentVersion !== pending.fromVersion) return "installed";

  // The bundle is already replaced; only this stale process is still old.
  // Resolved through the caller's own probe when there is one, so the token
  // comes from the marker rather than from whatever channel the caller
  // happens to be bound to.
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
