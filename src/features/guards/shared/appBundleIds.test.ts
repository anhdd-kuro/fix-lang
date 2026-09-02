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
  hasAppBundlePathShape,
  isAppBundleIdsResult,
} from "./appBundleIds";

describe("hasAppBundlePathShape", () => {
  it("accepts an absolute path to a .app bundle", () => {
    expect(hasAppBundlePathShape("/Applications/Slack.app")).toBe(true);
  });

  it("accepts a .APP suffix — the Finder preserves whatever case the bundle was created with", () => {
    expect(hasAppBundlePathShape("/Applications/Legacy.APP")).toBe(true);
  });

  it("accepts a path containing spaces and quotes, which only a shell would choke on", () => {
    expect(hasAppBundlePathShape("/Applications/My App's; Tool.app")).toBe(true);
  });

  it.each([
    ["a non-string", 42],
    ["null", null],
    ["undefined", undefined],
    ["an empty string", ""],
    ["a relative path", "Applications/Slack.app"],
    ["a tilde path, which is not resolved anywhere", "~/Applications/Slack.app"],
    ["a non-.app file", "/Users/me/notes.txt"],
    ["a bare directory", "/Applications"],
    ["a NUL byte", "/Applications/Slack\u0000.app"],
    ["a newline", "/Applications/Sla\nck.app"],
  ])("rejects %s", (_label, value) => {
    expect(hasAppBundlePathShape(value)).toBe(false);
  });

  it("rejects a path longer than macOS could ever name", () => {
    const tooLong = `/${"a".repeat(MAX_APP_BUNDLE_PATH_LENGTH)}.app`;
    expect(tooLong.length).toBeGreaterThan(MAX_APP_BUNDLE_PATH_LENGTH);
    expect(hasAppBundlePathShape(tooLong)).toBe(false);
  });
});

describe("isAppBundleIdsResult", () => {
  it("accepts a success carrying ids", () => {
    expect(isAppBundleIdsResult({ success: true, bundleIds: ["com.foo.bar"] })).toBe(true);
  });

  it("accepts a cancelled dialog — success with no ids", () => {
    expect(isAppBundleIdsResult({ success: true, bundleIds: [] })).toBe(true);
  });

  it.each([
    ["a text label", textLabel("boom")],
    ["a message label", messageLabel("security.deniedApps.dropError")],
  ])("accepts a failure carrying %s", (_label, error) => {
    expect(isAppBundleIdsResult({ success: false, error })).toBe(true);
  });

  it.each([
    ["undefined", undefined],
    ["null", null],
    ["a string", "ok"],
    ["a success with no ids field", { success: true }],
    ["a success whose ids are not strings", { success: true, bundleIds: [1] }],
    ["a success whose ids are not an array", { success: true, bundleIds: "com.foo.bar" }],
    ["a failure with no error", { success: false }],
    ["a failure whose error is not a Label", { success: false, error: "boom" }],
    ["a non-boolean success", { success: "true", bundleIds: [] }],
  ])("rejects %s", (_label, value) => {
    expect(isAppBundleIdsResult(value)).toBe(false);
  });
});
