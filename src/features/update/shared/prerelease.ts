import { z } from "zod";
import {
  NonArrayObjectSchema,
  schemaGuard,
} from "~/features/core/shared/schemaGuard";
import { MessageSchema, type Message } from "~/features/i18n/shared/message";

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

const PRERELEASE_STATE_KEYS = new Set<string>([
  "phase",
  "activeChannel",
  "offeredVersion",
  "releaseNotes",
  "message",
  "canSwitch",
  "downloadedBytes",
  "totalBytes",
]);

const PrereleasePhaseSchema = z.enum([
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

const PrereleaseActiveChannelSchema = z.enum(["stable", "beta", "both"]);

const isNonArrayObject = schemaGuard(NonArrayObjectSchema);

/** Byte counts cross the bridge as plain non-negative safe integers. */
const ByteCountSchema = z
  .number()
  .refine((count) => Number.isSafeInteger(count) && count >= 0);

const PrereleaseStateFieldsSchema = z.object({
  phase: PrereleasePhaseSchema,
  activeChannel: PrereleaseActiveChannelSchema,
  offeredVersion: z.string().optional(),
  releaseNotes: z.string().optional(),
  message: MessageSchema.optional(),
  canSwitch: z.boolean().optional(),
  downloadedBytes: ByteCountSchema.optional(),
  totalBytes: ByteCountSchema.optional(),
});

/**
 * The snapshot crossing the preload boundary. Own keys are checked with
 * `Object.keys` rather than left to the object schema, which would strip a
 * stray key instead of refusing the snapshot that carried it.
 */
const PrereleaseStateSchema = z.custom<PrereleaseState>(
  (value) =>
    isNonArrayObject(value) &&
    Object.keys(value).every((key) => PRERELEASE_STATE_KEYS.has(key)) &&
    PrereleaseStateFieldsSchema.safeParse(value).success,
);

/** Validates the snapshot crossing the preload boundary. */
export const isPrereleaseState = schemaGuard(PrereleaseStateSchema);
