/**
 * @file comboCancel.ts
 * @description Cancel wrapper for a running combo (design C1-C4) plus the
 * profile-change abort hook (E5). `withComboCancel` is generic over
 * `(signal: AbortSignal) => Promise<T>` — it has no dependency on
 * `runCombo`'s shape or even its existence, so this file never imports
 * `comboFlow.ts`.
 *
 * `Control+Escape` is registered ONLY for the lifetime of this one run and
 * unregistered in `finally` (C3) — a chord held for the app's whole
 * lifetime would silently conflict with every other app, and nothing in
 * the UI would reveal FixLang is holding it. C2: a single press aborts
 * immediately, no double-tap or arm window; the `aborted` guard inside
 * `abort()` makes a second press (or a stray `abortActiveCombo()` call)
 * while already cancelling a no-op instead of calling `onCancelling` twice.
 *
 * `reloadHotkeys()` (`src/main/keybindings/index.ts`) calls
 * `globalShortcut.unregisterAll()` on every settings/preset/provider save,
 * which wipes EVERY accelerator process-wide, including whatever this file
 * registered for a run in flight.
 *
 * This USED to be noticed with a 1s poll of `globalShortcut.isRegistered`
 * that re-armed itself — deleted, on purpose, not merely simplified. Its own
 * cleanup (`clearInterval`) lived in the run's `finally`, so it only ran once
 * the wrapped run's promise SETTLED; a run stuck inside an unbounded `exec()`
 * (see `correction.ts`'s lock watchdog, which exists for exactly that
 * scenario) left the interval firing for the rest of the process's life,
 * holding a dead abort closure and re-claiming the chord seconds after a
 * LATER, unrelated run legitimately released it — a leaked, unownable timer
 * with no way to recover short of restarting the app. Worse, the poll fought
 * `pause-hotkeys` (`unregisterHotkeys()` alone, no re-register — deliberately
 * so `HotkeyInput` can capture a raw keypress the user is recording): within
 * its 1s window the poll re-claimed the chord anyway, so the capture never
 * saw the key AND the combo the user was leaving alone got aborted instead.
 *
 * `reloadHotkeys()` now calls `rearmCancelAcceleratorForActiveCombo()`
 * directly, synchronously, in the same tick it re-registers every other
 * accelerator — a push, not a poll, so there is no leaked timer and no
 * window where the chord is briefly missing. It must NEVER be called from a
 * bare `unregisterHotkeys()` (pause-hotkeys, app quit/close) — those
 * deliberately leave every accelerator, including this one, unregistered.
 */
import { globalShortcut } from "electron";
import { COMBO_CANCEL_ACCELERATOR } from "~/features/correction/shared/comboValidation";
import { logger } from "../logging/logService";

/**
 * The combo run currently in flight, if any, plus whether this module
 * currently believes it holds `Control+Escape` for it (mutated by
 * `rearmCancelAcceleratorForActiveCombo` too, so `withComboCancel`'s own
 * `finally` only unregisters a chord this module actually holds at the
 * time the run ends). At most one can be set at a time because
 * `comboLock.ts` refuses a second concurrent run at the hotkey-handler
 * boundary before a run ever reaches this module.
 */
type ActiveCombo = {
  abort: () => void;
  registered: boolean;
};

let activeCombo: ActiveCombo | undefined;

/**
 * Runs `run` with cancellation wired to `Control+Escape`. `onCancelling`
 * fires once, synchronously, before the signal is aborted, so a caller can
 * flip UI state (e.g. the overlay's `cancelling` ring) ahead of the run
 * actually unwinding.
 */
export const withComboCancel = async <T>(
  run: (signal: AbortSignal) => Promise<T>,
  onCancelling: () => void,
): Promise<T> => {
  const controller = new AbortController();

  const abort = (): void => {
    if (controller.signal.aborted) return;
    onCancelling();
    controller.abort();
  };

  // C4 — `register` returning false must not throw. The run proceeds
  // without a way to cancel it; see the R4 decision recorded on the board
  // for why this stays a log line rather than a user notification.
  const registered = globalShortcut.register(COMBO_CANCEL_ACCELERATOR, abort);
  if (!registered) {
    logger.warn(
      "combo.cancel",
      "Cancel accelerator unavailable, combo runs without cancel support",
      { accelerator: COMBO_CANCEL_ACCELERATOR },
    );
  }

  const combo: ActiveCombo = { abort, registered };
  activeCombo = combo;

  try {
    // Awaited inside this try (rather than returned directly) so a `run`
    // that throws synchronously — instead of returning a rejected promise —
    // still hits `finally` below and releases the chord and `activeCombo`.
    return await run(controller.signal);
  } finally {
    // F2 (board finding) — guarded, not unconditional: `withComboLock`'s
    // watchdog can free the lock while THIS run is still alive (stuck before
    // ever reaching this function, or stuck inside `run` past its own last
    // cancellation check), letting a later run start and overwrite
    // `activeCombo` with itself before this one's promise ever settles. An
    // unconditional clear here would then wipe the LATER run's entry and
    // unregister the chord it — not this run — currently holds, leaving it
    // silently uncancellable. Only release what this call actually owns.
    if (activeCombo === combo) {
      activeCombo = undefined;
      if (combo.registered) globalShortcut.unregister(COMBO_CANCEL_ACCELERATOR);
    }
  }
};

/**
 * Aborts whichever combo is currently running (E5 — a mid-run active
 * profile switch — and `correction.ts`'s lock watchdog, which calls this
 * before it rejects so a handler that outlives `COMBO_LOCK_MAX_HOLD_MS`
 * cannot free the lock while leaving the run itself still alive and free to
 * paste after the user was told it failed). A no-op when no combo is in
 * flight.
 */
export const abortActiveCombo = (): void => {
  activeCombo?.abort();
};

/**
 * Re-registers `Control+Escape` for whichever combo is currently in flight.
 * Called synchronously by `reloadHotkeys()` (`index.ts`) right after it
 * re-registers every other accelerator, so the chord this run was holding
 * before `unregisterAll()` wiped it comes back in the SAME tick — see the
 * file header for why this replaced a 1s poll. A no-op when no combo is
 * running. Does not throw when `register` fails (same C4 contract as the
 * initial registration above); `combo.registered` is updated either way so
 * `withComboCancel`'s `finally` reflects the outcome of this re-registration,
 * not the stale result of the original one.
 */
export const rearmCancelAcceleratorForActiveCombo = (): void => {
  if (!activeCombo) return;

  activeCombo.registered = globalShortcut.register(
    COMBO_CANCEL_ACCELERATOR,
    activeCombo.abort,
  );
  if (!activeCombo.registered) {
    logger.warn(
      "combo.cancel",
      "Cancel accelerator unavailable while re-arming after a hotkey reload",
      { accelerator: COMBO_CANCEL_ACCELERATOR },
    );
  }
};

/** Test-only: clears module state so a run left dangling by one test (e.g. a
 * deliberately-never-settling promise) cannot leak into the next. */
export const resetActiveComboForTests = (): void => {
  activeCombo = undefined;
};
