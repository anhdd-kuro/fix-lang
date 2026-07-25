import { describe, expect, it } from "vitest";
import { isUpdateState } from "./update";

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
});
