/**
 * @file axPermission.test.ts
 */
import { describe, expect, it } from "vitest";
import { isAxPermissionDenied } from "./axPermission";

describe("isAxPermissionDenied", () => {
  it("matches the assistive-access denial phrase", () => {
    expect(
      isAxPermissionDenied(
        "31:1: execution error: System Events got an error: FixLang is not allowed assistive access. (-1743)",
      ),
    ).toBe(true);
  });

  it("matches the Apple-event denial phrase", () => {
    expect(
      isAxPermissionDenied(
        "execution error: Not authorized to send Apple events to System Events. (-1743)",
      ),
    ).toBe(true);
  });

  it("matches the -1743 error code alone", () => {
    expect(isAxPermissionDenied("execution error: something odd. (-1743)")).toBe(true);
  });

  it("matches the -25211 error code alone", () => {
    expect(isAxPermissionDenied("execution error: something odd. (-25211)")).toBe(true);
  });

  // The error text handed to this predicate can quote a value read out of the
  // target app, so an unanchored /-1743/ would let an ordinary selection flip
  // permissionDenied and pop the System Settings dialog on a healthy grant.
  // Only the parenthesised trailing form osascript actually emits counts.
  describe("only the parenthesised code form counts", () => {
    it("does not match a bare -1743 inside quoted content", () => {
      expect(
        isAxPermissionDenied(
          'Command failed: osascript -e ... Can\'t make "budget delta -1743 vs forecast" into type text. (-1728)',
        ),
      ).toBe(false);
    });

    it("does not match a bare -25211 inside quoted content", () => {
      expect(isAxPermissionDenied("Can't make \"row -25211\" into type text. (-1728)")).toBe(
        false,
      );
    });

    it("does not match a code embedded in a longer number", () => {
      expect(isAxPermissionDenied("execution error: odd. (-17430)")).toBe(false);
    });
  });

  it("matches an Error instance wrapping the denial text", () => {
    expect(
      isAxPermissionDenied(new Error("System Events got an error: not allowed assistive access.")),
    ).toBe(true);
  });

  it("matches a plain string rejection", () => {
    expect(
      isAxPermissionDenied("Error: not authorized to send Apple events to Finder. (-1743)"),
    ).toBe(true);
  });

  it("matches an object with a message property", () => {
    expect(
      isAxPermissionDenied({ message: "not allowed assistive access. (-25211)" }),
    ).toBe(true);
  });

  // Observed in a live probe against a normal, permission-granted app: every
  // element with no AXSelectedText (or no focused element) surfaces this
  // code. It must NOT be misdiagnosed as a permission problem.
  it("does not match -1728 (attribute-missing, not a permission problem)", () => {
    expect(
      isAxPermissionDenied(
        "31:98: execution error: System Events got an error: Can't get attribute \"AXSelectedText\" of element. (-1728)",
      ),
    ).toBe(false);
  });

  it("does not match an unrelated osascript failure", () => {
    const unrelated =
      "31:45: execution error: System Events got an error: Some application isn't running. (-600)";
    expect(isAxPermissionDenied(unrelated)).toBe(false);
  });

  it("does not match a generic command-not-found failure", () => {
    expect(isAxPermissionDenied("Command failed: osascript: command not found")).toBe(false);
  });

  it("does not throw and returns false for null", () => {
    expect(isAxPermissionDenied(null)).toBe(false);
  });

  it("does not throw and returns false for undefined", () => {
    expect(isAxPermissionDenied(undefined)).toBe(false);
  });

  it("does not throw and returns false for a number", () => {
    expect(isAxPermissionDenied(42)).toBe(false);
  });

  it("does not throw and returns false for an object with no message", () => {
    expect(isAxPermissionDenied({ code: -1743 })).toBe(false);
  });

  it("does not throw and returns false for an object whose message isn't a string", () => {
    expect(isAxPermissionDenied({ message: -1743 })).toBe(false);
  });
});
