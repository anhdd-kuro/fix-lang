/**
 * @file comboLock.test.ts
 * @description E10 — a process-wide single-combo lock. `withHotkeyThrottle`
 * only debounces repeats of the SAME accelerator, so two different combo
 * hotkeys pressed close together are not mutually exclusive without this
 * module. This file proves the lock refuses a second concurrent invocation
 * (only one body ever runs) and that it releases on the failure path so a
 * later run is not stuck locked out forever.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ComboLockBusyError, resetComboLockForTests, withComboLock } from "./comboLock";

describe("withComboLock", () => {
  beforeEach(() => {
    resetComboLockForTests();
  });

  it("runs the body and resolves with its result when nothing else is running", async () => {
    const body = vi.fn().mockResolvedValue("result");

    await expect(withComboLock(body)).resolves.toBe("result");
    expect(body).toHaveBeenCalledTimes(1);
  });

  it("refuses a second lock-wrapped invocation started while the first is still running — only one body executes", async () => {
    let resolveFirst: (value: string) => void = () => undefined;
    const bodyA = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveFirst = resolve;
        }),
    );
    const bodyB = vi.fn().mockResolvedValue("second");

    const runA = withComboLock(bodyA);
    // Synchronous: the lock is acquired before withComboLock's first await,
    // so this rejects immediately without ever invoking bodyB.
    await expect(withComboLock(bodyB)).rejects.toThrow(ComboLockBusyError);
    expect(bodyB).not.toHaveBeenCalled();

    resolveFirst("first");
    await expect(runA).resolves.toBe("first");
    expect(bodyA).toHaveBeenCalledTimes(1);
  });

  it("releases the lock on the failure path so a later run can proceed", async () => {
    const failing = vi.fn().mockRejectedValue(new Error("boom"));

    await expect(withComboLock(failing)).rejects.toThrow("boom");

    const next = vi.fn().mockResolvedValue("ok");
    await expect(withComboLock(next)).resolves.toBe("ok");
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("releases the lock on the success path so a later run is not refused", async () => {
    await withComboLock(async () => "first");

    const next = vi.fn().mockResolvedValue("second");
    await expect(withComboLock(next)).resolves.toBe("second");
  });

  it("allows a new invocation to acquire the lock once the busy one is refused and settled", async () => {
    let resolveFirst: (value: string) => void = () => undefined;
    const runA = withComboLock(
      () =>
        new Promise<string>((resolve) => {
          resolveFirst = resolve;
        }),
    );

    await expect(withComboLock(vi.fn())).rejects.toThrow(ComboLockBusyError);

    resolveFirst("done");
    await runA;

    await expect(withComboLock(async () => "third")).resolves.toBe("third");
  });
});
