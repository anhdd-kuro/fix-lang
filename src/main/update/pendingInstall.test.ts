import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createPendingInstallStore,
  parsePendingInstall,
  reconcilePendingInstall,
  UPGRADE_GRACE_MS,
} from "./pendingInstall";

const temporaryDirectories: string[] = [];

const markerPath = (): string => {
  const directory = mkdtempSync(path.join(tmpdir(), "fixlang-update-"));
  temporaryDirectories.push(directory);
  return path.join(directory, "nested", "pending-update.json");
};

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    rmSync(temporaryDirectories.pop() as string, {
      recursive: true,
      force: true,
    });
  }
});

describe("pending install marker", () => {
  it("round-trips the recorded versions", () => {
    const store = createPendingInstallStore(markerPath());

    store.write({
      fromVersion: "0.3.2",
      toVersion: "0.3.3",
      startedAt: 1_000,
      appPath: "/Applications/FixLang.app",
    });

    expect(store.read()).toEqual({
      fromVersion: "0.3.2",
      toVersion: "0.3.3",
      startedAt: 1_000,
      appPath: "/Applications/FixLang.app",
    });
  });

  it("reads nothing when no update is pending", () => {
    expect(createPendingInstallStore(markerPath()).read()).toBeNull();
  });

  it("clears the marker without failing on a missing file", () => {
    const store = createPendingInstallStore(markerPath());
    store.write({
      fromVersion: "0.3.2",
      toVersion: "0.3.3",
      startedAt: 1_000,
      appPath: "/Applications/FixLang.app",
    });

    store.clear();
    store.clear();

    expect(store.read()).toBeNull();
  });

  it("ignores a corrupt marker instead of breaking startup", () => {
    const filePath = markerPath();
    const store = createPendingInstallStore(filePath);
    store.write({
      fromVersion: "0.3.2",
      toVersion: "0.3.3",
      startedAt: 1_000,
      appPath: "/Applications/FixLang.app",
    });
    writeFileSync(filePath, "{ not json", "utf8");

    expect(store.read()).toBeNull();
  });

  it("writes a single trailing newline", () => {
    const filePath = markerPath();
    createPendingInstallStore(filePath).write({
      fromVersion: "0.3.2",
      toVersion: "0.3.3",
      startedAt: 1_000,
      appPath: "/Applications/FixLang.app",
    });

    expect(readFileSync(filePath, "utf8").endsWith("}\n")).toBe(true);
  });

  it.each([
    "null",
    "[]",
    '"0.3.3"',
    '{"fromVersion":"0.3.2"}',
    '{"fromVersion":"","toVersion":"0.3.3"}',
    '{"fromVersion":"0.3.2","toVersion":3}',
  ])("rejects malformed marker content: %s", (raw) => {
    expect(parsePendingInstall(raw)).toBeNull();
  });
});

