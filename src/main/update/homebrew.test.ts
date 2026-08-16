import { describe, expect, it, vi } from "vitest";
import {
  BETA_CASK_TOKEN,
  BREW_BINARY_CANDIDATES,
  buildChannelSwitchScript,
  buildUpgradeScript,
  caskroomPath,
  caskVersionPath,
  detectActiveCaskChannel,
  downloadsCacheDir,
  isCaskToken,
  matchCachedDownload,
  createHomebrewUpgrader,
  findBrewBinary,
  parseCaskVersion,
  STABLE_CASK_TOKEN,
  type BrewRunner,
  type CaskToken,
} from "./homebrew";

const caskInfoJson = (version: string, token: string = STABLE_CASK_TOKEN): string =>
  JSON.stringify({ casks: [{ token, version }] });

const upgrader = (
  overrides: Partial<{
    isInstalledApp: boolean;
    caskToken: string;
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
      // Overrides come in as `string` so a test can hand this a token the
      // module does not recognize; the cast just satisfies the option's
      // narrower `CaskToken` type — the runtime guard is what is on trial.
      ...(overrides.caskToken === undefined
        ? {}
        : { caskToken: overrides.caskToken as CaskToken }),
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

describe("cask tokens", () => {
  it("recognizes only the two published tokens", () => {
    expect(isCaskToken(STABLE_CASK_TOKEN)).toBe(true);
    expect(isCaskToken(BETA_CASK_TOKEN)).toBe(true);
    expect(isCaskToken("fixlang-nightly")).toBe(false);
    expect(isCaskToken("")).toBe(false);
  });
});

describe("token-parameterised Caskroom paths", () => {
  it("derives the beta Caskroom entry from an explicit token", () => {
    expect(caskroomPath("/opt/homebrew/bin/brew", BETA_CASK_TOKEN)).toBe(
      "/opt/homebrew/Caskroom/fixlang@beta",
    );
  });

  it("refuses a token that is not one of the two known constants", () => {
    expect(caskroomPath("/opt/homebrew/bin/brew", "fixlang-nightly")).toBeNull();
  });

  it("derives a beta version directory from an explicit token", () => {
    expect(
      caskVersionPath("/opt/homebrew/bin/brew", "0.33.0-beta.1", BETA_CASK_TOKEN),
    ).toBe("/opt/homebrew/Caskroom/fixlang@beta/0.33.0-beta.1");
  });

  it("refuses an unknown token before building a version path", () => {
    expect(
      caskVersionPath("/opt/homebrew/bin/brew", "0.4.0", "fixlang-nightly"),
    ).toBeNull();
  });

  it("reads the beta cask's version from `brew info` output for an explicit token", () => {
    expect(
      parseCaskVersion(caskInfoJson("0.33.0-beta.1", BETA_CASK_TOKEN), BETA_CASK_TOKEN),
    ).toBe("0.33.0-beta.1");
  });

  it("refuses to parse against an unknown token", () => {
    expect(parseCaskVersion(caskInfoJson("0.2.0"), "fixlang-nightly")).toBeNull();
  });

  it("refuses to build an upgrade script for an unknown token", () => {
    expect(() =>
      buildUpgradeScript("/opt/homebrew/bin/brew", null, "fixlang-nightly"),
    ).toThrow();
  });
});

describe("beta channel probing", () => {
  /**
   * REGRESSION: before the token became an explicit argument, every probe in
   * this file was hard-coded to the stable Caskroom entry, so a beta-token
   * upgrader silently reported the install as un-upgradeable instead of
   * erroring — this is the named failure mode from the card, and this test
   * was seen failing (canInstall === false) against the unmodified code.
   */
  it("probes the beta Caskroom (not the stable one) when configured for the beta channel", () => {
    const { instance } = upgrader({
      caskToken: BETA_CASK_TOKEN,
      directories: ["/opt/homebrew/Caskroom/fixlang@beta"],
    });

    expect(instance.canInstall).toBe(true);
  });

  it("stays disabled for the beta channel when only the stable cask is staged", () => {
    const { instance } = upgrader({
      caskToken: BETA_CASK_TOKEN,
      directories: ["/opt/homebrew/Caskroom/fixlang"],
    });

    expect(instance.canInstall).toBe(false);
  });

  /**
   * REGRESSION: `readInstallableVersion` used to hard-code `--cask fixlang`
   * regardless of which cask the upgrader was created for, so a beta-channel
   * upgrader would silently ask brew about the STABLE cask and could report a
   * stable version as "installable" for a beta check. This test was seen
   * failing (argv contained "fixlang", not "fixlang@beta") against the
   * unmodified code.
   */
  it("passes the beta token, not the stable one, in the `brew info` argv", async () => {
    const { instance, runBrew } = upgrader({
      caskToken: BETA_CASK_TOKEN,
      directories: ["/opt/homebrew/Caskroom/fixlang@beta"],
      runBrew: () => Promise.resolve(caskInfoJson("0.33.0-beta.1", BETA_CASK_TOKEN)),
    });

    await expect(instance.getInstallableVersion()).resolves.toBe("0.33.0-beta.1");

    expect(runBrew.mock.calls.map(([, args]) => [...args])).toEqual([
      ["update", "--quiet"],
      ["info", "--cask", "fixlang@beta", "--json=v2"],
    ]);
  });

  it("passes the beta token in the `brew fetch` argv", async () => {
    const { instance, runBrew } = upgrader({
      caskToken: BETA_CASK_TOKEN,
      directories: ["/opt/homebrew/Caskroom/fixlang@beta"],
    });

    await instance.downloadUpdate();

    expect(runBrew.mock.calls.map(([, args]) => [...args])).toEqual([
      ["fetch", "--cask", "fixlang@beta"],
    ]);
  });

  it("sees a version staged under the beta Caskroom", () => {
    const { instance } = upgrader({
      caskToken: BETA_CASK_TOKEN,
      directories: [
        "/opt/homebrew/Caskroom/fixlang@beta",
        "/opt/homebrew/Caskroom/fixlang@beta/0.33.0-beta.1",
      ],
    });

    expect(instance.isVersionInstalled("0.33.0-beta.1")).toBe(true);
    expect(instance.isVersionInstalled("0.32.0")).toBe(false);
  });

  it("passes the beta token in the upgrade script's argv when starting the upgrade", () => {
    const { instance, startDetached } = upgrader({
      caskToken: BETA_CASK_TOKEN,
      directories: ["/opt/homebrew/Caskroom/fixlang@beta"],
    });

    instance.startUpgrade();

    expect(startDetached).toHaveBeenCalledWith(
      buildUpgradeScript("/opt/homebrew/bin/brew", null, BETA_CASK_TOKEN),
      "/tmp/userData/logs/homebrew-update.log",
    );
  });
});

describe("refuses an unknown cask token before it reaches a path or an argv", () => {
  it("never asks brew anything for an unrecognized token", async () => {
    const { instance, runBrew } = upgrader();

    await expect(
      instance.getInstallableVersion(true, "fixlang-nightly"),
    ).resolves.toBeNull();
    expect(runBrew).not.toHaveBeenCalled();
  });

  it("never checks the filesystem for an unrecognized token", () => {
    const directoryExists = vi.fn(() => true);
    const { instance } = (() => {
      const startDetached = vi.fn();
      const runBrew = vi.fn<BrewRunner>(() => Promise.resolve(caskInfoJson("0.2.0")));
      return {
        instance: createHomebrewUpgrader({
          isInstalledApp: true,
          logFilePath: "/tmp/userData/logs/homebrew-update.log",
          fileExists: () => true,
          directoryExists,
          startDetached,
          runBrew,
        }),
      };
    })();
    directoryExists.mockClear();

    expect(instance.isVersionInstalled("0.4.0", "fixlang-nightly")).toBe(false);
    expect(directoryExists).not.toHaveBeenCalled();
  });

  it("never runs `brew fetch` for an unrecognized token", async () => {
    const { instance, runBrew } = upgrader();

    await expect(instance.downloadUpdate("fixlang-nightly")).rejects.toThrow();
    expect(runBrew).not.toHaveBeenCalled();
  });

  it("never inspects the download cache for an unrecognized token", () => {
    const { instance } = upgrader({
      cacheEntries: ["abc123--FixLang-0.4.6-arm64.dmg"],
      fileSizes: { "/cache/downloads/abc123--FixLang-0.4.6-arm64.dmg": 128 },
    });

    expect(instance.getDownloadedBytes("0.4.6", "fixlang-nightly")).toBeNull();
  });

  it("never starts the detached helper for an unrecognized token", () => {
    const { instance, startDetached } = upgrader();

    expect(() => instance.startUpgrade(null, "fixlang-nightly")).toThrow();
    expect(startDetached).not.toHaveBeenCalled();
  });
});

describe("active channel detection", () => {
  it("reports stable when only the stable Caskroom entry exists", () => {
    const directoryExists = (candidate: string): boolean =>
      candidate === "/opt/homebrew/Caskroom/fixlang";

    expect(detectActiveCaskChannel("/opt/homebrew/bin/brew", directoryExists)).toBe(
      "stable",
    );
  });

  it("reports beta when only the beta Caskroom entry exists", () => {
    const directoryExists = (candidate: string): boolean =>
      candidate === "/opt/homebrew/Caskroom/fixlang@beta";

    expect(detectActiveCaskChannel("/opt/homebrew/bin/brew", directoryExists)).toBe(
      "beta",
    );
  });

  it("reports both when stable and beta are both staged", () => {
    expect(detectActiveCaskChannel("/opt/homebrew/bin/brew", () => true)).toBe("both");
  });

  it("reports neither as null", () => {
    expect(detectActiveCaskChannel("/opt/homebrew/bin/brew", () => false)).toBeNull();
  });

  it("never spawns a subprocess — only the two directory probes decide the answer", () => {
    const directoryExists = vi.fn(() => false);

    detectActiveCaskChannel("/opt/homebrew/bin/brew", directoryExists);

    expect(directoryExists).toHaveBeenCalledTimes(2);
    expect(directoryExists).toHaveBeenCalledWith("/opt/homebrew/Caskroom/fixlang");
    expect(directoryExists).toHaveBeenCalledWith(
      "/opt/homebrew/Caskroom/fixlang@beta",
    );
  });
});


describe("channel switch script", () => {
  const escapeRegExp = (value: string): string =>
    value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  const BREW = "/opt/homebrew/bin/brew";

  /**
   * Index of `"<brew>" <verb> --cask <token>`, anchored on both ends: the
   * quoted brew path in front rules out "install" matching inside
   * "uninstall" (the same substring problem in the other direction), and the
   * trailing negative lookahead rules out the stable token ("fixlang")
   * matching inside the beta token's command ("fixlang@beta") — while still
   * allowing the token to be followed by `;`, a quote, or whitespace, since
   * the retry/restore commands sit inside `if ! "..." install ...; then`.
   */
  const indexOfCaskCommand = (
    script: string,
    verb: string,
    token: string,
    fromIndex = 0,
  ): number => {
    const pattern = new RegExp(
      `"${escapeRegExp(BREW)}" ${verb} --cask ${escapeRegExp(token)}(?![A-Za-z0-9@])`,
      "g",
    );
    pattern.lastIndex = fromIndex;
    const match = pattern.exec(script);
    return match ? match.index : -1;
  };

  const script = buildChannelSwitchScript(
    "/opt/homebrew/bin/brew",
    STABLE_CASK_TOKEN,
    BETA_CASK_TOKEN,
  );

  const pgrepIdx = script.indexOf("/usr/bin/pgrep -x FixLang");
  const fetchIdx = indexOfCaskCommand(script, "fetch", BETA_CASK_TOKEN);
  const uninstallIdx = indexOfCaskCommand(script, "uninstall", STABLE_CASK_TOKEN);
  const firstInstallIdx = indexOfCaskCommand(script, "install", BETA_CASK_TOKEN);
  const secondInstallIdx =
    firstInstallIdx === -1
      ? -1
      : indexOfCaskCommand(script, "install", BETA_CASK_TOKEN, firstInstallIdx + 1);
  const restoreSearchStart = Math.max(uninstallIdx, secondInstallIdx) + 1;
  const restoreIdx = indexOfCaskCommand(
    script,
    "install",
    STABLE_CASK_TOKEN,
    restoreSearchStart,
  );
  const reopenIdx = script.lastIndexOf("/usr/bin/open -b com.fixlang.app");

  it("waits for the app to exit before touching either cask", () => {
    expect(pgrepIdx).toBeGreaterThanOrEqual(0);
    expect(pgrepIdx).toBeLessThan(fetchIdx);
  });

  /**
   * REGRESSION: fetch must fill the download cache while the CURRENT cask is
   * still installed. An uninstall emitted before the fetch was observed
   * failing here against a deliberately broken builder before this landed.
   */
  it("fetches the target cask before uninstalling the current one", () => {
    expect(fetchIdx).toBeGreaterThanOrEqual(0);
    expect(uninstallIdx).toBeGreaterThanOrEqual(0);
    expect(fetchIdx).toBeLessThan(uninstallIdx);
  });

  /**
   * REGRESSION: the target's bundle path only frees up once the current
   * token's cask is gone. An install emitted before the uninstall was
   * observed failing here against a deliberately broken builder before this
   * landed.
   */
  it("uninstalls the current cask before installing the target", () => {
    expect(uninstallIdx).toBeGreaterThanOrEqual(0);
    expect(firstInstallIdx).toBeGreaterThanOrEqual(0);
    expect(uninstallIdx).toBeLessThan(firstInstallIdx);
  });

  it("retries the target install exactly once before giving up on it", () => {
    expect(firstInstallIdx).toBeGreaterThanOrEqual(0);
    expect(secondInstallIdx).toBeGreaterThan(firstInstallIdx);
  });

  /**
   * REGRESSION: a missing restore-original step was observed failing here
   * against a deliberately broken builder before this landed — a failed
   * switch must leave the user where they started, not with nothing.
   */
  it("restores the ORIGINAL token — not the target — after both install attempts fail", () => {
    expect(restoreIdx).toBeGreaterThanOrEqual(0);
    expect(restoreIdx).toBeGreaterThan(secondInstallIdx);
  });

  it("reopens the app after the restore step", () => {
    expect(reopenIdx).toBeGreaterThan(restoreIdx);
  });

  it("never emits --zap or --force", () => {
    expect(script).not.toContain("--zap");
    expect(script).not.toContain("--force");
  });

  it("refuses to build a script naming an unknown current or target token", () => {
    expect(() =>
      buildChannelSwitchScript(
        "/opt/homebrew/bin/brew",
        "fixlang-nightly",
        BETA_CASK_TOKEN,
      ),
    ).toThrow();
    expect(() =>
      buildChannelSwitchScript(
        "/opt/homebrew/bin/brew",
        STABLE_CASK_TOKEN,
        "fixlang-nightly",
      ),
    ).toThrow();
  });

  it("refuses to switch a token to itself", () => {
    expect(() =>
      buildChannelSwitchScript(
        "/opt/homebrew/bin/brew",
        STABLE_CASK_TOKEN,
        STABLE_CASK_TOKEN,
      ),
    ).toThrow();
  });

  /**
   * The restore step must name whichever token was ORIGINAL for that
   * particular switch — proven here with the tokens reversed, so this is not
   * an artifact of one token happening to be the default.
   */
  it("names the correct original token when the switch direction is reversed", () => {
    const revert = buildChannelSwitchScript(
      "/opt/homebrew/bin/brew",
      BETA_CASK_TOKEN,
      STABLE_CASK_TOKEN,
    );
    const revertUninstallIdx = indexOfCaskCommand(revert, "uninstall", BETA_CASK_TOKEN);
    const revertRestoreIdx = indexOfCaskCommand(
      revert,
      "install",
      BETA_CASK_TOKEN,
      revertUninstallIdx + 1,
    );
    expect(revertUninstallIdx).toBeGreaterThanOrEqual(0);
    expect(revertRestoreIdx).toBeGreaterThan(revertUninstallIdx);
  });
});
