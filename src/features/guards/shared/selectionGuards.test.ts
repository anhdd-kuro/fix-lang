/**
 * @file selectionGuards.test.ts
 * @description Pins the selection-guard policy: precedence (denied app >
 * oversized selection) and the boundary/allow semantics for each rule.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_DENIED_BUNDLE_IDS, isBundleIdDenied } from "./guardSettings";
import { evaluateSelectionGuards } from "./selectionGuards";
import type { SelectionGuardSettings } from "./guardSettings";
import type { ActiveApp } from "~/main/accessibility/activeApp";

const SETTINGS: SelectionGuardSettings = {
  maxSelectionChars: 20_000,
  deniedBundleIds: [...DEFAULT_DENIED_BUNDLE_IDS],
};

const app = (bundleId: string | null, name = "Some App"): ActiveApp => ({
  name,
  bundleId,
});

const evaluate = (
  overrides: Partial<Parameters<typeof evaluateSelectionGuards>[0]>,
) =>
  evaluateSelectionGuards({
    text: "hello",
    activeApp: null,
    settings: SETTINGS,
    ...overrides,
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
    expect(
      evaluate({ activeApp: app("com.1password.1password"), settings }),
    ).toEqual({
      kind: "block",
      reason: "denied-app",
      bundleId: "com.1password.1password",
    });
    expect(
      evaluate({ activeApp: app("  COM.1PASSWORD.1PASSWORD  "), settings }),
    ).toEqual({
      kind: "block",
      reason: "denied-app",
      bundleId: "com.1password.1password",
    });
  });

  it("allows an app not on the deny-list", () => {
    const settings: SelectionGuardSettings = {
      ...SETTINGS,
      deniedBundleIds: ["com.example.denied"],
    };
    expect(
      evaluate({ activeApp: app("com.example.allowed"), settings }),
    ).toEqual({ kind: "allow" });
  });

  it("agrees with the exported isBundleIdDenied predicate on a non-canonical bundle id", () => {
    const settings: SelectionGuardSettings = {
      ...SETTINGS,
      deniedBundleIds: ["com.foo.bar"],
    };
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
    const settings: SelectionGuardSettings = {
      ...SETTINGS,
      maxSelectionChars: 5,
    };
    expect(evaluate({ text: "hello", settings })).toEqual({ kind: "allow" });
  });

  it("confirms text over the limit", () => {
    const settings: SelectionGuardSettings = {
      ...SETTINGS,
      maxSelectionChars: 4,
    };
    expect(evaluate({ text: "hello", settings })).toEqual({
      kind: "confirm",
      reason: "large-selection",
      chars: 5,
      limit: 4,
    });
  });

  it("allows any length when the size cap is disabled (<= 0)", () => {
    const settings: SelectionGuardSettings = {
      ...SETTINGS,
      maxSelectionChars: 0,
    };
    expect(evaluate({ text: "x".repeat(50_000), settings })).toEqual({
      kind: "allow",
    });
  });
});

describe("evaluateSelectionGuards — precedence", () => {
  it("denied app wins over an oversized selection", () => {
    const settings: SelectionGuardSettings = {
      maxSelectionChars: 4,
      deniedBundleIds: ["com.example.denied"],
    };
    expect(
      evaluate({
        text: "hello",
        activeApp: app("com.example.denied"),
        settings,
      }),
    ).toEqual({
      kind: "block",
      reason: "denied-app",
      bundleId: "com.example.denied",
    });
  });
});
