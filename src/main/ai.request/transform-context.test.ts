/**
 * @file transform-context.test.ts
 * @description Tests for the shared source-app context block appended to the
 * system prompt of transform and PromptGen requests. Pure unit tests.
 */
import { describe, expect, it } from "vitest";
import {
  buildActiveAppContextBlock,
  withActiveAppContext,
} from "./transform-context";

describe("buildActiveAppContextBlock", () => {
  it("names the app and forbids echoing it", () => {
    const block = buildActiveAppContextBlock({ activeAppName: "Slack" });

    expect(block).toContain('"Slack"');
    expect(block).toMatch(/do not mention/i);
    // Must read as metadata, so the model does not transform the block itself.
    expect(block).toMatch(/not content to act on/i);
  });

  it("returns null when there is no usable app name", () => {
    expect(buildActiveAppContextBlock()).toBeNull();
    expect(buildActiveAppContextBlock({})).toBeNull();
    expect(buildActiveAppContextBlock({ activeAppName: null })).toBeNull();
    expect(buildActiveAppContextBlock({ activeAppName: "" })).toBeNull();
    expect(buildActiveAppContextBlock({ activeAppName: "   " })).toBeNull();
  });

  it("trims the app name", () => {
    expect(buildActiveAppContextBlock({ activeAppName: "  Mail " })).toContain(
      '"Mail"',
    );
  });
});

describe("withActiveAppContext", () => {
  it("appends the block after the caller's system prompt", () => {
    const result = withActiveAppContext("Fix grammar.", {
      activeAppName: "Slack",
    });

    expect(result.startsWith("Fix grammar.")).toBe(true);
    expect(result).toContain('"Slack"');
  });

  it("returns the system prompt untouched when no app name is known", () => {
    // Byte-identical to the pre-feature prompt: a failed frontmost-app read
    // must not perturb the request at all — including any provider prompt
    // cache keyed on this exact string (see ./cache-strategy).
    expect(withActiveAppContext("Fix grammar.")).toBe("Fix grammar.");
    expect(withActiveAppContext("Fix grammar.", { activeAppName: null })).toBe(
      "Fix grammar.",
    );
  });
});
