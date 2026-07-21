/** Renderer-safe state for the app-update flow. */
export type UpdatePhase =
  | "unsupported"
  | "idle"
  | "checking"
  | "up-to-date"
  | "available"
  | "downloading"
  | "downloaded"
  | "error";

export type UpdateProgress = Readonly<{
  percent: number;
  transferred: number;
  total: number;
  bytesPerSecond: number;
}>;

/**
 * This intentionally contains no updater URLs, file paths, or error details.
 * The main process owns those details and exposes only UI-safe information.
 */
export type UpdateState = Readonly<{
  phase: UpdatePhase;
  currentVersion: string;
  availableVersion?: string;
  releaseNotes?: string;
  progress?: UpdateProgress;
  message?: string;
}>;

export type OpenUpdateReleaseResult =
  | Readonly<{ success: true }>
  | Readonly<{ success: false; error: string }>;

const PHASES = new Set<UpdatePhase>([
  "unsupported",
  "idle",
  "checking",
  "up-to-date",
  "available",
  "downloading",
  "downloaded",
  "error",
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Validates the small, serializable snapshot crossing the preload boundary. */
export const isUpdateState = (value: unknown): value is UpdateState => {
  if (
    !isRecord(value) ||
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
  if (value.progress === undefined) {
    return true;
  }
  return (
    isRecord(value.progress) &&
    typeof value.progress.percent === "number" &&
    typeof value.progress.transferred === "number" &&
    typeof value.progress.total === "number" &&
    typeof value.progress.bytesPerSecond === "number"
  );
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
