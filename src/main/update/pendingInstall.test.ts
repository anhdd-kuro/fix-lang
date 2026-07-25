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

    store.write({ fromVersion: "0.3.2", toVersion: "0.3.3", startedAt: 1_000 });

    expect(store.read()).toEqual({
      fromVersion: "0.3.2",
      toVersion: "0.3.3",
      startedAt: 1_000,
    });
  });

  it("reads nothing when no update is pending", () => {
    expect(createPendingInstallStore(markerPath()).read()).toBeNull();
  });

  it("clears the marker without failing on a missing file", () => {
    const store = createPendingInstallStore(markerPath());
    store.write({ fromVersion: "0.3.2", toVersion: "0.3.3", startedAt: 1_000 });

    store.clear();
    store.clear();

    expect(store.read()).toBeNull();
  });

  it("ignores a corrupt marker instead of breaking startup", () => {
    const filePath = markerPath();
    const store = createPendingInstallStore(filePath);
    store.write({ fromVersion: "0.3.2", toVersion: "0.3.3", startedAt: 1_000 });
    writeFileSync(filePath, "{ not json", "utf8");

    expect(store.read()).toBeNull();
  });

  it("writes a single trailing newline", () => {
    const filePath = markerPath();
    createPendingInstallStore(filePath).write({
      fromVersion: "0.3.2",
      toVersion: "0.3.3",
      startedAt: 1_000,
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
  const marker = {
    fromVersion: "0.3.2",
    toVersion: "0.3.3",
    startedAt: STARTED_AT,
  };
  const context = (
    overrides: Partial<{ now: number; isTargetInstalled: boolean }> = {},
  ) => ({
    now: overrides.now ?? STARTED_AT + 1_000,
    isTargetInstalled: overrides.isTargetInstalled ?? false,
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
      reconcilePendingInstall(marker, "0.3.2", {
        now: STARTED_AT + UPGRADE_GRACE_MS * 10,
        isTargetInstalled: true,
      }),
    ).toBe("restart-required");
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
        { fromVersion: "0.3.2", toVersion: "0.3.3", startedAt: 0 },
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
      ).toEqual({ fromVersion: "0.3.2", toVersion: "0.3.3", startedAt: 0 });
    },
  );
});
