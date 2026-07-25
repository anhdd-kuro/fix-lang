import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createPendingInstallStore,
  parsePendingInstall,
  reconcilePendingInstall,
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

    store.write({ fromVersion: "0.3.2", toVersion: "0.3.3" });

    expect(store.read()).toEqual({ fromVersion: "0.3.2", toVersion: "0.3.3" });
  });

  it("reads nothing when no update is pending", () => {
    expect(createPendingInstallStore(markerPath()).read()).toBeNull();
  });

  it("clears the marker without failing on a missing file", () => {
    const store = createPendingInstallStore(markerPath());
    store.write({ fromVersion: "0.3.2", toVersion: "0.3.3" });

    store.clear();
    store.clear();

    expect(store.read()).toBeNull();
  });

  it("ignores a corrupt marker instead of breaking startup", () => {
    const filePath = markerPath();
    const store = createPendingInstallStore(filePath);
    store.write({ fromVersion: "0.3.2", toVersion: "0.3.3" });
    writeFileSync(filePath, "{ not json", "utf8");

    expect(store.read()).toBeNull();
  });

  it("writes a single trailing newline", () => {
    const filePath = markerPath();
    createPendingInstallStore(filePath).write({
      fromVersion: "0.3.2",
      toVersion: "0.3.3",
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
  it("reports nothing when no update was started", () => {
    expect(reconcilePendingInstall(null, "0.3.2")).toBe("none");
  });

  it("reports success once the version actually changed", () => {
    expect(
      reconcilePendingInstall(
        { fromVersion: "0.3.2", toVersion: "0.3.3" },
        "0.3.3",
      ),
    ).toBe("installed");
  });

  it("reports failure when Homebrew left the old bundle in place", () => {
    expect(
      reconcilePendingInstall(
        { fromVersion: "0.3.2", toVersion: "0.3.3" },
        "0.3.2",
      ),
    ).toBe("failed");
  });
});
