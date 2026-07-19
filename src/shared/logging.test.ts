import { describe, expect, it } from "vitest";
import {
  appendToRing,
  formatLogEntries,
  redactLogContext,
  redactLogMessage,
} from "./logging";
import type { LogEntry } from "./logging";

const makeEntry = (id: string): LogEntry => ({
  id,
  timestamp: "2026-07-19T00:00:00.000Z",
  level: "info",
  scope: "test",
  message: `message ${id}`,
});

describe("redactLogMessage", () => {
  it("redacts API keys and authorization tokens", () => {
    const message = [
      "apiKey=sk-secret123456789",
      "Authorization: Bearer token-secret-value",
      "OPENROUTER_API_KEY=or-secret-value",
    ].join(" ");

    const redacted = redactLogMessage(message);

    expect(redacted).not.toContain("sk-secret123456789");
    expect(redacted).not.toContain("token-secret-value");
    expect(redacted).not.toContain("or-secret-value");
    expect(redacted).toContain("[REDACTED]");
  });
});

describe("redactLogContext", () => {
  it("redacts sensitive fields while preserving safe metadata", () => {
    expect(
      redactLogContext({
        apiKey: "sk-private",
        clipboardText: "private selected text",
        presetId: "correction",
        nested: { authorization: "Bearer private-token", count: 2 },
      }),
    ).toEqual({
      apiKey: "[REDACTED]",
      clipboardText: "[REDACTED]",
      presetId: "correction",
      nested: { authorization: "[REDACTED]", count: 2 },
    });
  });
});

describe("appendToRing", () => {
  it("trims oldest entries when capacity is exceeded", () => {
    const entries = [makeEntry("1"), makeEntry("2")];

    expect(
      appendToRing(entries, makeEntry("3"), 2).map((entry) => entry.id),
    ).toEqual(["2", "3"]);
  });

  it("returns an empty ring when capacity is zero", () => {
    expect(appendToRing([makeEntry("1")], makeEntry("2"), 0)).toEqual([]);
  });
});

describe("formatLogEntries", () => {
  it("formats structured entries as export-safe text", () => {
    expect(formatLogEntries([makeEntry("1")])).toBe(
      "[2026-07-19T00:00:00.000Z] [INFO] [test] message 1",
    );
  });
});
