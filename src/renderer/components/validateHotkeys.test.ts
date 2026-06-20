/**
 * @file validateHotkeys.test.ts
 * @description Unit tests for the centralised hotkey conflict validator.
 * Pure Vitest — no Electron, no IPC, no React, no mocks needed.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_KEY_BINDINGS } from "~/const";
import { validateHotkeys } from "./validateHotkeys";
import type { CorrectionPreset, KeyBindings } from "~/stores/apiStore";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makePreset = (
  id: string,
  name: string,
  hotkey: string,
): CorrectionPreset => ({
  id,
  name,
  hotkey,
  systemPrompt: "Some prompt.",
  model: "openai/gpt-4.1-mini",
  isBuiltIn: false,
});

const makeKeyBindings = (
  promptGen = "Control+Shift+P",
  profileSwitch = "Control+Shift+N",
): Pick<KeyBindings, "promptGen" | "profileSwitch"> => ({
  promptGen,
  profileSwitch,
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("validateHotkeys", () => {
  it("returns null when all presets have distinct hotkeys and no app-hotkey conflict", () => {
    const presets = [
      makePreset("correction", "Correction", "Control+Shift+F"),
      makePreset("summarize", "Summarize", "Control+Shift+S"),
      makePreset("translate", "Translate", "Control+Shift+T"),
    ];

    const result = validateHotkeys(presets, makeKeyBindings());

    expect(result).toBeNull();
  });

  it("returns a conflict when two presets share the same hotkey", () => {
    const presets = [
      makePreset("correction", "Correction", "Control+Shift+F"),
      makePreset("custom", "My Custom", "Control+Shift+F"), // duplicate
    ];

    const result = validateHotkeys(presets, makeKeyBindings());

    expect(result).not.toBeNull();
    expect(result?.hotkey).toBe("Control+Shift+F");
    // Both colliding preset names must appear
    expect([result?.presetOrKey, result?.conflictsWith]).toContain("Correction");
    expect([result?.presetOrKey, result?.conflictsWith]).toContain("My Custom");
  });

  it("returns a conflict when a preset hotkey matches promptGen", () => {
    const presets = [
      makePreset("correction", "Correction", "Control+Shift+P"), // same as promptGen
    ];

    const result = validateHotkeys(
      presets,
      makeKeyBindings("Control+Shift+P", "Control+Shift+N"),
    );

    expect(result).not.toBeNull();
    expect(result?.hotkey).toBe("Control+Shift+P");
    expect([result?.presetOrKey, result?.conflictsWith]).toContain("Correction");
    expect([result?.presetOrKey, result?.conflictsWith]).toContain("promptGen");
  });

  it("returns a conflict when a preset hotkey matches profileSwitch", () => {
    const presets = [
      makePreset("summarize", "Summarize", "Control+Shift+N"), // same as profileSwitch
    ];

    const result = validateHotkeys(
      presets,
      makeKeyBindings("Control+Shift+P", "Control+Shift+N"),
    );

    expect(result).not.toBeNull();
    expect(result?.hotkey).toBe("Control+Shift+N");
    expect([result?.presetOrKey, result?.conflictsWith]).toContain("Summarize");
    expect([result?.presetOrKey, result?.conflictsWith]).toContain(
      "profileSwitch",
    );
  });

  it("ignores presets with empty hotkeys — no false positives", () => {
    const presets = [
      makePreset("correction", "Correction", "Control+Shift+F"),
      makePreset("custom1", "Custom 1", ""), // empty — should be ignored
      makePreset("custom2", "Custom 2", ""), // also empty — no conflict with Custom 1
    ];

    const result = validateHotkeys(presets, makeKeyBindings());

    expect(result).toBeNull();
  });

  it("ignores presets with whitespace-only hotkeys", () => {
    const presets = [
      makePreset("custom1", "Custom 1", "   "),
      makePreset("custom2", "Custom 2", "\t"),
    ];

    const result = validateHotkeys(presets, makeKeyBindings());

    expect(result).toBeNull();
  });

  it("conflict object names both colliding parties (preset-vs-preset)", () => {
    const presets = [
      makePreset("a", "Alpha", "Control+Shift+A"),
      makePreset("b", "Beta", "Control+Shift+A"),
    ];

    const result = validateHotkeys(presets, makeKeyBindings());

    expect(result).not.toBeNull();
    // Both names present in the conflict object
    const names = [result?.presetOrKey, result?.conflictsWith];
    expect(names).toContain("Alpha");
    expect(names).toContain("Beta");
  });

  it("returns null when presets list is empty", () => {
    const result = validateHotkeys([], makeKeyBindings());
    expect(result).toBeNull();
  });

  it("ignores app keybindings that are empty strings", () => {
    const presets = [makePreset("correction", "Correction", "")];

    // Both app keybindings are empty — nothing to conflict with
    const result = validateHotkeys(presets, { promptGen: "", profileSwitch: "" });

    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// KeyBindings type-shape guard (#45)
// Verifies DEFAULT_KEY_BINDINGS has exactly {promptGen, profileSwitch}.
// Catches accidental re-widening of the KeyBindings type.
// ---------------------------------------------------------------------------

describe("DEFAULT_KEY_BINDINGS shape", () => {
  it("has exactly promptGen and profileSwitch keys", () => {
    const keys = Object.keys(DEFAULT_KEY_BINDINGS).sort();
    expect(keys).toEqual(["profileSwitch", "promptGen"]);
  });

  it("DEFAULT_KEY_BINDINGS satisfies KeyBindings type (both fields are non-empty strings)", () => {
    // This is also a TypeScript compile-time check via the `satisfies` in const.ts,
    // but we verify at runtime too.
    const bindings: KeyBindings = DEFAULT_KEY_BINDINGS;
    expect(typeof bindings.promptGen).toBe("string");
    expect(bindings.promptGen.length).toBeGreaterThan(0);
    expect(typeof bindings.profileSwitch).toBe("string");
    expect(bindings.profileSwitch.length).toBeGreaterThan(0);
  });
});
