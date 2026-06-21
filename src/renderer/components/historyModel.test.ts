/**
 * @file historyModel.test.ts
 * @description Tests for formatModelLineage — history model display logic.
 */
import { describe, expect, it } from "vitest";
import { formatModelLineage } from "./historyModel";

describe("formatModelLineage", () => {
  const ALIAS = "~openai/gpt-mini-latest";
  const CONCRETE = "openai/gpt-5.4-mini-20260317";

  it("shows requested → resolved when they differ", () => {
    expect(formatModelLineage(ALIAS, CONCRETE)).toBe(`${ALIAS} → ${CONCRETE}`);
  });

  it("shows only the model when resolved is identical", () => {
    expect(formatModelLineage(CONCRETE, CONCRETE)).toBe(CONCRETE);
  });

  it("shows only the model when resolved is missing (legacy entry)", () => {
    expect(formatModelLineage(CONCRETE, undefined)).toBe(CONCRETE);
  });

  it("shows only the resolved when requested is missing", () => {
    expect(formatModelLineage(undefined, CONCRETE)).toBe(CONCRETE);
  });

  it("returns empty string when both are missing", () => {
    expect(formatModelLineage(undefined, undefined)).toBe("");
  });

  it("ignores an empty resolved value", () => {
    expect(formatModelLineage(ALIAS, "")).toBe(ALIAS);
  });
});
