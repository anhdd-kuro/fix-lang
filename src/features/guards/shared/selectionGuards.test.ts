/**
 * @file selectionGuards.test.ts
 * @description Pins the selection-guard policy: precedence (denied app >
 * stale clipboard > oversized selection), the reselect-identical-text
 * regression guard (`changed: true` never blocks), and the boundary/allow
 * semantics for each rule.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_DENIED_BUNDLE_IDS, isBundleIdDenied } from "./guardSettings";
import { evaluateSelectionGuards } from "./selectionGuards";
import type { SelectionGuardSettings } from "./guardSettings";
import type { ActiveApp } from "~/main/accessibility/activeApp";
import type { ClipboardAge } from "~/main/clipboard/clipboardObserver";

const SETTINGS: SelectionGuardSettings = {
  clipboardMaxAgeSeconds: 5,
  maxSelectionChars: 20_000,
  deniedBundleIds: [...DEFAULT_DENIED_BUNDLE_IDS],
};

const app = (bundleId: string | null, name = "Some App"): ActiveApp => ({ name, bundleId });

/** A measured age — the clipboard was seen changing this long ago. */
const changedAgo = (ms: number): ClipboardAge => ({ ms, origin: "change" });

/** A lower bound — the text was already there when FixLang first looked. */
const seenAgo = (ms: number): ClipboardAge => ({ ms, origin: "baseline" });

const evaluate = (overrides: Partial<Parameters<typeof evaluateSelectionGuards>[0]>) =>
  evaluateSelectionGuards({
    text: "hello",
    changed: false,
    activeApp: null,
    age: null,
    settings: SETTINGS,
    ...overrides,
  });

describe("evaluateSelectionGuards — clipboard age", () => {
  it("never asks about age when changed is true, no matter how large the age is", () => {
    expect(
      evaluate({
        changed: true,
        age: changedAgo(0),
        settings: { ...SETTINGS, clipboardMaxAgeSeconds: 1 },
      }),
    ).toEqual({ kind: "allow" });
    expect(
      evaluate({
        changed: true,
        age: changedAgo(Number.MAX_SAFE_INTEGER),
        settings: { ...SETTINGS, clipboardMaxAgeSeconds: 1 },
      }),
    ).toEqual({ kind: "allow" });
  });

  /**
   * The regression guard for the startup hole: a baseline age is a LOWER
   * BOUND, so a value that has been on the pasteboard since before FixLang
   * launched reports a few milliseconds and would sail past any comparison
   * against the limit. Confirming a `0 ms` baseline is the whole point — if
   * this test ever reads "allow", the guard is disarmed for one limit-length
   * window after every start, which is exactly the case it exists to catch.
   */
  it("asks about a baseline age even when the number is far under the limit", () => {
    expect(evaluate({ changed: false, age: seenAgo(0) })).toEqual({
      kind: "confirm",
      reason: "unknown-clipboard-age",
      ageMs: 0,
      limitMs: 5_000,
    });
  });

  it("allows when nothing has been observed at all (age null fails open)", () => {
    expect(evaluate({ changed: false, age: null })).toEqual({ kind: "allow" });
  });

  it("allows at the exact age boundary and confirms one millisecond past it", () => {
    const settings: SelectionGuardSettings = { ...SETTINGS, clipboardMaxAgeSeconds: 5 };
    expect(evaluate({ changed: false, age: changedAgo(5_000), settings })).toEqual({
      kind: "allow",
    });
    expect(evaluate({ changed: false, age: changedAgo(5_001), settings })).toEqual({
      kind: "confirm",
      reason: "stale-clipboard",
      ageMs: 5_001,
      limitMs: 5_000,
    });
  });

  /**
   * CONFIRM, never BLOCK. An identical re-copy folds into "no change" (same
   * hash) and Electron exposes no pasteboard change counter, so a hard block
   * would leave a user who deliberately re-copies the same text unable to
   * clear it by doing the one thing that ought to clear it.
   */
  it("never returns a block verdict for either age reason", () => {
    expect(evaluate({ changed: false, age: changedAgo(999_999) }).kind).toBe("confirm");
    expect(evaluate({ changed: false, age: seenAgo(999_999) }).kind).toBe("confirm");
  });

  it("allows any age when the age limit is disabled (<= 0)", () => {
    const settings: SelectionGuardSettings = { ...SETTINGS, clipboardMaxAgeSeconds: 0 };
    expect(evaluate({ changed: false, age: changedAgo(999_999), settings })).toEqual({
      kind: "allow",
    });
    expect(evaluate({ changed: false, age: seenAgo(999_999), settings })).toEqual({
      kind: "allow",
    });
  });
});

