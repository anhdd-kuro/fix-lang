/**
 * @file clipboardObserver.test.ts
 * @description `createClipboardObserver` is pure and electron-free, so every
 * test here passes an explicit `at` on every call and uses NO timers at all
 * — no `vi.useFakeTimers()`, no `Date` mocking. That sidesteps the trap that
 * `clipboardChangeTracker.test.ts` has to guard against explicitly: with
 * fake timers, excluding `Date` from the faked set leaves the interval
 * firing while `Date.now()` never advances, so every age reads `0` and the
 * test passes while proving nothing (the same class of failure as the
 * autocomplete cache-eviction test elsewhere in this repo). Passing `at`
 * directly removes the clock from the picture entirely.
 */
import { describe, expect, it } from "vitest";
import { createClipboardObserver } from "./clipboardObserver";

describe("createClipboardObserver", () => {
  it("leaves ageMs() null (not 0) after the very first observation", () => {
    const observer = createClipboardObserver();

    observer.observe("first sighting", 1_000);

    expect(observer.ageMs(1_000)).toBeNull();
    expect(observer.ageMs(50_000)).toBeNull();
    expect(observer.snapshot()).toEqual({
      length: "first sighting".length,
      hasBaseline: true,
      lastChangedAt: null,
    });
  });

  it("registers two different strings of the SAME length as a change", () => {
    const observer = createClipboardObserver();

    observer.observe("aaaaaaaa", 1_000); // baseline, 8 chars
    observer.observe("bbbbbbbb", 2_000); // different text, same length — must still count

    const snapshot = observer.snapshot();
    expect(snapshot.lastChangedAt).toBe(2_000);
    expect(snapshot.length).toBe(8);
    expect(observer.ageMs(2_500)).toBe(500);
  });

  it("does not register a re-observation of the identical text as a change", () => {
    const observer = createClipboardObserver();

    observer.observe("steady", 1_000); // baseline
    observer.observe("steady", 5_000); // same text again — reselecting identical text

    expect(observer.snapshot().lastChangedAt).toBeNull();
    expect(observer.ageMs(5_000)).toBeNull();
  });

  it("ignores observe() entirely while suspended", () => {
    const observer = createClipboardObserver();

    observer.observe("before-suspend", 1_000); // baseline
    observer.observe("second", 2_000); // real change, lastChangedAt = 2000

    observer.suspend();
    observer.observe("would-be-a-change-if-not-suspended", 3_000);

    expect(observer.snapshot().lastChangedAt).toBe(2_000);
  });

  it("resume(sameText) re-baselines without moving lastChangedAt; resume(differentText) does move it", () => {
    const observer = createClipboardObserver();

    observer.observe("original", 1_000); // baseline
    observer.observe("changed-once", 2_000); // lastChangedAt = 2000

    observer.suspend();
    observer.resume("changed-once", 9_000); // restored exactly what was there
    expect(observer.snapshot().lastChangedAt).toBe(2_000);

    observer.suspend();
    observer.resume("something-else-wrote-here", 9_500); // genuinely different
    expect(observer.snapshot().lastChangedAt).toBe(9_500);
  });

  it("does not let a nested inner resume fold while the outer suspend window is still open", () => {
    const observer = createClipboardObserver();

    observer.observe("initial", 0); // baseline
    observer.observe("real-change", 1_000); // lastChangedAt = 1000, the last genuine user change

    // Ten minutes later, two overlapping self-managed windows open — e.g. two
    // different preset hotkeys whose restore writes race each other.
    observer.suspend(); // outer window opens, depth = 1
    observer.suspend(); // inner window opens, depth = 2

    // Inner window closes first, restoring text that does NOT match the
    // pre-suspend baseline ("real-change"). Depth drops to 1, which is still
    // > 0, so this must NOT fold — the outer window is still open and owns
    // the change/no-change decision.
    observer.resume("inner-window-snapshot", 601_000);
    expect(observer.snapshot().lastChangedAt).toBe(1_000);
    expect(observer.ageMs(601_000)).toBe(600_000);

    // Outer window closes, restoring exactly what was there before either
    // window opened. Depth reaches 0, so this DOES fold, and it matches the
    // baseline, so lastChangedAt still must not move.
    observer.resume("real-change", 601_500);
    expect(observer.snapshot().lastChangedAt).toBe(1_000);
    expect(observer.ageMs(601_500)).toBe(600_500);
  });

  it("never exposes the observed text from snapshot()", () => {
    const observer = createClipboardObserver();
    const secret = "sk-super-secret-value-should-never-appear";

    observer.observe(secret, 1_000);
    observer.observe(secret + "x", 2_000);
    observer.suspend();
    observer.resume(secret, 3_000);

    const dump = JSON.stringify(observer.snapshot());
    expect(dump).not.toContain(secret);
    expect(Object.keys(observer.snapshot()).sort()).toEqual(["hasBaseline", "lastChangedAt", "length"]);
  });
});
