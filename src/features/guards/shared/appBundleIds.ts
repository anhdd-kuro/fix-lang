/**
 * @file appBundleIds.ts
 * @description Shape rules for the "pick an .app, block its bundle id" path
 * of the deny-list editor, plus the result shape its two IPC channels return.
 * Electron- and node-free, so the renderer (which pre-filters a drop), the
 * preload bridge, and the main-process resolver all ask the SAME question.
 *
 * The shape check is deliberately separate from "does this path exist?": only
 * main may touch the filesystem, and only main may act on the answer. A
 * renderer that pre-filters with `hasAppBundlePathShape` is a convenience for
 * the user (a dropped .txt is reported, not silently swallowed), never the
 * check that protects the filesystem — `~/features/guards/main/appBundleIds.ts`
 * re-validates every path it is handed and rejects rather than coerces.
 */
import { isLabel, type Label } from "~/features/i18n/shared/message";

/**
 * Upper bound on how many paths one drop or one file-dialog selection may
 * carry. Matches `MAX_DENIED_BUNDLE_IDS` in `guardSettings.ts` — the deny-list
 * cannot hold more than that anyway, so accepting more only buys work whose
 * result is discarded.
 */
export const MAX_APP_BUNDLE_PATHS = 200;

/**
 * Longest path the resolver will even look at. macOS's own limit is
 * `PATH_MAX` (1024); a longer string cannot name a real bundle and must not
 * reach `execFile` or a log line.
 */
export const MAX_APP_BUNDLE_PATH_LENGTH = 1024;

/**
 * A macOS application bundle path: absolute, `.app`-suffixed, free of NUL and
 * control characters, and bounded in length. `.app` is matched
 * case-insensitively because the Finder preserves whatever case the bundle was
 * created with, while existence is NOT checked here — that is a filesystem
 * question and belongs in main.
 */
// eslint-disable-next-line no-control-regex -- rejecting control chars is the point
const CONTROL_CHARACTERS_PATTERN = /[\x00-\x1f\x7f-\x9f]/;

export const hasAppBundlePathShape = (value: unknown): value is string => {
  if (typeof value !== "string") return false;
  if (value.length === 0 || value.length > MAX_APP_BUNDLE_PATH_LENGTH) return false;
  if (!value.startsWith("/")) return false;
  if (!value.toLowerCase().endsWith(".app")) return false;
  return !CONTROL_CHARACTERS_PATTERN.test(value);
};

/**
 * Reply of both `choose-denied-apps` and `resolve-app-bundle-ids`. A
 * discriminated union rather than `{ success: boolean; bundleIds: string[] }`
 * so a failed call cannot also carry a half-filled id list that a caller might
 * write to the deny-list anyway.
 *
 * A cancelled file dialog is `{ success: true, bundleIds: [] }`: the user
 * changed their mind, which is not an error to report to them.
 */
export type AppBundleIdsResult =
  | { success: true; bundleIds: string[] }
  | { success: false; error: Label };

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === "string");

/** Validates an `AppBundleIdsResult` arriving over IPC, for the preload bridge. */
export const isAppBundleIdsResult = (value: unknown): value is AppBundleIdsResult => {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  if (record.success === true) return isStringArray(record.bundleIds);
  if (record.success !== false) return false;
  return isLabel(record.error);
};
