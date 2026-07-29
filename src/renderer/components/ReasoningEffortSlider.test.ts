/**
 * @file ReasoningEffortSlider.test.ts
 * @description Pure mapping coverage for the slider's step ↔ effort contract.
 * UI rendering is not exercised (no RTL); see reasoningEffort.test.ts for the
 * shared helpers this component consumes.
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_REASONING_EFFORT,
  REASONING_EFFORT_STEPS,
  reasoningEffortToStepIndex,
  stepIndexToReasoningEffort,
} from "~/shared/reasoningEffort";

describe("ReasoningEffortSlider contract", () => {
  it("exposes five Faster→Smarter steps ending at xhigh", () => {
    expect(REASONING_EFFORT_STEPS).toHaveLength(5);
    expect(REASONING_EFFORT_STEPS[0]).toBe("minimal");
    expect(REASONING_EFFORT_STEPS[4]).toBe("xhigh");
  });

  it("starts unset presets on the middle (medium) step", () => {
    expect(reasoningEffortToStepIndex(undefined)).toBe(2);
    expect(stepIndexToReasoningEffort(2)).toBe(DEFAULT_REASONING_EFFORT);
  });
});
