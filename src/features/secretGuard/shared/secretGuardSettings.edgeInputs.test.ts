/**
 * @file secretGuardSettings.edgeInputs.test.ts
 * @description Pins `normalizeSecretGuardSettings` on inputs a JSON store
 * cannot produce but a hand-edited file, a test, or a future caller could:
 * non-finite numbers, boxed primitives, arrays, functions, inherited fields and
 * null-prototype objects. Junk must land on the SAFE default (`confirm`) and
 * the QUIET default (entropy off), and the result must hold only the two keys.
 */
import { describe, expect, it } from "vitest";
import { normalizeSecretGuardSettings } from "./secretGuardSettings";

const DEFAULTS = { mode: "confirm", highEntropyRule: false };

describe("normalizeSecretGuardSettings — edge inputs", () => {
  it.each([
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["-0", -0],
    ["true", true],
    ["an empty array", []],
    ["an array of a mode", ["mask"]],
    ["a function", () => "mask"],
    ["a boxed mode string", new String("mask")],
    ["a Date", new Date(0)],
  ])("%s falls back to the defaults", (_label, raw) => {
    expect(normalizeSecretGuardSettings(raw)).toEqual(DEFAULTS);
  });

  it("reads an inherited field as well as an own one", () => {
    const raw = Object.assign(Object.create({ mode: "mask" }), {
      highEntropyRule: true,
    });
    expect(normalizeSecretGuardSettings(raw)).toEqual({
      mode: "mask",
      highEntropyRule: true,
    });
  });

  it("reads fields off a null-prototype object", () => {
    const raw = Object.assign(Object.create(null), {
      mode: "off",
      highEntropyRule: true,
    });
    expect(normalizeSecretGuardSettings(raw)).toEqual({
      mode: "off",
      highEntropyRule: true,
    });
  });

  it("drops extra keys and keeps the two fields in order", () => {
    const normalized = normalizeSecretGuardSettings({
      extra: 1,
      highEntropyRule: true,
      mode: "mask",
    });
    expect(Object.keys(normalized)).toEqual(["mode", "highEntropyRule"]);
    expect(normalized).toEqual({ mode: "mask", highEntropyRule: true });
  });

  it.each([
    ["a boxed mode", { mode: new String("off"), highEntropyRule: true }],
    ["a NaN mode", { mode: Number.NaN, highEntropyRule: true }],
    ["an array mode", { mode: ["off"], highEntropyRule: true }],
  ])("%s falls back to confirm, keeping a real entropy flag", (_label, raw) => {
    expect(normalizeSecretGuardSettings(raw)).toEqual({
      mode: "confirm",
      highEntropyRule: true,
    });
  });

  it.each([
    ["a boxed true", new Boolean(true)],
    ["the string true", "true"],
    ["1", 1],
    ["Infinity", Number.POSITIVE_INFINITY],
  ])("%s entropy flag reads as off", (_label, highEntropyRule) => {
    expect(
      normalizeSecretGuardSettings({ mode: "mask", highEntropyRule }),
    ).toEqual({ mode: "mask", highEntropyRule: false });
  });
});
