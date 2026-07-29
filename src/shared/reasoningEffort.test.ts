/**
 * @file reasoningEffort.test.ts
 * @description Pure mapping tests for the None→Faster↔Smarter slider → AI SDK reasoning.
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_REASONING_EFFORT,
  DEFAULT_REASONING_STEP_INDEX,
  REASONING_EFFORT_SLIDER_STEPS,
  REASONING_EFFORT_STEPS,
  isReasoningEffort,
  isReasoningEffortStep,
  reasoningEffortToStepIndex,
  reasoningForAiSdk,
  resolveReasoningEffort,
  sanitizeReasoningEffort,
  stepIndexToReasoningEffort,
} from "./reasoningEffort";

describe("REASONING_EFFORT_SLIDER_STEPS mapping (None → Faster → Smarter)", () => {
  it("has six discrete steps starting at none", () => {
    expect(REASONING_EFFORT_SLIDER_STEPS).toEqual([
      "none",
      "minimal",
      "low",
      "medium",
      "high",
      "xhigh",
    ]);
    expect(REASONING_EFFORT_STEPS).toHaveLength(5);
  });

  it("defaults to none", () => {
    expect(DEFAULT_REASONING_STEP_INDEX).toBe(0);
    expect(DEFAULT_REASONING_EFFORT).toBe("none");
    expect(REASONING_EFFORT_SLIDER_STEPS[DEFAULT_REASONING_STEP_INDEX]).toBe("none");
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
    for (let index = 0; index < REASONING_EFFORT_SLIDER_STEPS.length; index += 1) {
      const effort = stepIndexToReasoningEffort(index);
      expect(reasoningEffortToStepIndex(effort)).toBe(index);
      expect(effort).toBe(REASONING_EFFORT_SLIDER_STEPS[index]);
    }
  });

  it("maps unset / provider-default to the fallback step", () => {
    expect(reasoningEffortToStepIndex(undefined)).toBe(0);
    expect(reasoningEffortToStepIndex("provider-default")).toBe(0);
    expect(reasoningEffortToStepIndex(undefined, "medium")).toBe(3);
    expect(reasoningEffortToStepIndex("provider-default", "medium")).toBe(3);
  });

  it("clamps out-of-range indices", () => {
    expect(stepIndexToReasoningEffort(-1)).toBe("none");
    expect(stepIndexToReasoningEffort(99)).toBe("xhigh");
  });
});

describe("resolveReasoningEffort", () => {
  it("uses preset override when set", () => {
    expect(resolveReasoningEffort("high", "none")).toBe("high");
  });

  it("inherits the global default when preset is unset or provider-default", () => {
    expect(resolveReasoningEffort(undefined, "low")).toBe("low");
    expect(resolveReasoningEffort("provider-default", "low")).toBe("low");
    expect(resolveReasoningEffort(undefined, undefined)).toBe("none");
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
