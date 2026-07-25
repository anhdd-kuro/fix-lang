/** Renderer-safe state for the app-update flow. */
export type UpdatePhase =
  | "unsupported"
  | "idle"
  | "checking"
  | "up-to-date"
  | "available"
  | "error";

/**
 * This intentionally contains no updater URLs, file paths, or error details.
 * The main process owns those details and exposes only UI-safe information.
 */
export type UpdateState = Readonly<{
  phase: UpdatePhase;
  currentVersion: string;
  availableVersion?: string;
  releaseNotes?: string;
  message?: string;
}>;

export type OpenUpdateReleaseResult =
  | Readonly<{ success: true }>
  | Readonly<{ success: false; error: string }>;

const UPDATE_STATE_KEYS = new Set<keyof UpdateState>([
  "phase",
  "currentVersion",
  "availableVersion",
  "releaseNotes",
  "message",
]);

const PHASES = new Set<UpdatePhase>([
  "unsupported",
  "idle",
  "checking",
  "up-to-date",
  "available",
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
    (value.message !== undefined && typeof value.message !== "string")
  ) {
    return false;
  }
  return true;
};

/** Validates the fixed result shape for the releases-page IPC action. */
export const isOpenUpdateReleaseResult = (
  value: unknown,
): value is OpenUpdateReleaseResult => {
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
    typeof value.error === "string" &&
    value.error.length > 0
  );
};
