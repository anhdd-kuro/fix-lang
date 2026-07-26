import { describe, expect, it, vi } from "vitest";
import {
  BREW_BINARY_CANDIDATES,
  buildUpgradeScript,
  caskroomPath,
  caskVersionPath,
  downloadsCacheDir,
  matchCachedDownload,
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
    cacheEntries: readonly string[];
    fileSizes: Readonly<Record<string, number>>;
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
      cacheDir: "/cache/downloads",
      listDirectory: () => overrides.cacheEntries ?? [],
      fileSize: (candidate) => (overrides.fileSizes ?? {})[candidate] ?? null,
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

  /**
   * `open -b` resolves a bundle id, and a stray build in a checkout carries
   * the same one — so it can reopen an older copy of the app right after a
   * successful upgrade. The replaced path is the only unambiguous target.
   */
  it("reopens the exact bundle Homebrew replaced when the path is known", () => {
    const pinned = buildUpgradeScript(
      "/opt/homebrew/bin/brew",
      "/Applications/FixLang.app",
    );

    expect(pinned).toContain('/usr/bin/open -a "/Applications/FixLang.app"');
    // The id survives only as a fallback, after the path attempt.
    expect(pinned.indexOf("open -a")).toBeLessThan(pinned.indexOf("open -b"));
  });

  it("quotes a path containing spaces rather than rejecting it", () => {
    expect(
      buildUpgradeScript("/opt/homebrew/bin/brew", "/Applications/Fix Lang.app"),
    ).toContain('/usr/bin/open -a "/Applications/Fix Lang.app"');
  });

  it.each([
    'relative/FixLang.app',
    '/Applications/FixLang.app"; rm -rf /tmp/x; echo ".app',
    "/Applications/$(whoami).app",
    "/Applications/`id`.app",
    "/Applications/Fix\\Lang.app",
    "/Applications/Fix\nLang.app",
    "/Applications/FixLang",
  ])("falls back to the bundle id for an unsafe path: %s", (appPath) => {
    const fallback = buildUpgradeScript("/opt/homebrew/bin/brew", appPath);

    expect(fallback).not.toContain("open -a \"");
    expect(fallback).toContain("/usr/bin/open -b com.fixlang.app");
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

describe("download cache lookup", () => {
  it("matches Homebrew's <digest>--<basename> naming without recomputing it", () => {
    expect(
      matchCachedDownload(
        ["unrelated.dmg", "4cc981a4--FixLang-0.4.6-arm64.dmg"],
        "0.4.6",
      ),
    ).toBe("4cc981a4--FixLang-0.4.6-arm64.dmg");
  });

  it("falls back to the in-progress file", () => {
    expect(
      matchCachedDownload(["4cc981a4--FixLang-0.4.6-arm64.dmg.incomplete"], "0.4.6"),
    ).toBe("4cc981a4--FixLang-0.4.6-arm64.dmg.incomplete");
  });

  it.each([[[], "0.4.6"], [["4cc981a4--FixLang-0.4.5-arm64.dmg"], "0.4.6"]] as const)(
    "returns null when nothing matches",
    (entries, version) => {
      expect(matchCachedDownload(entries, version)).toBeNull();
    },
  );

  it.each(["../etc", "a/b", ""])(
    "refuses an unsafe version rather than building a pattern from it: %s",
    (version) => {
      expect(
        matchCachedDownload([`x--FixLang-${version}-arm64.dmg`], version),
      ).toBeNull();
    },
  );

  it("honours HOMEBREW_CACHE and otherwise uses the macOS default", () => {
    expect(downloadsCacheDir({ HOMEBREW_CACHE: "/custom" })).toBe(
      "/custom/downloads",
    );
    expect(downloadsCacheDir({ HOME: "/Users/x" })).toBe(
      "/Users/x/Library/Caches/Homebrew/downloads",
    );
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

  it("sees a version Homebrew already staged in the Caskroom", () => {
    const { instance } = upgrader({
      directories: [
        "/opt/homebrew/Caskroom/fixlang",
        "/opt/homebrew/Caskroom/fixlang/0.4.0",
      ],
    });

    expect(instance.isVersionInstalled("0.4.0")).toBe(true);
    expect(instance.isVersionInstalled("0.3.7")).toBe(false);
  });

  it.each(["../../../etc", "0.4.0/../..", "", "a/b", "0.4.0 "])(
    "never lets a version string escape the Caskroom: %s",
    (version) => {
      const { instance } = upgrader();

      expect(instance.isVersionInstalled(version)).toBe(false);
      expect(caskVersionPath("/opt/homebrew/bin/brew", version)).toBeNull();
    },
  );

  it("fetches only the cask download, leaving the installed bundle alone", async () => {
    const { instance, runBrew } = upgrader();

    await instance.downloadUpdate();

    expect(runBrew.mock.calls.map(([, args]) => [...args])).toEqual([
      ["fetch", "--cask", "fixlang"],
    ]);
    // A fetch must never be able to replace the running app.
    expect(runBrew.mock.calls.some(([, args]) => args.includes("upgrade"))).toBe(
      false,
    );
  });

  it("gives the download far longer than the metadata probes", async () => {
    const { instance, runBrew } = upgrader();

    await instance.getInstallableVersion();
    await instance.downloadUpdate();

    const [, , fetchTimeout] = runBrew.mock.calls.at(-1) ?? [];
    const probeTimeouts = runBrew.mock.calls
      .slice(0, -1)
      .map(([, , timeout]) => timeout);

    expect(fetchTimeout).toBeGreaterThan(90_000);
    expect(probeTimeouts.every((timeout) => timeout === undefined)).toBe(true);
  });

  it("refuses to download for an install it cannot upgrade", async () => {
    const { instance, runBrew } = upgrader({ directories: [] });

    await expect(instance.downloadUpdate()).rejects.toThrow(
      "FixLang was not installed with the Homebrew cask",
    );
    expect(runBrew).not.toHaveBeenCalled();
  });

  it("reads progress from the partial download as it grows", () => {
    const { instance } = upgrader({
      cacheEntries: ["abc123--FixLang-0.4.6-arm64.dmg.incomplete"],
      fileSizes: {
        "/cache/downloads/abc123--FixLang-0.4.6-arm64.dmg.incomplete": 42,
      },
    });

    expect(instance.getDownloadedBytes("0.4.6")).toBe(42);
  });

  it("prefers the completed download over a stale partial file", () => {
    const { instance } = upgrader({
      cacheEntries: [
        "abc123--FixLang-0.4.6-arm64.dmg.incomplete",
        "abc123--FixLang-0.4.6-arm64.dmg",
      ],
      fileSizes: {
        "/cache/downloads/abc123--FixLang-0.4.6-arm64.dmg.incomplete": 42,
        "/cache/downloads/abc123--FixLang-0.4.6-arm64.dmg": 128,
      },
    });

    expect(instance.getDownloadedBytes("0.4.6")).toBe(128);
  });

  it("reports nothing cached for another version", () => {
    const { instance } = upgrader({
      cacheEntries: ["abc123--FixLang-0.4.5-arm64.dmg"],
      fileSizes: { "/cache/downloads/abc123--FixLang-0.4.5-arm64.dmg": 128 },
    });

    expect(instance.getDownloadedBytes("0.4.6")).toBeNull();
  });

  it("refuses to run anything when the install is not cask-managed", () => {
    const { instance, startDetached } = upgrader({ directories: [] });

    expect(() => instance.startUpgrade()).toThrow(
      "FixLang was not installed with the Homebrew cask",
    );
    expect(startDetached).not.toHaveBeenCalled();
  });
});
