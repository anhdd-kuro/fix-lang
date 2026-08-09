/**
 * @file clipboardChangeTracker.ts
 * @description Electron driver around the pure `clipboardObserver`. A
 * module-level singleton (there is exactly one system clipboard) that polls
 * `clipboard.readText()` at `CLIPBOARD_TRACK_INTERVAL_MS` and folds the
 * result into the observer, so `ageMs()` can be asked at any moment without
 * this module ever holding the clipboard text itself.
 *
 * Three behaviours are load-bearing, not incidental:
 *
 * - **The interval is never scheduled when the guard is off**
 *   (`clipboardMaxAgeSeconds === 0`). That is the direct answer to the macOS
 *   pasteboard-privacy-indicator concern (a background poll lights the
 *   indicator every second) — it is not an optimization, it is the point.
 * - **Ticks are skipped entirely during a self-managed read/write window**
 *   (`beginSelfManagedRead` / `endSelfManagedRead`), so the clipboard
 *   restore write `src/utils.ts` performs in its `finally` can never be
 *   miscounted by a concurrent poll as a user copy.
 * - **`powerMonitor` suspend/resume pauses and re-arms the interval without
 *   touching `lastChangedAt`.** A laptop asleep 8 hours genuinely has an
 *   8-hour-old clipboard; the fix is to stop polling during the sleep, not
 *   to reset the clock on wake.
 *
 * If the macOS indicator ever proves visible even at 1 Hz, the documented
 * fallback is observation-only: delete the interval (and the powerMonitor
 * wiring) and keep folding in whatever `observeNow` already receives for
 * free from `utils.ts`'s existing pre-copy `clipboard.readText()` call. The
 * API is shaped so that fallback is a deletion, not a rewrite.
 */
import { clipboard, powerMonitor } from "electron";
import { createClipboardObserver } from "./clipboardObserver";
import type { SelectionGuardSettings } from "~/features/guards/shared/guardSettings";

export const CLIPBOARD_TRACK_INTERVAL_MS = 1_000;

const observer = createClipboardObserver();

let intervalHandle: ReturnType<typeof setInterval> | null = null;
let maxAgeSeconds = 0;
let selfManagedDepth = 0;
let powerMonitorWired = false;

const clearIntervalIfRunning = (): void => {
  if (intervalHandle === null) return;
  clearInterval(intervalHandle);
  intervalHandle = null;
};

const tick = (): void => {
  if (selfManagedDepth > 0) return;
  observer.observe(clipboard.readText());
};

const armIntervalIfNeeded = (): void => {
  if (intervalHandle !== null) return;
  // Not redundant with applySettings()'s own early return: start() and the
  // powerMonitor "resume" handler call this directly, bypassing that guard,
  // so this is the only check standing between them and a scheduled poll
  // while the guard is off (see "start() alone…" in the test file).
  if (maxAgeSeconds <= 0) return;
  intervalHandle = setInterval(tick, CLIPBOARD_TRACK_INTERVAL_MS);
};

const wirePowerMonitorOnce = (): void => {
  if (powerMonitorWired) return;
  powerMonitorWired = true;
  // System sleep, not a self-managed read: pause the poll entirely rather
  // than let it fire on a machine that is not actually running.
  powerMonitor.on("suspend", () => {
    clearIntervalIfRunning();
  });
  // Deliberately does NOT touch the observer — re-arming must not move
  // `lastChangedAt`, so an 8-hour sleep reports an 8-hour-old clipboard.
  powerMonitor.on("resume", () => {
    armIntervalIfNeeded();
  });
};

/** Starts (or stops) the 1 Hz poll to match the current guard settings. */
export const applySettings = (settings: SelectionGuardSettings): void => {
  maxAgeSeconds = settings.clipboardMaxAgeSeconds;
  wirePowerMonitorOnce();
  if (maxAgeSeconds <= 0) {
    clearIntervalIfRunning();
    return;
  }
  armIntervalIfNeeded();
};

export const start = (): void => {
  wirePowerMonitorOnce();
  armIntervalIfNeeded();
};

export const stop = (): void => {
  clearIntervalIfRunning();
};

/** Milliseconds since the last observed clipboard CHANGE, or `null` if none has been observed. */
export const ageMs = (): number | null => observer.ageMs();

/**
 * Folds in a clipboard read the caller already performed for another
 * reason (e.g. the pre-copy snapshot in `utils.ts`) — free, no extra
 * pasteboard access.
 */
export const observeNow = (text: string): void => {
  observer.observe(text);
};

/** Opens a window during which the poll must not read the clipboard at all. */
export const beginSelfManagedRead = (): void => {
  selfManagedDepth += 1;
  observer.suspend();
};

/**
 * Closes the window opened by `beginSelfManagedRead`, folding in the text
 * that was written back. Re-baselines without moving `lastChangedAt` when
 * it matches what was there before (the normal restore case); records a
 * real change when it does not (something else wrote during the window).
 */
export const endSelfManagedRead = (restoredText: string): void => {
  selfManagedDepth = Math.max(0, selfManagedDepth - 1);
  observer.resume(restoredText);
};
