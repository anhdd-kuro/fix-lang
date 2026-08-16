import { isMessage, type Message } from "~/features/i18n/shared/message";

/** A Homebrew cask token FixLang can be installed under. */
export type PrereleaseChannel = "stable" | "beta";

/**
 * Which cask token(s) are actually installed on disk right now, per the
 * two-directory Caskroom probe. `"both"` is not a normal resting state — it
 * means a previous channel switch left both tokens installed (e.g. it died
 * between installing the target and uninstalling the source) — the renderer
 * shows `message` in that case rather than a channel toggle.
 */
export type PrereleaseActiveChannel = PrereleaseChannel | "both";

/** Renderer-safe state for the pre-release (beta) channel flow. */
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
 * A SEPARATE state from `UpdateState` (`~/features/update/shared/update`),
 * broadcast on its own IPC channel (`updates:prerelease-state`) that the
 * tray never subscribes to. `UpdateState`/`UPDATE_STATE_KEYS`/`isUpdateState`
 * stay byte-unchanged specifically so this feature rides alongside the
 * stable update flow instead of widening it — the tray only ever calls
 * `installUpdate`/`checkForUpdates` against the stable state and has no use
 * for pre-release fields.
 *
 * Same UI-safe discipline as `UpdateState`: no updater URLs, file paths, or
 * raw error details — the main process owns those and exposes only what the
 * renderer needs to display.
 */
export type PrereleaseState = Readonly<{
  phase: PrereleasePhase;
  /** Which cask token(s) are actually installed on disk right now. */
  activeChannel: PrereleaseActiveChannel;
  /** The newest published beta version, when one is currently offered. */
  offeredVersion?: string;
  releaseNotes?: string;
  /**
   * A locale-free descriptor rather than a pre-resolved string, exactly like
   * `UpdateState.message`: main builds this state once, but the renderer may
   * still be open across a locale switch, and only the renderer's `tm()`
   * (via `useI18n()`) can re-resolve it into the currently active language.
   * Also carries the fix-it text when `activeChannel` is `"both"`.
   */
  message?: Message;
  /**
   * True only when a one-click switch/revert can run — the same Homebrew
   * cask-install precondition `UpdateState.canInstall` guards.
   */
  canSwitch?: boolean;
  /**
   * Download progress for the `downloading` phase. Bytes rather than a
   * percentage, same convention as `UpdateState`, so the renderer can show
   * "35 MB of 102 MB" and locale-format both.
   */
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

/** Byte counts cross the bridge as plain non-negative safe integers. */
const isOptionalByteCount = (value: unknown): boolean =>
  value === undefined ||
  (typeof value === "number" && Number.isSafeInteger(value) && value >= 0);

/** Validates the small, serializable snapshot crossing the preload boundary. */
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