describe("evaluateSelectionGuards — deny-list", () => {
  it("allows when activeApp is null", () => {
    expect(evaluate({ activeApp: null })).toEqual({ kind: "allow" });
  });

  it("allows when bundleId is null", () => {
    expect(evaluate({ activeApp: app(null) })).toEqual({ kind: "allow" });
  });

  it("is case and whitespace insensitive", () => {
    const settings: SelectionGuardSettings = {
      ...SETTINGS,
      deniedBundleIds: ["  Com.1Password.1Password  "],
    };
    expect(evaluate({ activeApp: app("com.1password.1password"), settings })).toEqual({
      kind: "block",
      reason: "denied-app",
      bundleId: "com.1password.1password",
    });
    expect(evaluate({ activeApp: app("  COM.1PASSWORD.1PASSWORD  "), settings })).toEqual({
      kind: "block",
      reason: "denied-app",
      bundleId: "com.1password.1password",
    });
  });

  it("allows an app not on the deny-list", () => {
    const settings: SelectionGuardSettings = { ...SETTINGS, deniedBundleIds: ["com.example.denied"] };
    expect(evaluate({ activeApp: app("com.example.allowed"), settings })).toEqual({ kind: "allow" });
  });

  it("agrees with the exported isBundleIdDenied predicate on a non-canonical bundle id", () => {
    const settings: SelectionGuardSettings = { ...SETTINGS, deniedBundleIds: ["com.foo.bar"] };
    const nonCanonical = "com.Foo.Bar ";

    expect(isBundleIdDenied(nonCanonical, settings.deniedBundleIds)).toBe(true);
    expect(evaluate({ activeApp: app(nonCanonical), settings })).toEqual({
      kind: "block",
      reason: "denied-app",
      bundleId: "com.foo.bar",
    });
  });
});

describe("evaluateSelectionGuards — size cap", () => {
  it("allows text at or under the limit", () => {
    const settings: SelectionGuardSettings = { ...SETTINGS, maxSelectionChars: 5 };
    expect(evaluate({ text: "hello", settings })).toEqual({ kind: "allow" });
  });

  it("confirms text over the limit", () => {
    const settings: SelectionGuardSettings = { ...SETTINGS, maxSelectionChars: 4 };
    expect(evaluate({ text: "hello", settings })).toEqual({
      kind: "confirm",
      reason: "large-selection",
      chars: 5,
      limit: 4,
    });
  });

  it("allows any length when the size cap is disabled (<= 0)", () => {
    const settings: SelectionGuardSettings = { ...SETTINGS, maxSelectionChars: 0 };
    expect(evaluate({ text: "x".repeat(50_000), settings })).toEqual({ kind: "allow" });
  });
});

describe("evaluateSelectionGuards — precedence", () => {
  it("denied app wins over a stale clipboard and an oversized selection", () => {
    const settings: SelectionGuardSettings = {
      clipboardMaxAgeSeconds: 5,
      maxSelectionChars: 4,
      deniedBundleIds: ["com.example.denied"],
    };
    expect(
      evaluate({
        text: "hello",
        changed: false,
        age: changedAgo(999_999),
        activeApp: app("com.example.denied"),
        settings,
      }),
    ).toEqual({ kind: "block", reason: "denied-app", bundleId: "com.example.denied" });
  });

  it("a stale clipboard wins over an oversized selection, so only ONE dialog is ever raised", () => {
    const settings: SelectionGuardSettings = {
      clipboardMaxAgeSeconds: 5,
      maxSelectionChars: 4,
      deniedBundleIds: [],
    };
    expect(
      evaluate({
        text: "hello",
        changed: false,
        age: changedAgo(999_999),
        activeApp: null,
        settings,
      }),
    ).toEqual({ kind: "confirm", reason: "stale-clipboard", ageMs: 999_999, limitMs: 5_000 });
  });
});
