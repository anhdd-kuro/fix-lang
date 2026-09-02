import { describe, expect, it } from "vitest";
import {
  DEFAULT_SECRET_GUARD_SETTINGS,
  normalizeSecretGuardSettings,
  SECRET_GUARD_MODES,
} from "./secretGuardSettings";

describe("normalizeSecretGuardSettings", () => {
  it("ships the guard on, in confirm mode, with the opt-in rule off", () => {
    expect(DEFAULT_SECRET_GUARD_SETTINGS).toEqual({ mode: "confirm", highEntropyRule: false });
  });

  it("offers exactly three modes", () => {
    expect(SECRET_GUARD_MODES).toEqual(["off", "confirm", "mask"]);
  });

  it.each(SECRET_GUARD_MODES)("keeps a stored %s mode", (mode) => {
    expect(normalizeSecretGuardSettings({ mode, highEntropyRule: false }).mode).toBe(mode);
  });

  it("keeps the opt-in rule when it is explicitly on", () => {
    expect(normalizeSecretGuardSettings({ mode: "mask", highEntropyRule: true })).toEqual({
      mode: "mask",
      highEntropyRule: true,
    });
  });

  // Junk must never silently disable a safety rail, so it falls back to
  // "confirm" rather than to "off".
  it.each([
    ["nothing stored", undefined],
    ["null", null],
    ["a string", "mask"],
    ["an unknown mode", { mode: "silent" }],
    ["a numeric mode", { mode: 2 }],
    ["a missing mode", { highEntropyRule: true }],
  ])("normalizes %s to confirm", (_description, raw) => {
    expect(normalizeSecretGuardSettings(raw).mode).toBe("confirm");
  });

  // Junk entropy fails quiet: only an explicit `true` switches on the one rule
  // with a real false-positive rate.
  it.each([
    ["nothing stored", undefined],
    ["a truthy string", { mode: "confirm", highEntropyRule: "yes" }],
    ["a one", { mode: "confirm", highEntropyRule: 1 }],
    ["null", { mode: "confirm", highEntropyRule: null }],
  ])("normalizes %s to highEntropyRule false", (_description, raw) => {
    expect(normalizeSecretGuardSettings(raw).highEntropyRule).toBe(false);
  });

  it("returns a fresh object rather than the shared default", () => {
    expect(normalizeSecretGuardSettings(undefined)).not.toBe(DEFAULT_SECRET_GUARD_SETTINGS);
    expect(normalizeSecretGuardSettings(undefined)).toEqual(DEFAULT_SECRET_GUARD_SETTINGS);
  });
});
