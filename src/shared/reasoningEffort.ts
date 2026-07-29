/**
 * @file reasoningEffort.ts
 * @description Per-preset and global reasoning effort for the AI SDK top-level
 * `reasoning` parameter. Electron-free — shared by main, preload, and renderer.
 *
 * Slider (None → Faster → Smarter) maps to six discrete values: `none` plus
 * five SDK effort steps. `provider-default` is a stored/API value for presets
 * that inherit the profile-wide default; it is not a slider step.
 */

export const REASONING_EFFORT_STEPS = [
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
] as const;

export type ReasoningEffortStep = (typeof REASONING_EFFORT_STEPS)[number];

/** Slider steps: None, then Faster→Smarter. */
export const REASONING_EFFORT_SLIDER_STEPS = [
  "none",
  ...REASONING_EFFORT_STEPS,
] as const;

export type ReasoningEffortSliderStep =
  (typeof REASONING_EFFORT_SLIDER_STEPS)[number];

/** Full AI SDK `reasoning` union, including non-slider values. */
export type ReasoningEffort =
  | "provider-default"
  | "none"
  | ReasoningEffortStep;

/** Default slider step — None when no stored value exists. */
export const DEFAULT_REASONING_STEP_INDEX = 0;

export const DEFAULT_REASONING_EFFORT: ReasoningEffort = "none";

const STEP_SET = new Set<string>(REASONING_EFFORT_STEPS);
const SLIDER_STEP_SET = new Set<string>(REASONING_EFFORT_SLIDER_STEPS);

const ALL_EFFORTS = new Set<string>([
  "provider-default",
  "none",
  ...REASONING_EFFORT_STEPS,
]);

export const isReasoningEffortStep = (value: unknown): value is ReasoningEffortStep =>
  typeof value === "string" && STEP_SET.has(value);

export const isReasoningEffortSliderStep = (
  value: unknown,
): value is ReasoningEffortSliderStep =>
  typeof value === "string" && SLIDER_STEP_SET.has(value);

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

/** Slider index for a stored effort. `provider-default` falls back to `fallback`. */
export const reasoningEffortToStepIndex = (
  effort: ReasoningEffort | undefined,
  fallback: ReasoningEffort = DEFAULT_REASONING_EFFORT,
): number => {
  const resolved =
    effort === undefined || effort === "provider-default" ? fallback : effort;
  const index = REASONING_EFFORT_SLIDER_STEPS.indexOf(
    resolved as ReasoningEffortSliderStep,
  );
  return index >= 0 ? index : DEFAULT_REASONING_STEP_INDEX;
};

export const stepIndexToReasoningEffort = (
  index: number,
): ReasoningEffortSliderStep => {
  const clamped = Math.max(
    0,
    Math.min(REASONING_EFFORT_SLIDER_STEPS.length - 1, Math.round(index)),
  );
  return (
    REASONING_EFFORT_SLIDER_STEPS[clamped] ?? DEFAULT_REASONING_EFFORT
  );
};

/**
 * Effective effort for a transform: preset override, else profile default,
 * else None.
 */
export const resolveReasoningEffort = (
  presetEffort: ReasoningEffort | undefined,
  globalDefault: ReasoningEffort | undefined,
): ReasoningEffort => {
  if (presetEffort !== undefined && presetEffort !== "provider-default") {
    return presetEffort;
  }
  const global = sanitizeReasoningEffort(globalDefault);
  return global ?? DEFAULT_REASONING_EFFORT;
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
