/**
 * @file ReasoningEffortSlider.tsx
 * @description Discrete 4-step None→Faster↔Smarter slider for generic AI reasoning.
 */
import React, { useId } from "react";
import {
  REASONING_EFFORT_SLIDER_STEPS,
  reasoningEffortToStepIndex,
  stepIndexToReasoningEffort,
  type ReasoningEffort,
  type ReasoningEffortSliderStep,
} from "~/shared/reasoningEffort";
import { useI18n } from "../../i18n/useI18n";

type ReasoningEffortSliderProps = {
  value: ReasoningEffort | undefined;
  onChange: (effort: ReasoningEffortSliderStep) => void;
  disabled?: boolean;
  /** When set, unset/`provider-default` values map to this step instead of None. */
  inheritFrom?: ReasoningEffort;
  /** Overrides the default "Reasoning effort" label text. */
  label?: React.ReactNode;
  /**
   * Adornment rendered next to the label (e.g. a help tooltip). Kept outside
   * the `aria-labelledby` span so it never leaks into the slider's accessible
   * name.
   */
  labelAdornment?: React.ReactNode;
};

const stepLabelKey = (
  step: ReasoningEffortSliderStep,
):
  | "settings.correction.reasoning.none"
  | `settings.correction.reasoning.step.${ReasoningEffortSliderStep}` => {
  if (step === "none") return "settings.correction.reasoning.none";
  return `settings.correction.reasoning.step.${step}`;
};

export const ReasoningEffortSlider: React.FC<ReasoningEffortSliderProps> = ({
  value,
  onChange,
  disabled = false,
  inheritFrom,
  label,
  labelAdornment,
}) => {
  const { t } = useI18n();
  const labelId = useId();
  const fallback = inheritFrom ?? "none";
  const stepIndex = reasoningEffortToStepIndex(value, fallback);
  const currentStep = stepIndexToReasoningEffort(stepIndex);
  const inheritsGlobal =
    inheritFrom !== undefined &&
    (value === undefined || value === "provider-default");

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <span
            id={`${labelId}-label`}
            className="font-medium text-card-foreground"
          >
            {label ?? t("settings.correction.reasoning.label")}
          </span>
          {labelAdornment}
        </div>
        {inheritsGlobal ? (
          <span className="tabular-nums">
            {t("settings.correction.reasoning.inheritGlobal", {
              value: t(stepLabelKey(currentStep)),
            })}
          </span>
        ) : null}
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
          {REASONING_EFFORT_SLIDER_STEPS.map((step, index) => (
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
          max={REASONING_EFFORT_SLIDER_STEPS.length - 1}
          step={1}
          value={stepIndex}
          disabled={disabled}
          aria-valuemin={0}
          aria-valuemax={REASONING_EFFORT_SLIDER_STEPS.length - 1}
          aria-valuenow={stepIndex}
          aria-valuetext={t(stepLabelKey(currentStep))}
          aria-labelledby={`${labelId}-label`}
          onChange={(event) => {
            onChange(stepIndexToReasoningEffort(Number(event.target.value)));
          }}
          className="reasoning-effort-slider absolute inset-0 z-10 h-8 w-full cursor-pointer appearance-none bg-transparent disabled:cursor-not-allowed disabled:opacity-50"
        />
      </div>
      <div className="relative h-4 text-[11px] leading-none" aria-hidden="true">
        {REASONING_EFFORT_SLIDER_STEPS.map((step, index) => (
          <span
            key={step}
            data-reasoning-step={step}
            className={`absolute whitespace-nowrap ${
              index === stepIndex
                ? "font-medium text-card-foreground"
                : "text-muted-foreground"
            }`}
            style={{
              left: `${(index / (REASONING_EFFORT_SLIDER_STEPS.length - 1)) * 100}%`,
              transform:
                index === 0
                  ? undefined
                  : index === REASONING_EFFORT_SLIDER_STEPS.length - 1
                    ? "translateX(-100%)"
                    : "translateX(-50%)",
            }}
          >
            {t(stepLabelKey(step))}
          </span>
        ))}
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
