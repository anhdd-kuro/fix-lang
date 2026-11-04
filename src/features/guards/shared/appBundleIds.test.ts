/**
 * @file appBundleIds.test.ts
 * @description The pure half of the "block an .app" path: the path SHAPE rule
 * every process shares, and the reply validator the preload bridge runs.
 *
 * The shape rule is pinned here rather than only where it is used because
 * three processes ask it (renderer pre-filter, preload bridge, main resolver)
 * and a divergence between them would show up as "the drop silently did
 * nothing" rather than as an error.
 */
import { describe, expect, it } from "vitest";
import { messageLabel, textLabel } from "~/features/i18n/shared/message";
import {
  MAX_APP_BUNDLE_PATH_LENGTH,
  looksLikeAppBundlePath,
  AppBundleIdsResultSchema,
} from "./appBundleIds";

describe("looksLikeAppBundlePath", () => {
  it("accepts an absolute path to a .app bundle", () => {
    expect(looksLikeAppBundlePath("/Applications/Slack.app")).toBe(true);
  });

  it("accepts a .APP suffix — the Finder preserves whatever case the bundle was created with", () => {
    expect(looksLikeAppBundlePath("/Applications/Legacy.APP")).toBe(true);
  });

  it("accepts a path containing spaces and quotes, which only a shell would choke on", () => {
    expect(looksLikeAppBundlePath("/Applications/My App's; Tool.app")).toBe(
      true,
    );
  });

  it.each([
    ["a non-string", 42],
    ["null", null],
    ["undefined", undefined],
    ["an empty string", ""],
    ["a relative path", "Applications/Slack.app"],
    [
      "a tilde path, which is not resolved anywhere",
      "~/Applications/Slack.app",
    ],
    ["a non-.app file", "/Users/me/notes.txt"],
    ["a bare directory", "/Applications"],
    ["a NUL byte", "/Applications/Slack\u0000.app"],
    ["a newline", "/Applications/Sla\nck.app"],
  ])("rejects %s", (_label, value) => {
    // Junk the parameter type cannot express, arriving through a JSON
    // boundary the way it does from another process.
    const crossedBoundary: string = JSON.parse(JSON.stringify({ value })).value;
    expect(looksLikeAppBundlePath(crossedBoundary)).toBe(false);
  });

  it("rejects a path longer than macOS could ever name", () => {
    const tooLong = `/${"a".repeat(MAX_APP_BUNDLE_PATH_LENGTH)}.app`;
    expect(tooLong.length).toBeGreaterThan(MAX_APP_BUNDLE_PATH_LENGTH);
    expect(looksLikeAppBundlePath(tooLong)).toBe(false);
  });
});

describe("AppBundleIdsResultSchema", () => {
  it("accepts a success carrying ids", () => {
    expect(
      AppBundleIdsResultSchema.safeParse({
        success: true,
        bundleIds: ["com.foo.bar"],
      }).success,
    ).toBe(true);
  });

  it("accepts a cancelled dialog — success with no ids", () => {
    expect(
      AppBundleIdsResultSchema.safeParse({ success: true, bundleIds: [] })
        .success,
    ).toBe(true);
  });

  it.each([
    ["a text label", textLabel("boom")],
    ["a message label", messageLabel("security.deniedApps.dropError")],
  ])("accepts a failure carrying %s", (_label, error) => {
    expect(
      AppBundleIdsResultSchema.safeParse({ success: false, error }).success,
    ).toBe(true);
  });

  it.each([
    ["undefined", undefined],
    ["null", null],
    ["a string", "ok"],
    ["a success with no ids field", { success: true }],
    ["a success whose ids are not strings", { success: true, bundleIds: [1] }],
    [
      "a success whose ids are not an array",
      { success: true, bundleIds: "com.foo.bar" },
    ],
    ["a failure with no error", { success: false }],
    ["a failure whose error is not a Label", { success: false, error: "boom" }],
    ["a non-boolean success", { success: "true", bundleIds: [] }],
  ])("rejects %s", (_label, value) => {
    expect(AppBundleIdsResultSchema.safeParse(value).success).toBe(false);
  });
});
