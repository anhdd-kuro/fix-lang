/**
 * @file ReasoningEffortSlider.tsx
 * @description Discrete 5-step Faster↔Smarter slider for per-preset AI SDK reasoning.
 */
import React, { useId } from "react";
import {
  REASONING_EFFORT_STEPS,
  reasoningEffortToStepIndex,
  stepIndexToReasoningEffort,
  type ReasoningEffort,
  type ReasoningEffortStep,
} from "~/shared/reasoningEffort";
import { useI18n } from "../i18n/useI18n";

type ReasoningEffortSliderProps = {
  value: ReasoningEffort | undefined;
  onChange: (effort: ReasoningEffortStep) => void;
  disabled?: boolean;
};

export const ReasoningEffortSlider: React.FC<ReasoningEffortSliderProps> = ({
  value,
  onChange,
  disabled = false,
}) => {
  const { t } = useI18n();
  const labelId = useId();
  const stepIndex = reasoningEffortToStepIndex(value);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span id={`${labelId}-faster`}>{t("settings.correction.reasoning.faster")}</span>
        <span id={`${labelId}-smarter`}>{t("settings.correction.reasoning.smarter")}</span>
      </div>
      <div className="relative h-8">
        <div
          className="absolute left-0 right-0 top-1/2 h-2 -translate-y-1/2 rounded-full bg-secondary"
          aria-hidden="true"
        />
        <div
          className="pointer-events-none absolute left-0 right-0 top-1/2 flex -translate-y-1/2 justify-between px-0.5"
          aria-hidden="true"
        >
          {REASONING_EFFORT_STEPS.map((step, index) => (
            <span
              key={step}
              className={`h-1.5 w-1.5 rounded-full ${
                index === stepIndex ? "bg-primary" : "bg-muted-foreground/50"
              }`}
            />
          ))}
        </div>
        <input
          type="range"
          min={0}
          max={REASONING_EFFORT_STEPS.length - 1}
          step={1}
          value={stepIndex}
          disabled={disabled}
          aria-valuemin={0}
          aria-valuemax={REASONING_EFFORT_STEPS.length - 1}
          aria-valuenow={stepIndex}
          aria-valuetext={stepIndexToReasoningEffort(stepIndex)}
          aria-labelledby={`${labelId}-faster ${labelId}-smarter`}
          onChange={(event) => {
            onChange(stepIndexToReasoningEffort(Number(event.target.value)));
          }}
          className="reasoning-effort-slider absolute inset-0 z-10 h-8 w-full cursor-pointer appearance-none bg-transparent disabled:cursor-not-allowed disabled:opacity-50"
        />
      </div>
      <style>{`
        .reasoning-effort-slider::-webkit-slider-runnable-track {
          height: 0.5rem;
          background: transparent;
          border: none;
        }
        .reasoning-effort-slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 0.625rem;
          height: 1.25rem;
          margin-top: -0.375rem;
          border-radius: 9999px;
          background: var(--color-muted-foreground, #c4c4c4);
          border: none;
          box-shadow: 0 0 0 1px color-mix(in oklab, var(--color-background, #000) 40%, transparent);
        }
        .reasoning-effort-slider::-moz-range-track {
          height: 0.5rem;
          background: transparent;
          border: none;
        }
        .reasoning-effort-slider::-moz-range-thumb {
          width: 0.625rem;
          height: 1.25rem;
          border-radius: 9999px;
          background: var(--color-muted-foreground, #c4c4c4);
          border: none;
        }
      `}</style>
    </div>
  );
};
