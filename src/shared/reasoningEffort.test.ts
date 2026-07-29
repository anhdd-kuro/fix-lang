/**
 * @file reasoningEffort.test.ts
 * @description Pure mapping tests for the Faster↔Smarter slider → AI SDK reasoning.
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_REASONING_EFFORT,
  DEFAULT_REASONING_STEP_INDEX,
  REASONING_EFFORT_STEPS,
  isReasoningEffort,
  isReasoningEffortStep,
  reasoningEffortToStepIndex,
  reasoningForAiSdk,
  sanitizeReasoningEffort,
  stepIndexToReasoningEffort,
} from "./reasoningEffort";

describe("REASONING_EFFORT_STEPS mapping (Faster → Smarter)", () => {
  it("has five discrete steps: minimal → low → medium → high → xhigh", () => {
    expect(REASONING_EFFORT_STEPS).toEqual([
      "minimal",
      "low",
      "medium",
      "high",
      "xhigh",
    ]);
  });

  it("defaults the middle step to medium", () => {
    expect(DEFAULT_REASONING_STEP_INDEX).toBe(2);
    expect(DEFAULT_REASONING_EFFORT).toBe("medium");
    expect(REASONING_EFFORT_STEPS[DEFAULT_REASONING_STEP_INDEX]).toBe("medium");
  });
});

describe("sanitizeReasoningEffort / type guards", () => {
  it("accepts every AI SDK reasoning value", () => {
    for (const value of [
      "provider-default",
      "none",
      "minimal",
      "low",
      "medium",
      "high",
      "xhigh",
    ]) {
      expect(isReasoningEffort(value)).toBe(true);
      expect(sanitizeReasoningEffort(value)).toBe(value);
    }
  });

  it("rejects unknown values", () => {
    expect(sanitizeReasoningEffort("turbo")).toBeUndefined();
    expect(sanitizeReasoningEffort(1)).toBeUndefined();
    expect(sanitizeReasoningEffort(null)).toBeUndefined();
    expect(isReasoningEffortStep("none")).toBe(false);
    expect(isReasoningEffortStep("provider-default")).toBe(false);
  });
});

describe("step index ↔ effort", () => {
  it("round-trips each slider step", () => {
    for (let index = 0; index < REASONING_EFFORT_STEPS.length; index += 1) {
      const effort = stepIndexToReasoningEffort(index);
      expect(reasoningEffortToStepIndex(effort)).toBe(index);
      expect(effort).toBe(REASONING_EFFORT_STEPS[index]);
    }
  });

  it("maps unset / provider-default / none to the middle slider index", () => {
    expect(reasoningEffortToStepIndex(undefined)).toBe(2);
    expect(reasoningEffortToStepIndex("provider-default")).toBe(2);
    expect(reasoningEffortToStepIndex("none")).toBe(2);
  });

  it("clamps out-of-range indices", () => {
    expect(stepIndexToReasoningEffort(-1)).toBe("minimal");
    expect(stepIndexToReasoningEffort(99)).toBe("xhigh");
  });
});

describe("reasoningForAiSdk", () => {
  it("omits provider-default and undefined so the SDK keeps its default", () => {
    expect(reasoningForAiSdk(undefined)).toBeUndefined();
    expect(reasoningForAiSdk("provider-default")).toBeUndefined();
  });

  it("passes through slider steps and none", () => {
    expect(reasoningForAiSdk("minimal")).toBe("minimal");
    expect(reasoningForAiSdk("xhigh")).toBe("xhigh");
    expect(reasoningForAiSdk("none")).toBe("none");
  });
});
