import { z } from "zod";
import {
  NonArrayObjectSchema,
  schemaGuard,
} from "~/features/core/shared/schemaGuard";
import { MessageSchema, type Message } from "~/features/i18n/shared/message";

/** Renderer-safe state for the app-update flow. */
export type UpdatePhase =
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
  /**
   * Download progress for the `downloading` phase. Bytes rather than a
   * percentage so the renderer can show "35 MB of 102 MB" and locale-format
   * both; `totalBytes` comes from the validated GitHub release asset.
   */
  downloadedBytes?: number;
  totalBytes?: number;
}>;

export type UpdateActionResult =
  | Readonly<{ success: true }>
  | Readonly<{ success: false; error: Message }>;

export type OpenUpdateReleaseResult = UpdateActionResult;
export type InstallUpdateResult = UpdateActionResult;

const UPDATE_STATE_KEYS = new Set<string>([
  "phase",
  "currentVersion",
  "availableVersion",
  "releaseNotes",
  "message",
  "canInstall",
  "downloadedBytes",
  "totalBytes",
]);

const UpdatePhaseSchema = z.enum([
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

const isNonArrayObject = schemaGuard(NonArrayObjectSchema);

/** Byte counts cross the bridge as plain non-negative safe integers. */
const ByteCountSchema = z
  .number()
  .refine((count) => Number.isSafeInteger(count) && count >= 0);

const UpdateStateFieldsSchema = z.object({
  phase: UpdatePhaseSchema,
  currentVersion: z.string(),
  availableVersion: z.string().optional(),
  releaseNotes: z.string().optional(),
  message: MessageSchema.optional(),
  canInstall: z.boolean().optional(),
  downloadedBytes: ByteCountSchema.optional(),
  totalBytes: ByteCountSchema.optional(),
});

/** The small, serializable snapshot crossing the preload boundary. */
const UpdateStateSchema = z.custom<UpdateState>(
  (value) =>
    isNonArrayObject(value) &&
    Object.keys(value).every((key) => UPDATE_STATE_KEYS.has(key)) &&
    UpdateStateFieldsSchema.safeParse(value).success,
);

const SucceededActionSchema = z.object({ success: z.literal(true) });

const FailedActionSchema = z.object({
  success: z.literal(false),
  error: MessageSchema,
});

/** The fixed result shape shared by the update IPC actions. */
const UpdateActionResultSchema = z.custom<UpdateActionResult>((value) => {
  if (!isNonArrayObject(value)) return false;
  const keys = Object.keys(value);
  if (SucceededActionSchema.safeParse(value).success) {
    return keys.length === 1 && keys[0] === "success";
  }
  return (
    keys.length === 2 &&
    keys.includes("success") &&
    keys.includes("error") &&
    FailedActionSchema.safeParse(value).success
  );
});

/** Validates the small, serializable snapshot crossing the preload boundary. */
export const isUpdateState = schemaGuard(UpdateStateSchema);

/** Validates the fixed result shape shared by the update IPC actions. */
export const isUpdateActionResult = schemaGuard(UpdateActionResultSchema);

/** Validates the fixed result shape for the releases-page IPC action. */
export const isOpenUpdateReleaseResult = schemaGuard<OpenUpdateReleaseResult>(
  UpdateActionResultSchema,
);

/** Validates the fixed result shape for the Homebrew install IPC action. */
export const isInstallUpdateResult = schemaGuard<InstallUpdateResult>(
  UpdateActionResultSchema,
);
