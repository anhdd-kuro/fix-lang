/**
 * @file activeApp.test.ts
 * @description Tests for parsing/sanitizing the frontmost macOS app reported
 * by System Events. Pure unit tests — no Electron, no osascript.
 */
import { describe, expect, it } from "vitest";
import { parseActiveApp } from "./activeApp";

describe("parseActiveApp", () => {
  it("parses the tab-separated name and bundle id emitted by the script", () => {
    expect(parseActiveApp("Slack\tcom.tinyspeck.slackmacgap")).toEqual({
      name: "Slack",
      bundleId: "com.tinyspeck.slackmacgap",
    });
  });

  it("trims the surrounding whitespace osascript appends", () => {
    expect(parseActiveApp("  Notes\tcom.apple.Notes \n")).toEqual({
      name: "Notes",
      bundleId: "com.apple.Notes",
    });
  });

  it("keeps the name when the bundle id is missing", () => {
    // Some processes (unbundled helpers) report an empty bundle identifier.
    expect(parseActiveApp("Terminal\t")).toEqual({
      name: "Terminal",
      bundleId: null,
    });
    expect(parseActiveApp("Terminal")).toEqual({
      name: "Terminal",
      bundleId: null,
    });
  });

  it("returns null for empty or whitespace-only output", () => {
    expect(parseActiveApp("")).toBeNull();
    expect(parseActiveApp("   \n")).toBeNull();
    expect(parseActiveApp("\tcom.apple.Notes")).toBeNull();
  });

  it("returns null when FixLang itself is frontmost", () => {
    // Selecting text inside FixLang's own dashboard must not tell the model
    // the source app is FixLang — that is noise, not context.
    expect(parseActiveApp("FixLang\tcom.fixlang.app")).toBeNull();
    // Dev runs report the bare Electron shell instead of the packaged app.
    expect(parseActiveApp("Electron\tcom.github.Electron")).toBeNull();
    expect(parseActiveApp("FixLang\t")).toBeNull();
  });

  it("drops a name longer than the cap instead of forwarding it", () => {
    // Guards the prompt against a pathological/hostile process name; a real
    // app name is far below this, so a longer one is not usable context.
    expect(parseActiveApp(`${"a".repeat(65)}\tcom.example.app`)).toBeNull();
    expect(
      parseActiveApp(`${"a".repeat(64)}\tcom.example.app`)?.name,
    ).toHaveLength(64);
  });

  it("strips control characters that would break the prompt block", () => {
    expect(parseActiveApp("Ma\nil\tcom.apple.mail")).toEqual({
      name: "Mail",
      bundleId: "com.apple.mail",
    });
  });
});
