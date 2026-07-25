import { describe, expect, it, vi } from "vitest";
import {
  BREW_BINARY_CANDIDATES,
  buildUpgradeScript,
  caskroomPath,
  createHomebrewUpgrader,
  findBrewBinary,
  parseCaskVersion,
  type BrewRunner,
} from "./homebrew";

const caskInfoJson = (version: string): string =>
  JSON.stringify({ casks: [{ token: "fixlang", version }] });

const upgrader = (
  overrides: Partial<{
    isInstalledApp: boolean;
    files: readonly string[];
    directories: readonly string[];
    runBrew: BrewRunner;
  }> = {},
) => {
  const startDetached = vi.fn();
  const files = new Set(overrides.files ?? ["/opt/homebrew/bin/brew"]);
  const directories = new Set(
    overrides.directories ?? ["/opt/homebrew/Caskroom/fixlang"],
  );
  const runBrew = vi.fn<BrewRunner>(
    overrides.runBrew ?? (() => Promise.resolve(caskInfoJson("0.2.0"))),
  );

  return {
    startDetached,
    runBrew,
    instance: createHomebrewUpgrader({
      isInstalledApp: overrides.isInstalledApp ?? true,
      logFilePath: "/tmp/userData/logs/homebrew-update.log",
      fileExists: (candidate) => files.has(candidate),
      directoryExists: (candidate) => directories.has(candidate),
      startDetached,
      runBrew,
    }),
  };
};

describe("Homebrew binary resolution", () => {
  it("never resolves brew from PATH", () => {
    expect([...BREW_BINARY_CANDIDATES]).toEqual([
      "/opt/homebrew/bin/brew",
      "/usr/local/bin/brew",
    ]);
    expect(BREW_BINARY_CANDIDATES.every((candidate) => candidate.startsWith("/"))).toBe(
      true,
    );
  });

  it("prefers the Apple Silicon prefix when both exist", () => {
    expect(findBrewBinary(() => true)).toBe("/opt/homebrew/bin/brew");
  });

  it("falls back to the Intel prefix", () => {
    expect(findBrewBinary((candidate) => candidate === "/usr/local/bin/brew")).toBe(
      "/usr/local/bin/brew",
    );
  });

  it("reports no brew when neither prefix exists", () => {
    expect(findBrewBinary(() => false)).toBeNull();
  });

  it("derives the Caskroom entry from the brew prefix", () => {
    expect(caskroomPath("/opt/homebrew/bin/brew")).toBe(
      "/opt/homebrew/Caskroom/fixlang",
    );
    expect(caskroomPath("/usr/local/bin/brew")).toBe("/usr/local/Caskroom/fixlang");
  });
});

describe("upgrade script", () => {
  const script = buildUpgradeScript("/opt/homebrew/bin/brew");

  it("waits for the app to quit before replacing its bundle", () => {
    expect(script).toContain("/usr/bin/pgrep -x FixLang");
    expect(script.indexOf("pgrep")).toBeLessThan(script.indexOf("upgrade --cask"));
  });

  it("aborts instead of upgrading a still-running app", () => {
    expect(script).toContain('if [ "$waited" -ge 30 ]');
    expect(script).toContain("exit 1");
  });

  it("runs Homebrew non-interactively so it fails instead of hanging", () => {
    expect(script).toContain("export NONINTERACTIVE=1");
  });

  it("upgrades only the fixlang cask and reopens the app", () => {
    expect(script).toContain('"/opt/homebrew/bin/brew" upgrade --cask fixlang');
    expect(script).toContain("/usr/bin/open -b com.fixlang.app");
  });

  it("never automates Gatekeeper or escalates privileges", () => {
    expect(script).not.toMatch(/xattr|sudo|quarantine/);
  });
});

describe("cask version parsing", () => {
  it("reads the version the tap currently offers", () => {
    expect(parseCaskVersion(caskInfoJson("0.3.5"))).toBe("0.3.5");
  });

  it("ignores other casks in the same payload", () => {
    expect(
      parseCaskVersion(
        JSON.stringify({
          casks: [
            { token: "something-else", version: "9.9.9" },
            { token: "fixlang", version: "0.3.5" },
          ],
        }),
      ),
    ).toBe("0.3.5");
  });

  it.each([
    "",
    "not json",
    JSON.stringify({ casks: [] }),
    JSON.stringify({ casks: [{ token: "fixlang" }] }),
    JSON.stringify({ casks: [{ token: "fixlang", version: 3 }] }),
    JSON.stringify({ formulae: [] }),
  ])("returns null for unusable brew output", (stdout) => {
    expect(parseCaskVersion(stdout)).toBeNull();
  });
});

describe("Homebrew upgrader", () => {
  it("enables one-click updates for a cask install", () => {
    expect(upgrader().instance.canInstall).toBe(true);
  });

  it("stays disabled for a manual DMG install with no Caskroom entry", () => {
    expect(upgrader({ directories: [] }).instance.canInstall).toBe(false);
  });

  it("stays disabled when Homebrew is not installed", () => {
    expect(upgrader({ files: [] }).instance.canInstall).toBe(false);
  });

  it("stays disabled for an app running outside Applications", () => {
    expect(upgrader({ isInstalledApp: false }).instance.canInstall).toBe(false);
  });

  it("starts the detached helper with the log destination", () => {
    const { instance, startDetached } = upgrader();

    instance.startUpgrade();

    expect(startDetached).toHaveBeenCalledWith(
      buildUpgradeScript("/opt/homebrew/bin/brew"),
      "/tmp/userData/logs/homebrew-update.log",
    );
  });

  it("refreshes the tap before reading the version it can install", async () => {
    const { instance, runBrew } = upgrader();

    await expect(instance.getInstallableVersion()).resolves.toBe("0.2.0");

    expect(runBrew.mock.calls.map(([, args]) => [...args])).toEqual([
      ["update", "--quiet"],
      ["info", "--cask", "fixlang", "--json=v2"],
    ]);
  });

  it("still reports a version when the tap refresh fails", async () => {
    const { instance } = upgrader({
      runBrew: (_binary, args) =>
        args[0] === "update"
          ? Promise.reject(new Error("offline"))
          : Promise.resolve(caskInfoJson("0.2.0")),
    });

    await expect(instance.getInstallableVersion()).resolves.toBe("0.2.0");
  });

  it("reports an unknown version rather than a wrong one when brew fails", async () => {
    const { instance } = upgrader({
      runBrew: () => Promise.reject(new Error("brew exploded")),
    });

    await expect(instance.getInstallableVersion()).resolves.toBeNull();
  });

  it("never asks brew anything for an install it cannot upgrade", async () => {
    const { instance, runBrew } = upgrader({ directories: [] });

    await expect(instance.getInstallableVersion()).resolves.toBeNull();
    expect(runBrew).not.toHaveBeenCalled();
  });

  it("refuses to run anything when the install is not cask-managed", () => {
    const { instance, startDetached } = upgrader({ directories: [] });

    expect(() => instance.startUpgrade()).toThrow(
      "FixLang was not installed with the Homebrew cask",
    );
    expect(startDetached).not.toHaveBeenCalled();
  });
});
