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
}>;

export type PendingInstallStore = Readonly<{
  read: () => PendingInstall | null;
  write: (pending: PendingInstall) => void;
  clear: () => void;
}>;

export type InstallOutcome = "none" | "installed" | "failed";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

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
    });
  } catch {
    return null;
  }
};

/**
 * A launch that still reports the old version means Homebrew never replaced
 * the bundle — the upgrade failed even though nothing errored in the UI.
 */
export const reconcilePendingInstall = (
  pending: PendingInstall | null,
  currentVersion: string,
): InstallOutcome => {
  if (pending === null) return "none";
  return currentVersion === pending.fromVersion ? "failed" : "installed";
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
