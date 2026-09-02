/**
 * @file comboLock.ts
 * @description Process-wide single-combo lock (E10). `withHotkeyThrottle`
 * only debounces repeats of the SAME accelerator, so two different combo
 * hotkeys pressed together would otherwise both run, racing to paste or
 * show a popup over the same cursor.
 *
 * Ownership trap (R2, do not relitigate): this lock has to be acquired at
 * the HOTKEY-HANDLER boundary, above the selection read — the caller must
 * wrap the whole handler body (selection read, spinner, run) in
 * `withComboLock`, not just the run itself. By the time a hypothetical lock
 * inside `runCombo` would be reached, a second press has already read the
 * selection and shown its own spinner; refusing at that point is too late.
 * This module therefore knows nothing about combos, presets, or `runCombo`
 * — it is a plain mutex any caller can wrap a handler in.
 */

let locked = false;

/** Thrown by `withComboLock` when a combo is already running. */
export class ComboLockBusyError extends Error {
  public constructor() {
    super("A combo is already running");
    this.name = "ComboLockBusyError";
  }
}

/**
 * Runs `body` only if no other `withComboLock` call is currently in
 * flight. Throws `ComboLockBusyError` synchronously (before `body` is ever
 * invoked) when the lock is already held. Released in `finally`, so a
 * rejecting or throwing `body` still frees the lock for the next caller.
 */
export const withComboLock = async <T>(body: () => Promise<T>): Promise<T> => {
  if (locked) {
    throw new ComboLockBusyError();
  }

  locked = true;
  try {
    return await body();
  } finally {
    locked = false;
  }
};

/** Test-only: resets lock state so tests do not leak into one another. */
export const resetComboLockForTests = (): void => {
  locked = false;
};
