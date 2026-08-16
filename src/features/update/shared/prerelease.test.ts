import { describe, expect, it } from "vitest";
import { msg } from "~/features/i18n/shared/message";
import { isPrereleaseState } from "./prerelease";

describe("prerelease-state preload boundary", () => {
  it("accepts the documented display-safe state shape", () => {
    expect(
      isPrereleaseState({
        phase: "available",
        activeChannel: "stable",
        offeredVersion: "0.33.0-beta.3",
        releaseNotes: "Beta build notes.",
      }),
    ).toBe(true);
  });

  it("accepts the idle/unsupported/checking phases with no optional fields", () => {
    expect(isPrereleaseState({ phase: "idle", activeChannel: "stable" })).toBe(
      true,
    );
    expect(
      isPrereleaseState({ phase: "unsupported", activeChannel: "stable" }),
    ).toBe(true);
    expect(
      isPrereleaseState({ phase: "checking", activeChannel: "beta" }),
    ).toBe(true);
  });

  it("rejects an unknown phase", () => {
    expect(
      isPrereleaseState({ phase: "switching", activeChannel: "stable" }),
    ).toBe(false);
  });

  it("rejects a missing activeChannel", () => {
    expect(isPrereleaseState({ phase: "idle" })).toBe(false);
  });

  it("rejects an activeChannel outside stable/beta/both", () => {
    expect(
      isPrereleaseState({ phase: "idle", activeChannel: "alpha" }),
    ).toBe(false);
  });

  it("accepts the both-installed anomaly carrying a fix-it message", () => {
    expect(
      isPrereleaseState({
        phase: "error",
        activeChannel: "both",
        message: msg("settings.updates.tapBehindMessage", {
          targetVersion: "0.33.0",
          offeredVersion: "0.33.0-beta.3",
        }),
      }),
    ).toBe(true);
  });

  it("rejects unknown properties from IPC snapshots", () => {
    expect(
      isPrereleaseState({
        phase: "idle",
        activeChannel: "stable",
        targetPath: "/private/cache",
      }),
    ).toBe(false);
  });

  it("accepts the downloading phase with byte progress and canSwitch", () => {
    expect(
      isPrereleaseState({
        phase: "downloading",
        activeChannel: "stable",
        offeredVersion: "0.33.0-beta.3",
        canSwitch: true,
        downloadedBytes: 35_000_000,
        totalBytes: 102_000_000,
      }),
    ).toBe(true);
  });

  it("rejects a non-boolean canSwitch", () => {
    expect(
      isPrereleaseState({
        phase: "available",
        activeChannel: "stable",
        canSwitch: "yes",
      }),
    ).toBe(false);
  });

  it.each([-1, 1.5, "35000000", Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects a downloadedBytes value that is not a non-negative safe integer: %j",
    (downloadedBytes) => {
      expect(
        isPrereleaseState({
          phase: "downloading",
          activeChannel: "stable",
          downloadedBytes,
        }),
      ).toBe(false);
    },
  );

  it.each([-1, 1.5, "102000000", Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects a totalBytes value that is not a non-negative safe integer: %j",
    (totalBytes) => {
      expect(
        isPrereleaseState({
          phase: "downloading",
          activeChannel: "stable",
          totalBytes,
        }),
      ).toBe(false);
    },
  );

  it("accepts a locale-free `message` descriptor, params included", () => {
    expect(
      isPrereleaseState({
        phase: "error",
        activeChannel: "stable",
        message: msg("settings.updates.tapBehindMessage", {
          targetVersion: "0.33.0-beta.3",
          offeredVersion: "0.33.0-beta.2",
        }),
      }),
    ).toBe(true);
  });

  it("rejects a pre-resolved string on `message` (must be a descriptor)", () => {
    expect(
      isPrereleaseState({
        phase: "error",
        activeChannel: "stable",
        message: "Could not check for pre-releases.",
      }),
    ).toBe(false);
  });

  it("rejects a non-string offeredVersion/releaseNotes", () => {
    expect(
      isPrereleaseState({
        phase: "available",
        activeChannel: "stable",
        offeredVersion: 33,
      }),
    ).toBe(false);
    expect(
      isPrereleaseState({
        phase: "available",
        activeChannel: "stable",
        releaseNotes: 33,
      }),
    ).toBe(false);
  });

  it.each([undefined, null, "idle", 42, []])(
    "rejects a non-record value: %j",
    (value) => {
      expect(isPrereleaseState(value)).toBe(false);
    },
  );
});
