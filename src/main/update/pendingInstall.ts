import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

/**
 * The Homebrew upgrade finishes after the app has already quit, so the only
 * way to report its outcome is a marker written before quitting and read on
 * the next launch. A silent no-op update is worse than a loud failure.
 */
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
  /** True once the Caskroom holds the target version, i.e. Homebrew finished. */
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

/**
 * The marker as written to disk. Both versions are required; the later fields
 * fall back instead of rejecting a marker written before they existed.
 */
const PendingInstallMarkerSchema = z.object({
  fromVersion: z.string().min(1),
  toVersion: z.string().min(1),
  /** Missing or nonsensical timestamps read as "long ago", never as "just now". */
  startedAt: z.number().int().positive().catch(0),
  appPath: z.string().catch(""),
});

/** Parses the marker defensively; a corrupt file must never break startup. */
export const parsePendingInstall = (raw: string): PendingInstall | null => {
  try {
    const marker = PendingInstallMarkerSchema.safeParse(JSON.parse(raw));
    if (!marker.success) {
      return null;
    }
    return Object.freeze({
      fromVersion: marker.data.fromVersion,
      toVersion: marker.data.toVersion,
      startedAt: marker.data.startedAt,
      appPath: marker.data.appPath,
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
 * one, and a bare "version differs from before" test reports a downgrade as a
 * completed update. Bundle path is the reliable identity: the target one is
 * the path Homebrew replaced, and anything else is a different app.
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

  // Same bundle, version moved anyway: the user upgraded past the target by
  // hand between the click and this launch. Still an update.
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
