import { describe, expect, it } from "vitest";
import { shouldCheckForUpdatesOnLaunch } from "./installationPath";

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
