import { describe, expect, it } from "vitest";
import { appBundlePath, shouldCheckForUpdatesOnLaunch } from "./installationPath";

describe("automatic update installation path", () => {
  const homePath = "/Users/kuro";

  it.each([
    "/Applications/FixLang.app/Contents/MacOS/FixLang",
    "/Users/kuro/Applications/FixLang.app/Contents/MacOS/FixLang",
  ])("allows an installed application at %s", (executablePath) => {
    expect(shouldCheckForUpdatesOnLaunch(executablePath, homePath)).toBe(true);
  });

  it.each([
    "/Users/kuro/Downloads/FixLang.app/Contents/MacOS/FixLang",
    "/Users/kuro/projects/fix-lang/release/mac-arm64/FixLang.app/Contents/MacOS/FixLang",
    "/Applications Backup/FixLang.app/Contents/MacOS/FixLang",
    "/Users/another/Applications/FixLang.app/Contents/MacOS/FixLang",
  ])("skips a launch check at %s", (executablePath) => {
    expect(shouldCheckForUpdatesOnLaunch(executablePath, homePath)).toBe(false);
  });

  it("normalizes parent path segments without escaping the install root", () => {
    expect(
      shouldCheckForUpdatesOnLaunch(
        "/Applications/../Downloads/FixLang.app/Contents/MacOS/FixLang",
        homePath,
      ),
    ).toBe(false);
  });
});

describe("running bundle path", () => {
  it("reduces an executable path to its .app root", () => {
    expect(
      appBundlePath("/Applications/FixLang.app/Contents/MacOS/FixLang"),
    ).toBe("/Applications/FixLang.app");
  });

  it("distinguishes a checkout build from the installed copy", () => {
    // Both carry the same bundle id, which is exactly why the path matters.
    expect(
      appBundlePath(
        "/Users/kuro/code/fix-lang/release/mac-arm64/FixLang.app/Contents/MacOS/FixLang",
      ),
    ).toBe("/Users/kuro/code/fix-lang/release/mac-arm64/FixLang.app");
  });

  it.each([
    "/usr/local/bin/fixlang",
    "relative/FixLang.app/Contents/MacOS/FixLang",
    "/Applications/FixLang.app",
    "",
  ])("returns null for a non-bundle executable path: %s", (executablePath) => {
    expect(appBundlePath(executablePath)).toBeNull();
  });
});
