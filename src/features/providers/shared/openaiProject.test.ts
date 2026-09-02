/**
 * @file openaiProject.test.ts
 * @description The OpenAI project id is stored, not discovered, so the only thing
 * standing between a mistyped paste and a card that reports nothing forever is
 * this sanitizer.
 */
import { describe, expect, it } from "vitest";
import {
  isMalformedOpenAIProjectId,
  sanitizeOpenAIProjectId,
} from "./openaiProject";

describe("sanitizeOpenAIProjectId", () => {
  it("accepts a project id, trimming surrounding whitespace from a paste", () => {
    expect(sanitizeOpenAIProjectId("proj_abc123")).toBe("proj_abc123");
    expect(sanitizeOpenAIProjectId("  proj_abc123\n")).toBe("proj_abc123");
    expect(sanitizeOpenAIProjectId("proj_A-b_9")).toBe("proj_A-b_9");
  });

  it("treats empty and whitespace-only as not configured", () => {
    expect(sanitizeOpenAIProjectId("")).toBeUndefined();
    expect(sanitizeOpenAIProjectId("   ")).toBeUndefined();
    expect(sanitizeOpenAIProjectId(undefined)).toBeUndefined();
    expect(sanitizeOpenAIProjectId(null)).toBeUndefined();
    expect(sanitizeOpenAIProjectId(42)).toBeUndefined();
  });

  it("rejects the ids and keys most likely to be pasted into the field", () => {
    // An organization id, an admin key, and a bare project name all reach the
    // API as a filter that matches nothing — which looks like "$0.00 spend".
    expect(sanitizeOpenAIProjectId("org-abc123")).toBeUndefined();
    expect(sanitizeOpenAIProjectId("sk-admin-abc123")).toBeUndefined();
    expect(sanitizeOpenAIProjectId("Default project")).toBeUndefined();
    expect(sanitizeOpenAIProjectId("proj_")).toBeUndefined();
    expect(sanitizeOpenAIProjectId("proj_has space")).toBeUndefined();
  });
});

describe("isMalformedOpenAIProjectId", () => {
  it("is false for an empty field — unset is not an error", () => {
    expect(isMalformedOpenAIProjectId("")).toBe(false);
    expect(isMalformedOpenAIProjectId("  ")).toBe(false);
  });

  it("is true only for a non-empty value that is not a project id", () => {
    expect(isMalformedOpenAIProjectId("org-abc123")).toBe(true);
    expect(isMalformedOpenAIProjectId("proj_abc123")).toBe(false);
  });
});
