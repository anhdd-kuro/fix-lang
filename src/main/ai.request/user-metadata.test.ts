/**
 * @file user-metadata.test.ts
 * @description The apply half of Ask-environment metadata: empty is identity,
 * a real block trails (or sits before the last line), and nothing here wraps
 * the source-app `# Metadata context` heading.
 */
import { describe, expect, it } from "vitest";
import { withUserMetadata } from "./user-metadata";

const DIRECTIVES = [
  "App locale: en",
  "System language: en-US",
  "Keyboard input source: ABC",
  "Current time: 2026-08-11T14:32:05+09:00 (Asia/Tokyo)",
].join("\n");

describe("withUserMetadata", () => {
  it("appends the directive block after the caller's system prompt", () => {
    const result = withUserMetadata("Fix grammar.", DIRECTIVES);

    expect(result.startsWith("Fix grammar.")).toBe(true);
    expect(result).toContain("Keyboard input source: ABC");
    expect(result.indexOf("Fix grammar.")).toBeLessThan(
      result.indexOf("App locale: en"),
    );
  });

  it.each([
    ["undefined", undefined],
    ["null", null],
    ["an empty string", ""],
    ["whitespace only", "  \n  "],
  ])("returns the system prompt byte-identical for %s", (_label, directives) => {
    expect(withUserMetadata("Fix grammar.", directives)).toBe("Fix grammar.");
  });

  it("does not invent a Metadata context heading", () => {
    expect(withUserMetadata("Fix grammar.", DIRECTIVES)).not.toContain(
      "# Metadata context",
    );
  });

  it("trims surrounding whitespace on the block without touching the prompt prefix", () => {
    expect(withUserMetadata("Fix grammar.", `\n${DIRECTIVES}\n`)).toBe(
      `Fix grammar.\n\n${DIRECTIVES}`,
    );
  });
});

describe("withUserMetadata — before-last-line", () => {
  const autocompleteShaped = [
    "Reply with one JSON object only:",
    '{"suggestion":"<text appended at the caret>"}',
    "",
    "- Context blocks are background only.",
    '- Nothing worth suggesting: {"suggestion":""}',
  ].join("\n");

  it("keeps the first and last lines in place so a continuation still lands on JSON", () => {
    const result = withUserMetadata(
      autocompleteShaped,
      DIRECTIVES,
      "before-last-line",
    );
    const lines = result.split("\n");

    expect(lines[0]).toBe("Reply with one JSON object only:");
    expect(lines[lines.length - 1]).toBe(
      '- Nothing worth suggesting: {"suggestion":""}',
    );
    expect(result).toContain("App locale: en");
    expect(result.indexOf("App locale: en")).toBeLessThan(
      result.indexOf('- Nothing worth suggesting: {"suggestion":""}'),
    );
  });

  it("returns the prompt byte-identical when there is nothing to insert", () => {
    expect(withUserMetadata(autocompleteShaped, "", "before-last-line")).toBe(
      autocompleteShaped,
    );
  });

  it("falls back to trailing when the prompt has no newline", () => {
    expect(withUserMetadata("one-line", DIRECTIVES, "before-last-line")).toBe(
      `one-line\n\n${DIRECTIVES}`,
    );
  });
});
