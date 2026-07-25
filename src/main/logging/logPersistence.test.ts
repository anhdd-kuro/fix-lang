import { mkdir, writeFile, mkdtemp  } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { serializeLogJsonLine } from "~/shared/logging";
import { queryPersistedLogs, readAllPersistedLogs } from "./logPersistence";
import type { LogEntry } from "~/shared/logging";

const makeEntry = (
  id: string,
  timestamp: string,
  level: LogEntry["level"] = "info",
): LogEntry => ({
  id,
  timestamp,
  level,
  scope: "test",
  message: `message ${id}`,
});

describe("queryPersistedLogs", () => {
  let root: string;

  afterEach(async () => {
    // Temp dirs are left for OS cleanup; no sync rm required in tests.
  });

  it("returns newest-first pages across day folders", async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "fixlang-logs-"));
    const dayA = path.join(root, "2026-07-19");
    const dayB = path.join(root, "2026-07-20");
    await mkdir(dayA, { recursive: true });
    await mkdir(dayB, { recursive: true });

    await writeFile(
      path.join(dayA, "fixlang.jsonl"),
      [
        serializeLogJsonLine(makeEntry("a1", "2026-07-19T10:00:00.000Z")),
        serializeLogJsonLine(makeEntry("a2", "2026-07-19T11:00:00.000Z")),
      ].join("\n"),
      "utf8",
    );
    await writeFile(
      path.join(dayB, "fixlang.jsonl"),
      [
        serializeLogJsonLine(makeEntry("b1", "2026-07-20T09:00:00.000Z")),
        serializeLogJsonLine(makeEntry("b2", "2026-07-20T12:00:00.000Z")),
      ].join("\n"),
      "utf8",
    );

    const first = await queryPersistedLogs(root, { limit: 2 });
    expect(first.entries.map((entry) => entry.id)).toEqual(["b2", "b1"]);
    expect(first.hasMore).toBe(true);
    expect(first.nextCursor).toBe("2026-07-20T09:00:00.000Z");

    const second = await queryPersistedLogs(root, {
      limit: 10,
      beforeTimestamp: first.nextCursor ?? undefined,
    });
    expect(second.entries.map((entry) => entry.id)).toEqual(["a2", "a1"]);
    expect(second.hasMore).toBe(false);

    const all = await readAllPersistedLogs(root);
    expect(all.map((entry) => entry.id)).toEqual(["a1", "a2", "b1", "b2"]);
  });

  it("keeps every selected severity and treats an empty selection as all", async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "fixlang-logs-levels-"));
    const day = path.join(root, "2026-07-21");
    await mkdir(day, { recursive: true });
    await writeFile(
      path.join(day, "fixlang.jsonl"),
      [
        serializeLogJsonLine(makeEntry("d", "2026-07-21T10:00:00.000Z", "debug")),
        serializeLogJsonLine(makeEntry("i", "2026-07-21T11:00:00.000Z", "info")),
        serializeLogJsonLine(makeEntry("w", "2026-07-21T12:00:00.000Z", "warn")),
        serializeLogJsonLine(makeEntry("e", "2026-07-21T13:00:00.000Z", "error")),
      ].join("\n"),
      "utf8",
    );

    const warnAndError = await queryPersistedLogs(root, {
      levels: ["warn", "error"],
    });
    expect(warnAndError.entries.map((entry) => entry.id)).toEqual(["e", "w"]);

    const empty = await queryPersistedLogs(root, { levels: [] });
    expect(empty.entries.map((entry) => entry.id)).toEqual([
      "e",
      "w",
      "i",
      "d",
    ]);

    // A full selection normalizes to the same "no filter" shape as `[]`.
    const everyLevel = await queryPersistedLogs(root, {
      levels: ["debug", "info", "warn", "error"],
    });
    expect(everyLevel.entries.map((entry) => entry.id)).toEqual([
      "e",
      "w",
      "i",
      "d",
    ]);
  });
});