describe("pending install reconciliation", () => {
  const STARTED_AT = 1_000_000;
  const INSTALLED_PATH = "/Applications/FixLang.app";
  const STRAY_PATH = "/Users/dev/code/fix-lang/release/mac-arm64/FixLang.app";
  const marker = {
    fromVersion: "0.3.2",
    toVersion: "0.3.3",
    startedAt: STARTED_AT,
    appPath: INSTALLED_PATH,
  };
  const context = (
    overrides: Partial<{
      now: number;
      isTargetInstalled: boolean;
      runningAppPath: string | null;
    }> = {},
  ) => ({
    now: overrides.now ?? STARTED_AT + 1_000,
    isTargetInstalled: overrides.isTargetInstalled ?? false,
    runningAppPath:
      overrides.runningAppPath === undefined
        ? INSTALLED_PATH
        : overrides.runningAppPath,
  });

  it("reports nothing when no update was started", () => {
    expect(reconcilePendingInstall(null, "0.3.2", context())).toBe("none");
  });

  it("reports success once the version actually changed", () => {
    expect(reconcilePendingInstall(marker, "0.3.3", context())).toBe(
      "installed",
    );
  });

  it("keeps waiting when the helper is still inside the grace window", () => {
    expect(
      reconcilePendingInstall(
        marker,
        "0.3.2",
        context({ now: STARTED_AT + UPGRADE_GRACE_MS - 1 }),
      ),
    ).toBe("in-progress");
  });

  it("asks for a restart once Homebrew staged the new version", () => {
    expect(
      reconcilePendingInstall(
        marker,
        "0.3.2",
        context({ isTargetInstalled: true }),
      ),
    ).toBe("restart-required");
  });

  it("prefers the installed result over an expired grace window", () => {
    expect(
      reconcilePendingInstall(
        marker,
        "0.3.2",
        context({
          now: STARTED_AT + UPGRADE_GRACE_MS * 10,
          isTargetInstalled: true,
        }),
      ),
    ).toBe("restart-required");
  });

  /**
   * The bug this guards: `open -b <bundle id>` after an upgrade can launch a
   * stray build that shares the id, and a "version changed" test then reports
   * that downgrade as a completed update.
   */
  it("refuses to call a different bundle an update, even at another version", () => {
    expect(
      reconcilePendingInstall(
        marker,
        "0.2.9",
        context({ runningAppPath: STRAY_PATH }),
      ),
    ).toBe("wrong-bundle");
  });

  it("still reports wrong-bundle once Homebrew staged the target", () => {
    // A restart is the remedy either way, but only this outcome knows the
    // restart has to open another path instead of re-executing this one.
    expect(
      reconcilePendingInstall(
        marker,
        "0.2.9",
        context({ runningAppPath: STRAY_PATH, isTargetInstalled: true }),
      ),
    ).toBe("wrong-bundle");
  });

  it("accepts the target version from whatever bundle reports it", () => {
    // Already the version that was asked for: nothing to warn about.
    expect(
      reconcilePendingInstall(
        marker,
        "0.3.3",
        context({ runningAppPath: STRAY_PATH }),
      ),
    ).toBe("installed");
  });

  it("treats a version beyond the target as installed, not as a wrong bundle", () => {
    // Same bundle, upgraded past the target by hand between click and launch.
    expect(reconcilePendingInstall(marker, "0.4.0", context())).toBe(
      "installed",
    );
  });

  it.each([
    ["an unknown running path", { runningAppPath: null }],
    ["a marker written before app paths were recorded", {}],
  ])("falls back to the version test with %s", (_label, overrides) => {
    const legacyMarker =
      Object.keys(overrides).length === 0 ? { ...marker, appPath: "" } : marker;

    expect(
      reconcilePendingInstall(legacyMarker, "0.2.9", context(overrides)),
    ).toBe("installed");
  });

  it("reports failure once the grace window closes with nothing installed", () => {
    expect(
      reconcilePendingInstall(
        marker,
        "0.3.2",
        context({ now: STARTED_AT + UPGRADE_GRACE_MS }),
      ),
    ).toBe("failed");
  });

  it("treats a marker with no timestamp as long expired", () => {
    expect(
      reconcilePendingInstall(
        { ...marker, startedAt: 0 },
        "0.3.2",
        context({ now: UPGRADE_GRACE_MS }),
      ),
    ).toBe("failed");
  });

  it.each([undefined, -1, 1.5, "1000", Number.MAX_VALUE])(
    "reads an unusable startedAt as 0 rather than trusting it: %s",
    (startedAt) => {
      expect(
        parsePendingInstall(
          JSON.stringify({
            fromVersion: "0.3.2",
            toVersion: "0.3.3",
            startedAt,
          }),
        ),
      ).toEqual({
        fromVersion: "0.3.2",
        toVersion: "0.3.3",
        startedAt: 0,
        appPath: "",
      });
    },
  );

  it.each([undefined, 42, null, { path: "/Applications" }])(
    "reads an unusable appPath as empty rather than trusting it: %s",
    (appPath) => {
      expect(
        parsePendingInstall(
          JSON.stringify({
            fromVersion: "0.3.2",
            toVersion: "0.3.3",
            startedAt: 1_000,
            appPath,
          }),
        )?.appPath,
      ).toBe("");
    },
  );
});
