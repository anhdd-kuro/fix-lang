import { isMessage, type Message } from "./i18n/message";

/** Renderer-safe state for the app-update flow. */
export type UpdatePhase =
  | "unsupported"
  | "idle"
  | "checking"
  | "up-to-date"
  | "available"
  | "installing"
  | "error";

/**
 * This intentionally contains no updater URLs, file paths, or error details.
 * The main process owns those details and exposes only UI-safe information.
 *
 * `canInstall` is true only when the running app was installed by the Homebrew
 * cask, which is the single install path that can be upgraded in place.
 */
export type UpdateState = Readonly<{
  phase: UpdatePhase;
  currentVersion: string;
  availableVersion?: string;
  releaseNotes?: string;
  /**
   * A locale-free descriptor rather than a pre-resolved string: main builds
   * this state once, but the renderer may still be open across a locale
   * switch, and only the renderer's `tm()` (via `useI18n()`) can re-resolve
   * it into the currently active language.
   */
  message?: Message;
  canInstall?: boolean;
}>;

export type UpdateActionResult =
  | Readonly<{ success: true }>
  | Readonly<{ success: false; error: Message }>;

export type OpenUpdateReleaseResult = UpdateActionResult;
export type InstallUpdateResult = UpdateActionResult;

const UPDATE_STATE_KEYS = new Set<keyof UpdateState>([
  "phase",
  "currentVersion",
  "availableVersion",
  "releaseNotes",
  "message",
  "canInstall",
]);

const PHASES = new Set<UpdatePhase>([
  "unsupported",
  "idle",
  "checking",
  "up-to-date",
  "available",
  "installing",
  "error",
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Validates the small, serializable snapshot crossing the preload boundary. */
export const isUpdateState = (value: unknown): value is UpdateState => {
  if (
    !isRecord(value) ||
    Object.keys(value).some(
      (key) => !UPDATE_STATE_KEYS.has(key as keyof UpdateState),
    ) ||
    typeof value.phase !== "string" ||
    !PHASES.has(value.phase as UpdatePhase) ||
    typeof value.currentVersion !== "string"
  ) {
    return false;
  }
  if (
    (value.availableVersion !== undefined &&
      typeof value.availableVersion !== "string") ||
    (value.releaseNotes !== undefined && typeof value.releaseNotes !== "string") ||
    (value.message !== undefined && !isMessage(value.message)) ||
    (value.canInstall !== undefined && typeof value.canInstall !== "boolean")
  ) {
    return false;
  }
  return true;
};

/** Validates the fixed result shape shared by the update IPC actions. */
export const isUpdateActionResult = (
  value: unknown,
): value is UpdateActionResult => {
  if (!isRecord(value)) {
    return false;
  }
  const keys = Object.keys(value);
  if (value.success === true) {
    return keys.length === 1 && keys[0] === "success";
  }
  return (
    value.success === false &&
    keys.length === 2 &&
    keys.includes("success") &&
    keys.includes("error") &&
    isMessage(value.error)
  );
};

/** Validates the fixed result shape for the releases-page IPC action. */
export const isOpenUpdateReleaseResult = (
  value: unknown,
): value is OpenUpdateReleaseResult => isUpdateActionResult(value);

/** Validates the fixed result shape for the Homebrew install IPC action. */
export const isInstallUpdateResult = (
  value: unknown,
): value is InstallUpdateResult => isUpdateActionResult(value);
