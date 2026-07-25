import { describe, expect, it } from "vitest";
import { msg } from "./i18n/message";
import { isInstallUpdateResult, isUpdateState } from "./update";

describe("update-state preload boundary", () => {
  it("accepts the documented display-safe state shape", () => {
    expect(
      isUpdateState({
        phase: "available",
        currentVersion: "0.2.0",
        availableVersion: "0.3.0",
        releaseNotes: "Manual DMG update available.",
      }),
    ).toBe(true);
  });

  it("rejects unknown properties from IPC snapshots", () => {
    expect(
      isUpdateState({
        phase: "idle",
        currentVersion: "0.2.0",
        releaseUrl: "https://untrusted.example/release",
      }),
    ).toBe(false);
  });

  it("accepts the Homebrew install phase and capability flag", () => {
    expect(
      isUpdateState({
        phase: "installing",
        currentVersion: "0.3.2",
        availableVersion: "0.3.3",
        canInstall: true,
      }),
    ).toBe(true);
  });

  it("rejects a non-boolean install capability", () => {
    expect(
      isUpdateState({
        phase: "available",
        currentVersion: "0.3.2",
        canInstall: "yes",
      }),
    ).toBe(false);
  });

  it("accepts a locale-free `message` descriptor, params included", () => {
    expect(
      isUpdateState({
        phase: "error",
        currentVersion: "0.3.2",
        message: msg("settings.updates.tapBehindMessage", {
          targetVersion: "0.3.3",
          offeredVersion: "0.3.2",
        }),
      }),
    ).toBe(true);
  });

  it("rejects a pre-resolved string on `message` (must be a descriptor)", () => {
    expect(
      isUpdateState({
        phase: "error",
        currentVersion: "0.3.2",
        message: "Could not check for updates.",
      }),
    ).toBe(false);
  });
});

describe("install-result preload boundary", () => {
  it("accepts the two documented result shapes", () => {
    expect(isInstallUpdateResult({ success: true })).toBe(true);
    expect(
      isInstallUpdateResult({
        success: false,
        error: msg("settings.updates.installErrorMessage"),
      }),
    ).toBe(true);
  });

  it("rejects results carrying extra main-process detail", () => {
    expect(
      isInstallUpdateResult({
        success: false,
        error: msg("settings.updates.installErrorMessage"),
        command: "brew upgrade --cask fixlang",
      }),
    ).toBe(false);
  });

  it("rejects a plain-string error (message must be a locale-free descriptor)", () => {
    expect(
      isInstallUpdateResult({ success: false, error: "Could not start" }),
    ).toBe(false);
  });

  it("rejects a descriptor whose key is empty or whose params are malformed", () => {
    expect(isInstallUpdateResult({ success: false, error: { key: "" } })).toBe(
      false,
    );
    expect(
      isInstallUpdateResult({
        success: false,
        error: { key: "settings.updates.installErrorMessage", params: { n: true } },
      }),
    ).toBe(false);
  });
});
