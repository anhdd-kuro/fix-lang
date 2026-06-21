/**
 * @file resolve-model.test.ts
 * @description Tests for extractResolvedModel — picking the served model id out
 * of a raw provider response body, with fallback to the requested id.
 */
import { describe, expect, it } from "vitest";
import { extractResolvedModel } from "./resolve-model";

describe("extractResolvedModel", () => {
  const REQUESTED = "~openai/gpt-mini-latest";
  const RESOLVED = "openai/gpt-5.4-mini-20260317";

  it("returns the body.model when present (alias resolved to concrete id)", () => {
    expect(extractResolvedModel({ model: RESOLVED }, REQUESTED)).toBe(RESOLVED);
  });

  it("returns the fallback when body has no model field", () => {
    expect(extractResolvedModel({ usage: {} }, REQUESTED)).toBe(REQUESTED);
  });

  it("returns the fallback when body.model is not a string", () => {
    expect(extractResolvedModel({ model: 123 }, REQUESTED)).toBe(REQUESTED);
  });

  it("returns the fallback when body.model is empty", () => {
    expect(extractResolvedModel({ model: "" }, REQUESTED)).toBe(REQUESTED);
  });

  it("returns the fallback when body is null", () => {
    expect(extractResolvedModel(null, REQUESTED)).toBe(REQUESTED);
  });

  it("returns the fallback when body is not an object", () => {
    expect(extractResolvedModel("nope", REQUESTED)).toBe(REQUESTED);
  });
});
