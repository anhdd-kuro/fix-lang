/**
 * @file validateHotkeys.test.ts
 * @description Unit tests for the centralised hotkey conflict validator.
 * Pure Vitest — no Electron, no IPC, no React. The `getDefaultCorrectionSettings`
 * import below pulls in `~/features/providers/store/apiStore`, which touches electron-store /
 * electron at module scope, hence the two mocks below (hoisted by Vitest).
 */
import { describe, expect, it, vi } from "vitest";
vi.mock("electron-store", () => {
  class MockStore {
    get = vi.fn().mockReturnValue(undefined);
    set = vi.fn();
    store = {};
    onDidChange = vi.fn();
    watch = vi.fn();
  }
  return { default: MockStore };
});
vi.mock("electron", () => ({
  Notification: vi.fn().mockImplementation(() => ({ show: vi.fn() })),
  ipcMain: { handle: vi.fn(), on: vi.fn() },
  app: { getPath: vi.fn().mockReturnValue("/tmp") },
}));
import { DEFAULT_KEY_BINDINGS } from "~/const";
import { COMBO_CANCEL_ACCELERATOR } from "~/features/correction/shared/comboValidation";
import { getDefaultCorrectionSettings } from "~/features/providers/store/apiStore";
import {
  COMBO_CANCEL_LABEL,
  findHotkeyConflicts,
  validateHotkeys,
} from "./validateHotkeys";
import type {
  ComboPreset,
  CorrectionPreset,
  KeyBindings,
} from "~/features/providers/store/apiStore";

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

