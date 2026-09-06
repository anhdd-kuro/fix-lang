import { isMessage, type Message } from "~/features/i18n/shared/message";

export type PrereleaseChannel = "stable" | "beta";

/**
 * `"both"` is not a resting state: a channel switch died between installing
 * the target and uninstalling the source, so the renderer shows `message`
 * instead of a channel toggle.
 */
export type PrereleaseActiveChannel = PrereleaseChannel | "both";

export type PrereleasePhase =
  | "unsupported"
  | "idle"
  | "checking"
  | "up-to-date"
  | "available"
  | "downloading"
  | "installing"
  | "restart-required"
  | "error";

/**
 * A SEPARATE state from `UpdateState`, on its own IPC channel
 * (`updates:prerelease-state`) that the tray never subscribes to. Same
 * UI-safe discipline: no updater URLs, file paths, or raw error details.
 */
export type PrereleaseState = Readonly<{
  phase: PrereleasePhase;
  activeChannel: PrereleaseActiveChannel;
  offeredVersion?: string;
  releaseNotes?: string;
  /**
   * A locale-free descriptor, not a resolved string: an open renderer must be
   * able to re-resolve it after a locale switch. Also carries the `"both"`
   * fix-it text.
   */
  message?: Message;
  /**
   * Guards the same Homebrew cask-install precondition as
   * `UpdateState.canInstall`.
   */
  canSwitch?: boolean;
  /** Bytes rather than a percentage, so the renderer can locale-format both. */
  downloadedBytes?: number;
  totalBytes?: number;
}>;

const PRERELEASE_STATE_KEYS = new Set<keyof PrereleaseState>([
  "phase",
  "activeChannel",
  "offeredVersion",
  "releaseNotes",
  "message",
  "canSwitch",
  "downloadedBytes",
  "totalBytes",
]);

const PRERELEASE_PHASES = new Set<PrereleasePhase>([
  "unsupported",
  "idle",
  "checking",
  "up-to-date",
  "available",
  "downloading",
  "installing",
  "restart-required",
  "error",
]);

const PRERELEASE_ACTIVE_CHANNELS = new Set<PrereleaseActiveChannel>([
  "stable",
  "beta",
  "both",
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isOptionalByteCount = (value: unknown): boolean =>
  value === undefined ||
  (typeof value === "number" && Number.isSafeInteger(value) && value >= 0);

/** Validates the snapshot crossing the preload boundary. */
export const isPrereleaseState = (value: unknown): value is PrereleaseState => {
  if (
    !isRecord(value) ||
    Object.keys(value).some(
      (key) => !PRERELEASE_STATE_KEYS.has(key as keyof PrereleaseState),
    ) ||
    typeof value.phase !== "string" ||
    !PRERELEASE_PHASES.has(value.phase as PrereleasePhase) ||
    typeof value.activeChannel !== "string" ||
    !PRERELEASE_ACTIVE_CHANNELS.has(value.activeChannel as PrereleaseActiveChannel)
  ) {
    return false;
  }
  if (
    (value.offeredVersion !== undefined &&
      typeof value.offeredVersion !== "string") ||
    (value.releaseNotes !== undefined && typeof value.releaseNotes !== "string") ||
    (value.message !== undefined && !isMessage(value.message)) ||
    (value.canSwitch !== undefined && typeof value.canSwitch !== "boolean") ||
    !isOptionalByteCount(value.downloadedBytes) ||
    !isOptionalByteCount(value.totalBytes)
  ) {
    return false;
  }
  return true;
};
