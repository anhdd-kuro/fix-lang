import { describe, expect, it } from "vitest";
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
});

describe("install-result preload boundary", () => {
  it("accepts the two documented result shapes", () => {
    expect(isInstallUpdateResult({ success: true })).toBe(true);
    expect(
      isInstallUpdateResult({ success: false, error: "Could not start" }),
    ).toBe(true);
  });

  it("rejects results carrying extra main-process detail", () => {
    expect(
      isInstallUpdateResult({
        success: false,
        error: "Could not start",
        command: "brew upgrade --cask fixlang",
      }),
    ).toBe(false);
  });
});
