import { describe, expect, it } from "vitest";
import { filterLogs, logRowKey } from "./logsView";
import type { LogEntry } from "~/shared/logging";

const entries: LogEntry[] = [
  {
    id: "1",
    timestamp: "2026-07-19T00:00:00.000Z",
    level: "info",
    scope: "correction",
    message: "Correction completed",
  },
  {
    id: "2",
    timestamp: "2026-07-19T00:01:00.000Z",
    level: "error",
    scope: "openrouter",
    message: "Request failed",
    context: { model: "example/model" },
  },
];

describe("filterLogs", () => {
  it("filters by level and case-insensitive search across metadata", () => {
    expect(
      filterLogs(entries, "error", "EXAMPLE").map((entry) => entry.id),
    ).toEqual(["2"]);
  });

  it("returns all levels when filter is all", () => {
    expect(filterLogs(entries, "all", "correction")).toEqual([entries[0]]);
  });
});

describe("logRowKey", () => {
  it("keeps measured virtual-row identity stable when a live log is prepended", () => {
    const liveEntry: LogEntry = {
      id: "live",
      timestamp: "2026-07-19T00:02:00.000Z",
      level: "warn",
      scope: "selection.capture",
      message: "Long diagnostic entry",
    };

    expect(logRowKey(entries, 0)).toBe("1");
    expect(logRowKey([liveEntry, ...entries], 1)).toBe("1");
    expect(logRowKey([liveEntry, ...entries], 2)).toBe("2");
  });
});
