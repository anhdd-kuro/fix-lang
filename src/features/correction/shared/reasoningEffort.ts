/**
 * @file reasoningEffort.ts
 * @description Per-preset and global reasoning effort for the AI SDK top-level
 * `reasoning` parameter. Electron-free — shared by main, preload, and renderer.
 *
 * Slider (None → Faster → Smarter) maps to four discrete values: `none` plus
 * three generic effort steps. `provider-default` is a stored/API value for presets
 * that inherit the profile-wide default; it is not a slider step.
 */

import { z } from "zod";
import { schemaGuard } from "~/features/core/shared/schemaGuard";

export const REASONING_EFFORT_STEPS = ["low", "medium", "high"] as const;

/**
 * Efforts that were slider steps in an earlier release, mapped to the step that
 * replaces them. A stored value must be REMAPPED, never dropped: falling back to
 * `undefined` reads as `provider-default`, which silently changes a preset's
 * behaviour instead of stepping it down one notch.
 */
const RETIRED_EFFORTS = new Map<string, ReasoningEffortStep>([
  ["minimal", "low"],
  ["xhigh", "high"],
]);

export type ReasoningEffortStep = (typeof REASONING_EFFORT_STEPS)[number];

/** Slider steps: None, then Faster→Smarter. */
export const REASONING_EFFORT_SLIDER_STEPS = [
  "none",
  ...REASONING_EFFORT_STEPS,
] as const;

export type ReasoningEffortSliderStep =
  (typeof REASONING_EFFORT_SLIDER_STEPS)[number];

/** Full AI SDK `reasoning` union, including non-slider values. */
export type ReasoningEffort = "provider-default" | "none" | ReasoningEffortStep;

/** Default slider step — None when no stored value exists. */
export const DEFAULT_REASONING_STEP_INDEX = 0;

export const DEFAULT_REASONING_EFFORT: ReasoningEffort = "none";

const ReasoningEffortSchema = z.enum([
  "provider-default",
  "none",
  ...REASONING_EFFORT_STEPS,
]);

export const isReasoningEffortStep = schemaGuard(
  z.enum(REASONING_EFFORT_STEPS),
);

export const isReasoningEffortSliderStep = schemaGuard(
  z.enum(REASONING_EFFORT_SLIDER_STEPS),
);

export const isReasoningEffort = schemaGuard(ReasoningEffortSchema);

/**
 * Normalize a stored/raw value. A retired effort steps down to its replacement;
 * anything else unknown becomes undefined (caller treats as provider-default /
 * omit from the request).
 */
export const sanitizeReasoningEffort = <Raw>(
  raw: Raw,
): ReasoningEffort | undefined => {
  const stored = z.string().safeParse(raw);
  const retired = stored.success ? RETIRED_EFFORTS.get(stored.data) : undefined;
  if (retired !== undefined) return retired;
  const effort = ReasoningEffortSchema.safeParse(raw);
  return effort.success ? effort.data : undefined;
};

/** Slider index for a stored effort. `provider-default` falls back to `fallback`. */
export const reasoningEffortToStepIndex = (
  effort: ReasoningEffort | undefined,
  fallback: ReasoningEffort = DEFAULT_REASONING_EFFORT,
): number => {
  const raw =
    effort === undefined || effort === "provider-default" ? fallback : effort;
  // A retired effort reaching here unsanitized would land on index -1 → None,
  // showing the slider at its weakest step for a preset stored at its strongest.
  const resolved = sanitizeReasoningEffort(raw) ?? raw;
  const index = REASONING_EFFORT_SLIDER_STEPS.findIndex(
    (step) => step === resolved,
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
  return REASONING_EFFORT_SLIDER_STEPS[clamped] ?? DEFAULT_REASONING_EFFORT;
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
  // Sanitized here too, so a retired effort still on disk can never be sent to
  // a provider that no longer accepts it.
  const resolved = sanitizeReasoningEffort(effort);
  if (resolved === undefined || resolved === "provider-default")
    return undefined;
  return resolved;
};
