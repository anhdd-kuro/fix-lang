/**
 * @file appBundleIds.ts
 * @description Turns macOS `.app` bundle paths — from the deny-list editor's
 * file dialog or from a drag-and-drop — into canonical bundle ids.
 *
 * Two rules this file exists to enforce:
 *
 * 1. **Every renderer-supplied path is re-validated here**, in main, before
 *    the filesystem is touched: a string, absolute, `.app`-suffixed, control
 *    character free, bounded in length, and actually present on disk. A path
 *    that fails ANY of those is REJECTED, never repaired — the same philosophy
 *    as `set-selection-guards` in `guards.ts`, and for the same reason: a
 *    coerced path would let a buggy (or hostile) renderer aim this at
 *    something that is not an app bundle while the call still reports success.
 *
 * 2. **`CFBundleIdentifier` is read with `execFile`, never a shell string.**
 *    `Info.plist` is usually a BINARY plist, so it cannot be hand-parsed as
 *    text, and `/usr/libexec/PlistBuddy` is the system tool that reads both
 *    forms. Passing the path as an argv entry (not interpolated into a
 *    command line) means a path containing spaces, quotes, or `;` is data —
 *    there is no shell to inject into.
 *
 * The resolved id goes through `normalizeBundleId`, the same canonicalisation
 * the deny-list and `evaluateSelectionGuards` use, so an id read off disk is
 * indistinguishable from one the user typed.
 */
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import {
  MAX_APP_BUNDLE_PATHS,
  hasAppBundlePathShape,
  type AppBundleIdsResult,
} from "~/features/guards/shared/appBundleIds";
import { normalizeBundleId } from "~/features/guards/shared/guardSettings";
import { messageLabel } from "~/features/i18n/shared/message";

const execFileAsync = promisify(execFile);

const PLIST_BUDDY_PATH = "/usr/libexec/PlistBuddy";

/** Bounds `stdout` — a real bundle id is short, and only the first line is read. */
const PLIST_BUDDY_MAX_BUFFER = 64 * 1024;

/**
 * Shape check plus the existence check main is the only process allowed to
 * make. Kept separate from `hasAppBundlePathShape` (shared, pure) so the
 * renderer can pre-filter a drop without pretending to know the filesystem.
 */
export const isExistingAppBundlePath = (value: unknown): value is string =>
  hasAppBundlePathShape(value) && existsSync(value);

/**
 * Reads one bundle's `CFBundleIdentifier`, returning `null` when the bundle
 * has no readable identifier (a malformed or non-application `.app`
 * directory). A missing identifier is not an exception here: the caller turns
 * it into one failure `Label` for the whole call, so the user is told nothing
 * was added rather than silently getting a shorter list than they dropped.
 */
export const readAppBundleId = async (appPath: string): Promise<string | null> => {
  const plistPath = path.join(appPath, "Contents", "Info.plist");
  if (!existsSync(plistPath)) return null;
  try {
    const { stdout } = await execFileAsync(
      PLIST_BUDDY_PATH,
      ["-c", "Print :CFBundleIdentifier", plistPath],
      { maxBuffer: PLIST_BUDDY_MAX_BUFFER },
    );
    return normalizeBundleId(stdout.split("\n")[0]);
  } catch {
    return null;
  }
};

/**
 * Validates a renderer-supplied list of paths, then resolves each to a
 * canonical bundle id. Rejects the WHOLE call on the first problem — a
 * malformed payload, a path that is not an existing `.app`, or a bundle whose
 * identifier cannot be read — rather than returning a partial list: "some of
 * what you dropped is now blocked" is a state the user cannot see from the
 * deny-list, whereas "nothing was added, here is why" is.
 */
export const resolveAppBundleIds = async (
  paths: unknown,
): Promise<AppBundleIdsResult> => {
  if (
    !Array.isArray(paths) ||
    paths.length > MAX_APP_BUNDLE_PATHS ||
    !paths.every(isExistingAppBundlePath)
  ) {
    return { success: false, error: messageLabel("security.deniedApps.dropInvalid") };
  }

  const bundleIds: string[] = [];
  for (const appPath of paths) {
    const bundleId = await readAppBundleId(appPath);
    if (bundleId === null) {
      return { success: false, error: messageLabel("security.deniedApps.dropError") };
    }
    bundleIds.push(bundleId);
  }
  return { success: true, bundleIds };
};
