/**
 * @file ReasoningEffortSlider.test.ts
 * @description Pure mapping coverage for the slider's step ↔ effort contract.
 * UI rendering is not exercised (no RTL); see reasoningEffort.test.ts for the
 * shared helpers this component consumes.
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_REASONING_EFFORT,
  REASONING_EFFORT_SLIDER_STEPS,
  reasoningEffortToStepIndex,
  stepIndexToReasoningEffort,
} from "~/shared/reasoningEffort";

describe("ReasoningEffortSlider contract", () => {
  it("exposes six None→Smarter steps ending at xhigh", () => {
    expect(REASONING_EFFORT_SLIDER_STEPS).toHaveLength(6);
    expect(REASONING_EFFORT_SLIDER_STEPS[0]).toBe("none");
    expect(REASONING_EFFORT_SLIDER_STEPS[5]).toBe("xhigh");
  });

  it("starts unset presets on None", () => {
    expect(reasoningEffortToStepIndex(undefined)).toBe(0);
    expect(stepIndexToReasoningEffort(0)).toBe(DEFAULT_REASONING_EFFORT);
  });
});
