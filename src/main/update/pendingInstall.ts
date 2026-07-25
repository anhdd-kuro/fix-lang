import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

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
  | "in-progress"
  | "failed";

export type ReconcileContext = Readonly<{
  /** Epoch ms at reconcile time. */
  now: number;
  /** True once the Caskroom holds the target version, i.e. Homebrew finished. */
  isTargetInstalled: boolean;
}>;

/**
 * How long the detached helper may still be working before an unchanged
 * version counts as a failure. A cold `brew update` plus a ~128 MB download on
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
 */
export const reconcilePendingInstall = (
  pending: PendingInstall | null,
  currentVersion: string,
  context: ReconcileContext,
): InstallOutcome => {
  if (pending === null) return "none";
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
