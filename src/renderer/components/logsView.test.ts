import { describe, expect, it } from "vitest";
import {
  filterLogs,
  logRowKey,
  timeZoneLabel,
  utcOffsetLabel,
} from "./logsView";
import type { LogEntry } from "~/features/logs/shared/logging";

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
  {
    id: "3",
    timestamp: "2026-07-19T00:02:00.000Z",
    level: "warn",
    scope: "selection.capture",
    message: "Selection empty",
  },
];

describe("filterLogs", () => {
  it("filters by level and case-insensitive search across metadata", () => {
    expect(
      filterLogs(entries, ["error"], "EXAMPLE").map((entry) => entry.id),
    ).toEqual(["2"]);
  });

  it("keeps every selected level (multi-select)", () => {
    expect(
      filterLogs(entries, ["warn", "error"], "").map((entry) => entry.id),
    ).toEqual(["2", "3"]);
  });

  it("returns all levels when the selection is empty", () => {
    expect(filterLogs(entries, [], "correction")).toEqual([entries[0]]);
  });
});

describe("utcOffsetLabel", () => {
  // `getTimezoneOffset()` reports minutes BEHIND UTC, so Asia/Tokyo is -540.
  it("renders east-of-UTC offsets with a plus sign", () => {
    expect(utcOffsetLabel(-540)).toBe("UTC+09:00");
  });

  it("renders west-of-UTC and half-hour offsets", () => {
    expect(utcOffsetLabel(300)).toBe("UTC-05:00");
    expect(utcOffsetLabel(-330)).toBe("UTC+05:30");
  });

  it("drops the sign at zero offset", () => {
    expect(utcOffsetLabel(0)).toBe("UTC");
  });
});

describe("timeZoneLabel", () => {
  const date = new Date("2026-07-19T00:00:00.000Z");
  const offset = utcOffsetLabel(date.getTimezoneOffset());

  it("pairs the IANA zone name with the numeric offset", () => {
    expect(timeZoneLabel(date, "Asia/Tokyo")).toBe(`Asia/Tokyo (${offset})`);
  });

  it("falls back to the offset alone when the zone name is unavailable", () => {
    expect(timeZoneLabel(date)).toBe(offset);
    expect(timeZoneLabel(date, "")).toBe(offset);
  });
});

describe("logRowKey", () => {
  it("keeps measured virtual-row identity stable when a live log is prepended", () => {
    const liveEntry: LogEntry = {
      id: "live",
      timestamp: "2026-07-19T00:03:00.000Z",
      level: "warn",
      scope: "selection.capture",
      message: "Long diagnostic entry",
    };

    expect(logRowKey(entries, 0)).toBe("1");
    expect(logRowKey([liveEntry, ...entries], 1)).toBe("1");
    expect(logRowKey([liveEntry, ...entries], 2)).toBe("2");
  });
});