const makeCombo = (id: string, name: string, hotkey: string): ComboPreset => ({
  id,
  name,
  hotkey,
  steps: [
    { id: `${id}-1`, presetId: "correction" },
    { id: `${id}-2`, presetId: "summarize" },
  ],
  schemaVersion: 1,
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
// Combo cancel (C6 layer 2) — Control+Escape is reserved STATICALLY, not
// derived from `keyBindings`, so a preset claiming it is rejected pre-save even
// though no app keybinding holds it.
// ---------------------------------------------------------------------------

describe("validateHotkeys — the combo cancel accelerator is statically reserved", () => {
  it("pins the reserved accelerator and its label", () => {
    expect(COMBO_CANCEL_ACCELERATOR).toBe("Control+Escape");
    expect(COMBO_CANCEL_LABEL).toBe("comboCancel");
  });

  it("rejects a preset bound to Control+Escape, naming comboCancel as the holder", () => {
    const presets = [makePreset("custom", "My Custom", COMBO_CANCEL_ACCELERATOR)];

    expect(validateHotkeys(presets, makeKeyBindings())).toEqual({
      hotkey: COMBO_CANCEL_ACCELERATOR,
      presetOrKey: "My Custom",
      conflictsWith: COMBO_CANCEL_LABEL,
    });
  });

  it("rejects it even when both app keybindings are blank — the reservation is not keyBindings-derived", () => {
    const presets = [makePreset("custom", "My Custom", COMBO_CANCEL_ACCELERATOR)];

    const result = validateHotkeys(presets, {
      promptGen: "",
      profileSwitch: "",
    });

    expect(result?.conflictsWith).toBe(COMBO_CANCEL_LABEL);
  });

  it("rejects a combo bound to it too", () => {
    const result = validateHotkeys([], makeKeyBindings(), [
      makeCombo("c1", "Polish then translate", COMBO_CANCEL_ACCELERATOR),
    ]);

    expect(result).toEqual({
      hotkey: COMBO_CANCEL_ACCELERATOR,
      presetOrKey: "Polish then translate",
      conflictsWith: COMBO_CANCEL_LABEL,
    });
  });

  it("rejects an app keybinding bound to it — every binding is checked, not just presets", () => {
    const result = validateHotkeys(
      [],
      makeKeyBindings(COMBO_CANCEL_ACCELERATOR, "Control+Shift+N"),
    );

    expect(result).toEqual({
      hotkey: COMBO_CANCEL_ACCELERATOR,
      presetOrKey: "promptGen",
      conflictsWith: COMBO_CANCEL_LABEL,
    });
  });

  it("names comboCancel as the holder for every party when a legacy promptGen also holds the chord", () => {
    // Reachable only from a config saved before this gate existed. The static
    // claim comes first, so it owns the message for both offenders.
    const presets = [makePreset("custom", "My Custom", COMBO_CANCEL_ACCELERATOR)];

    const conflicts = findHotkeyConflicts(
      presets,
      makeKeyBindings(COMBO_CANCEL_ACCELERATOR, "Control+Shift+N"),
    );

    expect(conflicts.map((conflict) => conflict.conflictsWith)).toEqual([
      COMBO_CANCEL_LABEL,
      COMBO_CANCEL_LABEL,
    ]);
    expect(conflicts.map((conflict) => conflict.presetOrKey)).toEqual([
      "promptGen",
      "My Custom",
    ]);
  });

  it("leaves a merely similar chord alone", () => {
    const presets = [
      makePreset("a", "Alpha", "Control+Shift+Escape"),
      makePreset("b", "Beta", "Command+Escape"),
    ];

    expect(validateHotkeys(presets, makeKeyBindings())).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The user's design change: the validator arbitrates EVERY keybinding pair,
// and a collision is an error — never a silent relinquish.
// ---------------------------------------------------------------------------

describe("validateHotkeys — every keybinding pair is checked", () => {
  it("returns null for a fully distinct set of presets, combos and app keys", () => {
    const result = validateHotkeys(
      [
        makePreset("correction", "Correction", "Control+Shift+F"),
        makePreset("summarize", "Summarize", "Control+Shift+S"),
      ],
      makeKeyBindings(),
      [
        makeCombo("c1", "Combo One", "Control+Shift+1"),
        makeCombo("c2", "Combo Two", "Control+Shift+2"),
      ],
    );

    expect(result).toBeNull();
  });

  it("rejects preset ↔ combo", () => {
    const result = validateHotkeys(
      [makePreset("correction", "Correction", "Control+Shift+F")],
      makeKeyBindings(),
      [makeCombo("c1", "Combo One", "Control+Shift+F")],
    );

    expect(result).toEqual({
      hotkey: "Control+Shift+F",
      presetOrKey: "Combo One",
      conflictsWith: "Correction",
    });
  });

  it("rejects combo ↔ combo", () => {
    const result = validateHotkeys([], makeKeyBindings(), [
      makeCombo("c1", "Combo One", "Control+Shift+1"),
      makeCombo("c2", "Combo Two", "Control+Shift+1"),
    ]);

    expect(result).toEqual({
      hotkey: "Control+Shift+1",
      presetOrKey: "Combo Two",
      conflictsWith: "Combo One",
    });
  });

  it("rejects combo ↔ promptGen", () => {
    const result = validateHotkeys([], makeKeyBindings(), [
      makeCombo("c1", "Combo One", "Control+Shift+P"),
    ]);

    expect(result).toEqual({
      hotkey: "Control+Shift+P",
      presetOrKey: "Combo One",
      conflictsWith: "promptGen",
    });
  });

  it("rejects combo ↔ profileSwitch", () => {
    const result = validateHotkeys([], makeKeyBindings(), [
      makeCombo("c1", "Combo One", "Control+Shift+N"),
    ]);

    expect(result).toEqual({
      hotkey: "Control+Shift+N",
      presetOrKey: "Combo One",
      conflictsWith: "profileSwitch",
    });
  });

  it("rejects promptGen ↔ profileSwitch — the pair nothing used to check", () => {
    const result = validateHotkeys(
      [],
      makeKeyBindings("Control+Shift+P", "Control+Shift+P"),
    );

    expect(result).toEqual({
      hotkey: "Control+Shift+P",
      presetOrKey: "profileSwitch",
      conflictsWith: "promptGen",
    });
  });

  it("ignores blank combo hotkeys, and two blank ones do not collide with each other", () => {
    const result = validateHotkeys([], makeKeyBindings(), [
      makeCombo("c1", "Combo One", ""),
      makeCombo("c2", "Combo Two", "   "),
      makeCombo("c3", "Combo Three", "\t"),
    ]);

    expect(result).toBeNull();
  });

  it("compares hotkeys exactly — no case folding", () => {
    const result = validateHotkeys(
      [
        makePreset("a", "Alpha", "Control+Shift+F"),
        makePreset("b", "Beta", "control+shift+f"),
      ],
      makeKeyBindings(),
      [makeCombo("c1", "Combo One", "CONTROL+SHIFT+F")],
    );

    expect(result).toBeNull();
  });

  it("matches hotkeys that differ only by surrounding whitespace", () => {
    const result = validateHotkeys(
      [makePreset("a", "Alpha", "  Control+Shift+F  ")],
      makeKeyBindings(),
      [makeCombo("c1", "Combo One", "Control+Shift+F")],
    );

    expect(result?.hotkey).toBe("Control+Shift+F");
  });
});

describe("findHotkeyConflicts — reports every collision, not just the first", () => {
  it("returns one entry per offending claim, in claim order", () => {
    const conflicts = findHotkeyConflicts(
      [
        makePreset("a", "Alpha", "Control+Shift+F"),
        makePreset("b", "Beta", "Control+Shift+F"),
        makePreset("c", "Gamma", "Control+Shift+P"),
      ],
      makeKeyBindings(),
      [makeCombo("c1", "Combo One", "Control+Shift+F")],
    );

    expect(conflicts).toEqual([
      {
        hotkey: "Control+Shift+F",
        presetOrKey: "Beta",
        conflictsWith: "Alpha",
      },
      {
        hotkey: "Control+Shift+P",
        presetOrKey: "Gamma",
        conflictsWith: "promptGen",
      },
      {
        hotkey: "Control+Shift+F",
        presetOrKey: "Combo One",
        conflictsWith: "Alpha",
      },
    ]);
  });

  it("returns an empty array when nothing collides, and validateHotkeys agrees", () => {
    const presets = [makePreset("a", "Alpha", "Control+Shift+F")];

    expect(findHotkeyConflicts(presets, makeKeyBindings())).toEqual([]);
    expect(validateHotkeys(presets, makeKeyBindings())).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Card 03 — the two new built-in defaults (Business Writing / Structured
// Text) must not collide with each other, the other four built-ins, or the
// static app hotkeys (promptGen/profileSwitch).
// ---------------------------------------------------------------------------

describe("validateHotkeys — the six real built-in defaults never conflict with each other or the app", () => {
  it("returns null for getDefaultCorrectionSettings() against DEFAULT_KEY_BINDINGS", () => {
    const defaults = getDefaultCorrectionSettings();

    const result = validateHotkeys(
      defaults.presets,
      DEFAULT_KEY_BINDINGS,
      defaults.combos,
    );

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
