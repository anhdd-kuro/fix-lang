/**
 * @file activeApp.ts
 * @description Reads the frontmost macOS application so a transform can tell
 * the model *where* the selected text came from ("Slack" vs "Xcode" vs "Mail"
 * imply very different registers). Uses the same System Events/Accessibility
 * channel as the copy/paste keystrokes in `~/utils`, so it needs no extra
 * permission — but it must stay best-effort: a transform is far more useful
 * without app context than not at all, so every failure path returns null.
 */
import { exec } from "child_process";
import { logger } from "~/main/logging/logService";

export type ActiveApp = {
  name: string;
  /** Null for processes that report no bundle identifier (unbundled helpers). */
  bundleId: string | null;
};

/**
 * Bundle ids that are FixLang itself. `com.fixlang.app` is the packaged app
 * (see `~/main/update/homebrew`); `com.github.Electron` is what `bun run dev`
 * reports, which would otherwise leak "Electron" into every dev-run prompt.
 */
const OWN_BUNDLE_IDS = new Set(["com.fixlang.app", "com.github.Electron"]);

/**
 * Process names that are FixLang itself, for the case where System Events
 * reports no bundle identifier and the id check above cannot fire.
 */
const OWN_APP_NAMES = new Set(["fixlang", "electron"]);

/**
 * A real macOS app name is a handful of characters ("Google Chrome" is 13).
 * Anything past this is not usable context — it is a mangled read or a
 * process deliberately named to inject text into the prompt — so it is
 * dropped rather than truncated into something misleading.
 */
const MAX_APP_NAME_LENGTH = 64;

/**
 * osascript can hang when the frontmost process is unresponsive (a beachballed
 * app still answers System Events slowly). The hotkey flow already costs a
 * clipboard round-trip plus an AI call, so this budget only has to be short
 * enough that a hung read is invisible next to those.
 */
const ACTIVE_APP_TIMEOUT_MS = 1_500;

/** Cap on the raw System Events line echoed into a debug log on a dropped read. */
const RAW_LOG_LIMIT = 120;

/**
 * Parse the `name<TAB>bundle id` line the AppleScript prints, and reject
 * anything that is not usable context (empty, over-long, or FixLang itself).
 */
export const parseActiveApp = (stdout: string): ActiveApp | null => {
  const [rawName = "", rawBundleId = ""] = stdout.split("\t");

  // Control characters would break out of the prompt's context block, and
  // no real app name contains them.
  // eslint-disable-next-line no-control-regex -- stripping C0/C1 controls is the point
  const name = rawName.replace(/[\x00-\x1f\x7f-\x9f]/g, "").trim();
  const bundleId = rawBundleId.trim() || null;

  if (!name || name.length > MAX_APP_NAME_LENGTH) return null;
  if (bundleId && OWN_BUNDLE_IDS.has(bundleId)) return null;
  if (OWN_APP_NAMES.has(name.toLowerCase())) return null;

  return { name, bundleId };
};

const runFrontmostAppScript = (): Promise<string> =>
  new Promise((resolve, reject) => {
    // `application process whose frontmost is true` is the frontmost *app*,
    // not FixLang: a menu-bar app with no focusable window never becomes
    // frontmost, which is exactly why the same trick lets `getHighlightedText`
    // send ⌘C to the user's app.
    const script = `
      tell application "System Events"
        set frontApp to first application process whose frontmost is true
        return (name of frontApp) & tab & (bundle identifier of frontApp)
      end tell
    `;

    exec(
      `osascript -e '${script}'`,
      { timeout: ACTIVE_APP_TIMEOUT_MS },
      (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(stdout);
      },
    );
  });

/**
 * Debug-logs the outcome of a frontmost-app read: this is the only place
 * that says whether a request carried app context, and "context silently
 * missing" has no other symptom. On a drop, the raw line shows *why* (own
 * app, empty read, over-long name) — capped, since it is untrusted process
 * output.
 *
 * Shared by `getActiveApp` below and `~/utils`'s
 * `getHighlightedTextWithActiveApp` (the correction hotkey's combined
 * frontmost-app-read-then-copy), so both land in the same
 * `accessibility.activeApp` log scope regardless of which `osascript`
 * invocation produced the raw line.
 */
export const logActiveAppRead = (app: ActiveApp | null, rawStdout: string): void => {
  logger.debug(
    "accessibility.activeApp",
    app ? "Frontmost app read" : "Frontmost app not usable as context",
    app
      ? { app: app.name, bundleId: app.bundleId }
      : { raw: rawStdout.trim().slice(0, RAW_LOG_LIMIT) || null },
  );
};

/**
 * Best-effort read of the frontmost app. Returns null on non-darwin, on any
 * osascript failure (including a revoked Accessibility permission), and when
 * the frontmost app is FixLang itself.
 *
 * Call this *before* anything that can change focus (the overlay spinner, a
 * result window) — afterwards it reports FixLang and yields null.
 */
export const getActiveApp = async (): Promise<ActiveApp | null> => {
  if (process.platform !== "darwin") return null;

  try {
    const stdout = await runFrontmostAppScript();
    const app = parseActiveApp(stdout);

    logActiveAppRead(app, stdout);

    return app;
  } catch (error) {
    // Warn, not error, and never surfaced to the user: the request proceeds
    // without app context, and a permission problem that matters is already
    // reported by the ⌘C/⌘V paths in `~/utils`.
    logger.warn("accessibility.activeApp", "Failed to read the frontmost app", {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
};
