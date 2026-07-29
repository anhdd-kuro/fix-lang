/**
 * @file reasoningEffort.ts
 * @description Per-preset reasoning effort for the AI SDK top-level `reasoning`
 * parameter. Electron-free — shared by main, preload, and renderer.
 *
 * Slider (Faster → Smarter) maps to five discrete SDK values. `provider-default`
 * and `none` are valid stored/API values but are not slider steps: unset presets
 * omit the field (AI SDK default = provider-default); `none` is reserved if a
 * caller needs an explicit disable outside the slider.
 */

export const REASONING_EFFORT_STEPS = [
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
] as const;

export type ReasoningEffortStep = (typeof REASONING_EFFORT_STEPS)[number];

/** Full AI SDK `reasoning` union, including non-slider values. */
export type ReasoningEffort =
  | "provider-default"
  | "none"
  | ReasoningEffortStep;

/** Middle slider step — Faster↔Smarter default when a preset has no stored value. */
export const DEFAULT_REASONING_STEP_INDEX = 2;

export const DEFAULT_REASONING_EFFORT: ReasoningEffortStep =
  REASONING_EFFORT_STEPS[DEFAULT_REASONING_STEP_INDEX];

const STEP_SET = new Set<string>(REASONING_EFFORT_STEPS);

const ALL_EFFORTS = new Set<string>([
  "provider-default",
  "none",
  ...REASONING_EFFORT_STEPS,
]);

export const isReasoningEffortStep = (value: unknown): value is ReasoningEffortStep =>
  typeof value === "string" && STEP_SET.has(value);

export const isReasoningEffort = (value: unknown): value is ReasoningEffort =>
  typeof value === "string" && ALL_EFFORTS.has(value);

/**
 * Normalize a stored/raw value. Unknown strings become undefined (caller treats
 * as provider-default / omit from the request).
 */
export const sanitizeReasoningEffort = (raw: unknown): ReasoningEffort | undefined => {
  if (!isReasoningEffort(raw)) return undefined;
  return raw;
};

/** Slider index for a stored effort. Non-step values fall back to the middle. */
export const reasoningEffortToStepIndex = (effort: ReasoningEffort | undefined): number => {
  if (effort === undefined || effort === "provider-default" || effort === "none") {
    return DEFAULT_REASONING_STEP_INDEX;
  }
  const index = REASONING_EFFORT_STEPS.indexOf(effort);
  return index >= 0 ? index : DEFAULT_REASONING_STEP_INDEX;
};

export const stepIndexToReasoningEffort = (index: number): ReasoningEffortStep => {
  const clamped = Math.max(0, Math.min(REASONING_EFFORT_STEPS.length - 1, Math.round(index)));
  return REASONING_EFFORT_STEPS[clamped] ?? DEFAULT_REASONING_EFFORT;
};

/**
 * Value to pass to generateText/streamText. `undefined` and `provider-default`
 * both omit the parameter so the provider keeps its default.
 */
export const reasoningForAiSdk = (
  effort: ReasoningEffort | undefined,
): ReasoningEffortStep | "none" | undefined => {
  if (effort === undefined || effort === "provider-default") return undefined;
  return effort;
};
