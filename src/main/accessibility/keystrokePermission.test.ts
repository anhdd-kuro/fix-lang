/**
 * @file keystrokePermission.test.ts
 */
import { describe, expect, it } from "vitest";
import { isKeystrokePermissionDenied } from "./keystrokePermission";

// The exact stderr text macOS's AppleScript runtime produces when
// Accessibility permission has been revoked, transcribed from a real log
// captured on 0.4.0 after an unsigned-app update invalidated the TCC grant.
const REAL_DENIAL_MESSAGE =
  "66:98: execution error: System Events got an error: osascript is not allowed to send keystrokes. (1002)";

describe("isKeystrokePermissionDenied", () => {
  it("matches the real macOS denial string", () => {
    expect(isKeystrokePermissionDenied(REAL_DENIAL_MESSAGE)).toBe(true);
  });

  it("matches an Error instance wrapping the denial text", () => {
    expect(isKeystrokePermissionDenied(new Error(REAL_DENIAL_MESSAGE))).toBe(true);
  });

  it("matches a plain string rejection (copyHighlightedText's reject shape)", () => {
    expect(isKeystrokePermissionDenied(`Error: ${REAL_DENIAL_MESSAGE}`)).toBe(true);
  });

  it("matches an object with a message property", () => {
    expect(isKeystrokePermissionDenied({ message: REAL_DENIAL_MESSAGE })).toBe(true);
  });

  it("does not throw and returns false for null", () => {
    expect(isKeystrokePermissionDenied(null)).toBe(false);
  });

  it("does not throw and returns false for undefined", () => {
    expect(isKeystrokePermissionDenied(undefined)).toBe(false);
  });

  it("does not throw and returns false for a number", () => {
    expect(isKeystrokePermissionDenied(42)).toBe(false);
  });

  it("does not throw and returns false for an object with no message", () => {
    expect(isKeystrokePermissionDenied({ code: 1002 })).toBe(false);
  });

  it("does not throw and returns false for an object whose message isn't a string", () => {
    expect(isKeystrokePermissionDenied({ message: 1002 })).toBe(false);
  });

  // Negative case: an unrelated osascript failure must NOT be misreported as
  // a permission problem — the task explicitly calls this out as worse than
  // a generic error.
  it("does not match an unrelated osascript failure", () => {
    const unrelated =
      "31:45: execution error: System Events got an error: Some application isn't running. (-600)";
    expect(isKeystrokePermissionDenied(unrelated)).toBe(false);
  });

  it("does not match a generic command-not-found failure", () => {
    expect(isKeystrokePermissionDenied("Command failed: osascript: command not found")).toBe(
      false,
    );
  });

  it("does not match the bare (1002) code without any mention of keystrokes", () => {
    // Defense-in-depth: the code alone is not specific enough (see module
    // doc) — it must appear together with "keystrokes" to count.
    expect(isKeystrokePermissionDenied("execution error: not authorized. (1002)")).toBe(false);
  });
});
