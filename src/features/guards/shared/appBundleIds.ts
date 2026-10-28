/**
 * @file appBundleIds.ts
 * @description Shape rules for the "pick an .app, block its bundle id" path
 * of the deny-list editor, plus the result shape its two IPC channels return.
 * Electron- and node-free, so the renderer (which pre-filters a drop), the
 * preload bridge, and the main-process resolver all ask the SAME question.
 *
 * The shape check is deliberately separate from "does this path exist?": only
 * main may touch the filesystem, and only main may act on the answer. A
 * renderer that pre-filters with `looksLikeAppBundlePath` is a convenience for
 * the user (a dropped .txt is reported, not silently swallowed), never the
 * check that protects the filesystem — `~/features/guards/main/appBundleIds.ts`
 * re-validates every path it is handed and rejects rather than coerces.
 */
import { z } from "zod";
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
// oxlint-disable-next-line no-control-regex -- rejecting control chars is the point
const CONTROL_CHARACTERS_PATTERN = /[\x00-\x1f\x7f-\x9f]/;

/**
 * Checks run in order and stop at the first failure (`abort`) — zod would
 * otherwise still run the later refines, so a too-long string would reach
 * `toLowerCase` and the regex.
 */
const AppBundlePathSchema = z
  .string()
  .min(1, { abort: true })
  .max(MAX_APP_BUNDLE_PATH_LENGTH, { abort: true })
  .startsWith("/", { abort: true })
  .refine((value) => value.toLowerCase().endsWith(".app"), { abort: true })
  .refine((value) => !CONTROL_CHARACTERS_PATTERN.test(value));

/**
 * Re-checked at runtime rather than trusted from the parameter type: the
 * preload and main both call this on lists that crossed a process boundary,
 * where a non-string must read as "not an app path", never throw.
 */
export const looksLikeAppBundlePath = (value: string): boolean =>
  AppBundlePathSchema.safeParse(value).success;

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

/**
 * Built on `Array#every`, which skips holes, rather than on `z.array`, which
 * would read them as `undefined` and refuse; the array itself is the result.
 */
const BundleIdListSchema = z.custom<string[]>(
  (value) =>
    Array.isArray(value) &&
    value.every((entry) => z.string().safeParse(entry).success),
);

/**
 * Validates an `AppBundleIdsResult` arriving over IPC, for the preload bridge.
 * A success is judged only by its id list and a failure only by its `Label`;
 * any other key is carried along untouched.
 */
export const AppBundleIdsResultSchema = z.union([
  z.looseObject({ success: z.literal(true), bundleIds: BundleIdListSchema }),
  z.looseObject({
    success: z.literal(false),
    error: z.custom<Label>((value) => isLabel(value)),
  }),
]);
