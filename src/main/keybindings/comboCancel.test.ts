/**
 * @file comboCancel.test.ts
 * @description C1-C4 — `Control+Escape` cancels a running combo in one
 * press. The accelerator is registered only for the lifetime of one
 * `withComboCancel` call and unregistered in `finally`, on both the resolve
 * and reject paths (C3); `globalShortcut.register` returning `false` logs a
 * warn and lets the run continue without cancel instead of throwing (C4);
 * and `abortActiveCombo()` — the hook `profileChange.ts` calls on E5, and
 * `correction.ts`'s lock watchdog calls before it rejects — aborts whichever
 * run is currently in flight.
 */
import { globalShortcut } from "electron";
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("electron", () => ({
  globalShortcut: { register: vi.fn(), unregister: vi.fn() },
}));
vi.mock("../logging/logService", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
import { COMBO_CANCEL_ACCELERATOR } from "~/features/correction/shared/comboValidation";
import {
  abortActiveCombo,
  rearmCancelAcceleratorForActiveCombo,
  resetActiveComboForTests,
  withComboCancel,
} from "./comboCancel";
import { logger } from "../logging/logService";

const mockRegister = globalShortcut.register as ReturnType<typeof vi.fn>;
const mockUnregister = globalShortcut.unregister as ReturnType<typeof vi.fn>;

describe("withComboCancel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRegister.mockReturnValue(true);
    resetActiveComboForTests();
  });

  it("registers Control+Escape once and unregisters it once on the resolve path", async () => {
    const result = await withComboCancel(async () => "done", vi.fn());

    expect(result).toBe("done");
    expect(mockRegister).toHaveBeenCalledTimes(1);
    expect(mockRegister).toHaveBeenCalledWith(COMBO_CANCEL_ACCELERATOR, expect.any(Function));
    expect(mockUnregister).toHaveBeenCalledTimes(1);
    expect(mockUnregister).toHaveBeenCalledWith(COMBO_CANCEL_ACCELERATOR);
  });

  it("registers once and unregisters exactly once when the run rejects", async () => {
    await expect(
      withComboCancel(async () => {
        throw new Error("boom");
      }, vi.fn()),
    ).rejects.toThrow("boom");

    expect(mockRegister).toHaveBeenCalledTimes(1);
    expect(mockUnregister).toHaveBeenCalledTimes(1);
  });

  it("a single press aborts the signal and calls onCancelling exactly once, even if pressed twice", async () => {
    const onCancelling = vi.fn();
    const runPromise = withComboCancel(
      (signal) =>
        new Promise((resolve) => {
          signal.addEventListener("abort", () => resolve("cancelled"));
        }),
      onCancelling,
    );

    const pressHandler = mockRegister.mock.calls[0][1] as () => void;
    pressHandler();
    pressHandler();

    await expect(runPromise).resolves.toBe("cancelled");
    expect(onCancelling).toHaveBeenCalledTimes(1);
  });

  it("does not throw when register returns false, logs a warn, and the run continues without cancel", async () => {
    mockRegister.mockReturnValue(false);

    const result = await withComboCancel(async () => "done-anyway", vi.fn());

    expect(result).toBe("done-anyway");
    expect(logger.warn).toHaveBeenCalledWith(
      "combo.cancel",
      expect.any(String),
      expect.objectContaining({ accelerator: COMBO_CANCEL_ACCELERATOR }),
    );
    // Nothing was ever registered, so there is nothing to unregister.
    expect(mockUnregister).not.toHaveBeenCalled();
  });

  it("abortActiveCombo cancels whichever combo is currently running", async () => {
    const onCancelling = vi.fn();
    const runPromise = withComboCancel(
      (signal) =>
        new Promise((resolve) => {
          signal.addEventListener("abort", () => resolve("done"));
        }),
      onCancelling,
    );

    abortActiveCombo();

    await expect(runPromise).resolves.toBe("done");
    expect(onCancelling).toHaveBeenCalledTimes(1);
  });

  it("abortActiveCombo is a no-op when no combo is running", () => {
    expect(() => abortActiveCombo()).not.toThrow();
  });

  it("clears the active-abort registration once a run finishes, so a stray later call cannot reach it", async () => {
    const onCancelling = vi.fn();
    await withComboCancel(async () => "done", onCancelling);

    abortActiveCombo();

    expect(onCancelling).not.toHaveBeenCalled();
  });

  it("cleans up the chord and activeCombo when the run callback throws synchronously instead of returning a promise", async () => {
    // buildComboRunDependencies() is evaluated as an argument before runCombo
    // is entered and can throw synchronously (e.g. a corrupt electron-store
    // read) — the callback passed here reproduces that: it throws before ever
    // producing a promise, instead of rejecting one.
    const throwingRun = vi.fn(() => {
      throw new Error("sync boom");
    }) as unknown as (signal: AbortSignal) => Promise<string>;

    await expect(withComboCancel(throwingRun, vi.fn())).rejects.toThrow("sync boom");

    expect(mockUnregister).toHaveBeenCalledTimes(1);
    expect(mockUnregister).toHaveBeenCalledWith(COMBO_CANCEL_ACCELERATOR);

    // activeCombo must be cleared too, or a later profile switch would abort
    // the dead run's controller forever instead of ever reaching a real one.
    // Prove it by starting a genuine next run and confirming abortActiveCombo
    // reaches THIS run, not a stale reference left over from the throw.
    const onCancelling = vi.fn();
    const nextRun = withComboCancel(
      (signal) =>
        new Promise((resolve) => {
          signal.addEventListener("abort", () => resolve("cancelled"));
        }),
      onCancelling,
    );
    abortActiveCombo();
    await expect(nextRun).resolves.toBe("cancelled");
    expect(onCancelling).toHaveBeenCalledTimes(1);
  });

  // Finding B (board): the old implementation noticed an external
  // `unregisterAll()` with a 1s `setInterval` poll, cleared only in the
  // run's own `finally`. A run that never settles (a wedged `exec()`; see
  // `correction.ts`'s lock watchdog) therefore leaked that interval for the
  // rest of the process's life, holding a dead abort closure and re-claiming
  // the chord out from under a later, unrelated run. Deleting the poll
  // entirely — not just fixing its cleanup — is the fix: there is no timer
  // here to ever leak.
  it("never starts an interval timer, even across a run that never settles — nothing left to leak", () => {
    const setIntervalSpy = vi.spyOn(globalThis, "setInterval");

    // Fire-and-forget on purpose: this run never resolves or rejects, the
    // exact shape of the hang `correction.ts`'s lock watchdog exists for.
    void withComboCancel(() => new Promise(() => undefined), vi.fn());

    expect(setIntervalSpy).not.toHaveBeenCalled();
    setIntervalSpy.mockRestore();
  });

  // F2 (board finding, second branch): `withComboLock`'s watchdog can free
  // the lock while a run is still alive (stuck before ever reaching this
  // module, or stuck past its own last cancellation check), letting a
  // second run start and become `activeCombo` before the first run's
  // promise ever settles. The first run's `finally` must not then clobber
  // the second run's registration.
  it("a stale run's finally does not clear a later run's activeCombo or unregister its chord", async () => {
    let resolveStaleRun: ((value: string) => void) | undefined;
    const staleRun = withComboCancel(
      () =>
        new Promise<string>((resolve) => {
          resolveStaleRun = resolve;
        }),
      vi.fn(),
    );
    expect(mockRegister).toHaveBeenCalledTimes(1);

    // A later run starts — mirroring `withComboLock`'s watchdog freeing the
    // lock while the run above is still alive — and becomes `activeCombo`.
    const onCancellingLater = vi.fn();
    const laterRun = withComboCancel(
      (signal) =>
        new Promise((resolve) => {
          signal.addEventListener("abort", () => resolve("cancelled-later"));
        }),
      onCancellingLater,
    );
    expect(mockRegister).toHaveBeenCalledTimes(2);

    // The stale run's underlying work finally settles (e.g. a wedged exec()
    // un-wedges) well after it was abandoned.
    resolveStaleRun?.("done-stale");
    await staleRun;

    // Without the fix, the stale run's `finally` would have cleared
    // `activeCombo` and unregistered the chord, making the later run
    // silently uncancellable — `abortActiveCombo()` would be a no-op and
    // this would hang forever.
    abortActiveCombo();
    await expect(laterRun).resolves.toBe("cancelled-later");
    expect(onCancellingLater).toHaveBeenCalledTimes(1);
    // The chord is only unregistered once — by the later run's own
    // `finally` — not twice (stale run's unconditional clear, pre-fix,
    // would have called it once too, but for the WRONG run).
    expect(mockUnregister).toHaveBeenCalledTimes(1);
  });

  describe("rearmCancelAcceleratorForActiveCombo", () => {
    it("is a no-op when no combo is running", () => {
      expect(() => rearmCancelAcceleratorForActiveCombo()).not.toThrow();
      expect(mockRegister).not.toHaveBeenCalled();
    });

    it("re-registers Control+Escape for the run currently in flight, and the re-armed handler still cancels it", async () => {
      const runPromise = withComboCancel(
        (signal) =>
          new Promise((resolve) => {
            signal.addEventListener("abort", () => resolve("cancelled-via-rearmed-chord"));
          }),
        vi.fn(),
      );

      expect(mockRegister).toHaveBeenCalledTimes(1);

      // Simulate reloadHotkeys() -> globalShortcut.unregisterAll() wiping
      // every accelerator, then re-registering everything else, then calling
      // this — all synchronously, in the same tick, unlike the deleted poll.
      rearmCancelAcceleratorForActiveCombo();

      expect(mockRegister).toHaveBeenCalledTimes(2);
      const secondPressHandler = mockRegister.mock.calls[1][1] as () => void;
      secondPressHandler();

      await expect(runPromise).resolves.toBe("cancelled-via-rearmed-chord");
    });

    it("logs a warn and does not throw when the re-registration itself fails", async () => {
      const runPromise = withComboCancel(
        (signal) =>
          new Promise((resolve) => {
            signal.addEventListener("abort", () => resolve("done"));
          }),
        vi.fn(),
      );

      mockRegister.mockReturnValue(false);
      expect(() => rearmCancelAcceleratorForActiveCombo()).not.toThrow();

      expect(logger.warn).toHaveBeenCalledWith(
        "combo.cancel",
        expect.stringContaining("re-arming"),
        expect.objectContaining({ accelerator: COMBO_CANCEL_ACCELERATOR }),
      );

      // The failed re-registration must not be unregistered later — this run
      // never held the chord after the rearm, so `withComboCancel`'s
      // `finally` has nothing of its own to free.
      abortActiveCombo();
      await runPromise;
      expect(mockUnregister).not.toHaveBeenCalled();
    });
  });
});
