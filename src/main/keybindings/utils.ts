import {
  AccessibilityPermissionError,
  LocalizedError,
  showErrorNotification,
} from "~/main/notifications/error";
import { promptAccessibilityPermission } from "~/utils";

/** Ignore a second press of the same accelerator inside this window. */
export const HOTKEY_THROTTLE_MS = 500;

const lastHotkeyInvokeAt = new Map<string, number>();

const acceleratorsInFlight = new Set<string>();

/**
 * Wraps a global-shortcut callback so a fast accidental double-press of the
 * same accelerator is ignored. Distinct accelerators do not block each other.
 * The first press inside the window always runs; later presses after the
 * window elapses run normally.
 *
 * The time window is not enough on its own. Nothing stops a user binding
 * Command+C to a preset (`validateHotkeys` keeps no reserved-system-key list),
 * and the handler synthesizes ⌘C itself — behind `getActiveApp()` plus the AX
 * selection read, whose combined timeouts exceed `HOTKEY_THROTTLE_MS` several
 * times over. A synthesized press landing outside the window would re-enter the
 * handler and fire another provider request, once per iteration. The in-flight
 * set refuses re-entry for as long as a run is unfinished, which makes that
 * recursion impossible whatever the timing, and also stops a second press from
 * starting a parallel transform while a slow provider is still answering.
 *
 * Kept per-accelerator, matching the timestamp map: the recursion above is
 * necessarily same-accelerator (only a ⌘C binding can be re-triggered by a
 * synthesized ⌘C), and a process-wide flag would let one slow transform block
 * an unrelated binding such as profile switch.
 */
export const withHotkeyThrottle = (
  accelerator: string,
  handler: () => void | Promise<void>,
  now: () => number = Date.now,
): (() => void | Promise<void>) => {
  return () => {
    const at = now();
    const last = lastHotkeyInvokeAt.get(accelerator) ?? 0;
    if (at - last < HOTKEY_THROTTLE_MS) {
      return;
    }
    if (acceleratorsInFlight.has(accelerator)) {
      return;
    }
    lastHotkeyInvokeAt.set(accelerator, at);
    acceleratorsInFlight.add(accelerator);

    // Released on every exit path — synchronous return, synchronous throw,
    // resolution and rejection alike. A leaked entry would kill the hotkey
    // until the app restarts, which is worse than the recursion it prevents.
    const releaseAccelerator = () => {
      acceleratorsInFlight.delete(accelerator);
    };

    try {
      const running = handler();
      if (running instanceof Promise) {
        return running.finally(releaseAccelerator);
      }
      releaseAccelerator();
      return running;
    } catch (error) {
      releaseAccelerator();
      throw error;
    }
  };
};

/** Clears throttle timestamps and in-flight state between tests. */
export const resetHotkeyThrottleForTests = (): void => {
  lastHotkeyInvokeAt.clear();
  acceleratorsInFlight.clear();
};

export const checkShortcut = (shortcut: boolean) => {
  if (!shortcut) {
    console.error(`Shortcut ${shortcut} is not set in settings.`);
    handleError(
      new LocalizedError(
        `Shortcut ${shortcut} is not set in settings.`,
        "notifications.error.hotkeyRegistrationFailed.body",
      ),
    );
    return false;
  }
  console.log(`Global shortcut ${shortcut} registered successfully.`);
  return true;
};

export const handleError = (error: unknown) => {
  console.error("Error during grammar fixing or IPC send:", error);
  // No explicit fallback: `showErrorNotification` reads a localized default
  // (`notifications.error.body`) via `mainT()` at call time. The previous
  // hardcoded English literal here ("Failed to correct text...") both broke
  // localization for non-Error values *and* was wrong for three of
  // `handleError`'s four call sites — it's shared by correction, PromptGen,
  // profile-switch, and hotkey-registration failures, not just correction.
  showErrorNotification(error);

  // A mid-session Accessibility revocation (e.g. after an unsigned-app
  // update changes the code identity) is otherwise only ever surfaced as a
  // desktop notification — easy to miss, and the log shows desktop
  // notifications can *also* fail in this exact state (`UNErrorDomain error
  // 1`). Also prompt the actionable dialog so the user has a real path to
  // fixing it. `promptAccessibilityPermission` throttles itself, so a burst
  // of repeated hotkey failures shows at most one dialog.
  if (error instanceof AccessibilityPermissionError) {
    void promptAccessibilityPermission();
  }
};
