/**
 * @file guardSettings.edgeInputs.test.ts
 * @description Pins `normalizeSelectionGuardSettings` on inputs a JSON store
 * cannot produce but a test or a future caller could: non-object roots,
 * boxed and non-finite numbers, `-0`, huge numbers, inherited and
 * null-prototype fields, extra keys, sparse deny-lists and boxed entries.
 * Every junk value must land on its DEFAULT, never on `0` or an empty list.
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_CLIPBOARD_MAX_AGE_SECONDS,
  DEFAULT_DENIED_BUNDLE_IDS,
  DEFAULT_MAX_SELECTION_CHARS,
  MAX_DENIED_BUNDLE_IDS,
  normalizeSelectionGuardSettings,
} from "./guardSettings";

const DEFAULTS = {
  clipboardMaxAgeSeconds: DEFAULT_CLIPBOARD_MAX_AGE_SECONDS,
  maxSelectionChars: DEFAULT_MAX_SELECTION_CHARS,
  deniedBundleIds: [...DEFAULT_DENIED_BUNDLE_IDS],
};

describe("normalizeSelectionGuardSettings — non-object roots", () => {
  it.each([
    ["null", null],
    ["a string", "settings"],
    ["a number", 5],
    ["NaN", Number.NaN],
    ["true", true],
    ["an empty array", []],
    ["a function", () => 5],
    ["a boxed string", new String("x")],
    ["a Date", new Date(0)],
  ])("%s normalizes to fresh defaults", (_label, raw) => {
    const normalized = normalizeSelectionGuardSettings(raw);
    expect(normalized).toEqual(DEFAULTS);
    expect(normalized.deniedBundleIds).not.toBe(DEFAULT_DENIED_BUNDLE_IDS);
  });
});

describe("normalizeSelectionGuardSettings — numeric edge values", () => {
  it.each([
    ["a boxed number", new Number(9)],
    ["-Infinity", Number.NEGATIVE_INFINITY],
    ["a bigint", 9n],
  ])("%s falls back to the default", (_label, junk) => {
    expect(
      normalizeSelectionGuardSettings({
        clipboardMaxAgeSeconds: junk,
        maxSelectionChars: junk,
      }),
    ).toEqual(DEFAULTS);
  });

  it("-0 normalizes to +0, and a huge number survives", () => {
    const normalized = normalizeSelectionGuardSettings({
      clipboardMaxAgeSeconds: -0,
      maxSelectionChars: 1e20,
    });
    expect(Object.is(normalized.clipboardMaxAgeSeconds, 0)).toBe(true);
    expect(normalized.maxSelectionChars).toBe(1e20);
  });

  it("a tiny negative fraction clamps to 0, not to the default", () => {
    expect(
      normalizeSelectionGuardSettings({ clipboardMaxAgeSeconds: -0.5 })
        .clipboardMaxAgeSeconds,
    ).toBe(0);
  });
});

describe("normalizeSelectionGuardSettings — object shapes", () => {
  it("reads inherited and null-prototype fields", () => {
    const inherited = Object.assign(
      Object.create({ clipboardMaxAgeSeconds: 7 }),
      { maxSelectionChars: 9 },
    );
    expect(normalizeSelectionGuardSettings(inherited)).toEqual({
      ...DEFAULTS,
      clipboardMaxAgeSeconds: 7,
      maxSelectionChars: 9,
    });

    const nullProto = Object.assign(Object.create(null), {
      deniedBundleIds: ["A.B"],
    });
    expect(normalizeSelectionGuardSettings(nullProto)).toEqual({
      ...DEFAULTS,
      deniedBundleIds: ["a.b"],
    });
  });

  it("drops extra keys and emits the three fields in a fixed order", () => {
    const normalized = normalizeSelectionGuardSettings({
      extra: 1,
      deniedBundleIds: [],
      maxSelectionChars: 3,
      clipboardMaxAgeSeconds: 2,
    });
    expect(Object.keys(normalized)).toEqual([
      "clipboardMaxAgeSeconds",
      "maxSelectionChars",
      "deniedBundleIds",
    ]);
  });
});

describe("normalizeSelectionGuardSettings — deny-list edge entries", () => {
  it("skips holes, boxed strings and undefined entries", () => {
    const deniedBundleIds = [
      new String("com.boxed.app"),
      undefined,
      "com.example.app",
    ];
    deniedBundleIds.length = 5;
    expect(
      normalizeSelectionGuardSettings({ deniedBundleIds }).deniedBundleIds,
    ).toEqual(["com.example.app"]);
  });

  it("an array of only junk becomes empty, NOT the seeded defaults", () => {
    expect(
      normalizeSelectionGuardSettings({ deniedBundleIds: [1, null, "  "] })
        .deniedBundleIds,
    ).toEqual([]);
  });

  it("caps on VALID entries: junk ahead of the cap does not use up slots", () => {
    const junk = Array.from({ length: 60 }, () => 42);
    const valid = Array.from(
      { length: MAX_DENIED_BUNDLE_IDS + 10 },
      (_, index) => `com.example.app${index}`,
    );
    const normalized = normalizeSelectionGuardSettings({
      deniedBundleIds: [...junk, ...valid],
    });
    expect(normalized.deniedBundleIds).toEqual(
      valid.slice(0, MAX_DENIED_BUNDLE_IDS),
    );
  });

  it("dedupes BEFORE capping, so duplicates do not use up slots", () => {
    const valid = Array.from(
      { length: MAX_DENIED_BUNDLE_IDS },
      (_, index) => `com.example.app${index}`,
    );
    const normalized = normalizeSelectionGuardSettings({
      deniedBundleIds: [valid[0], valid[0].toUpperCase(), ...valid],
    });
    expect(normalized.deniedBundleIds).toEqual(valid);
  });

  it("a non-array object with numeric keys seeds the defaults", () => {
    expect(
      normalizeSelectionGuardSettings({ deniedBundleIds: { 0: "a.b" } })
        .deniedBundleIds,
    ).toEqual([...DEFAULT_DENIED_BUNDLE_IDS]);
  });
});
