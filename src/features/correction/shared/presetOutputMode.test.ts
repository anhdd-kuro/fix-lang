/**
 * @file presetOutputMode.test.ts
 * @description Per-preset output-mode override resolution: "inherit" (and
 * anything unrecognized) falls through to the caller's global mode; an
 * explicit "paste"/"popup" override wins.
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_PRESET_OUTPUT_MODE,
  resolvePresetOutputMode,
} from "./presetOutputMode";

describe("resolvePresetOutputMode", () => {
  it("falls through to the global mode for undefined", () => {
    expect(resolvePresetOutputMode(undefined, "paste")).toBe("paste");
    expect(resolvePresetOutputMode(undefined, "popup")).toBe("popup");
  });

  it('falls through to the global mode for "inherit"', () => {
    expect(resolvePresetOutputMode("inherit", "paste")).toBe("paste");
    expect(resolvePresetOutputMode("inherit", "popup")).toBe("popup");
  });

  it("falls through to the global mode for unrecognized values", () => {
    expect(resolvePresetOutputMode("bogus", "popup")).toBe("popup");
    expect(resolvePresetOutputMode(42, "paste")).toBe("paste");
    expect(resolvePresetOutputMode(null, "popup")).toBe("popup");
    expect(resolvePresetOutputMode({}, "paste")).toBe("paste");
  });

  it('honours an explicit "paste" override regardless of global mode', () => {
    expect(resolvePresetOutputMode("paste", "popup")).toBe("paste");
    expect(resolvePresetOutputMode("paste", "paste")).toBe("paste");
  });

  it('honours an explicit "popup" override regardless of global mode', () => {
    expect(resolvePresetOutputMode("popup", "paste")).toBe("popup");
    expect(resolvePresetOutputMode("popup", "popup")).toBe("popup");
  });

  it("defaults to inherit", () => {
    expect(DEFAULT_PRESET_OUTPUT_MODE).toBe("inherit");
  });
});
