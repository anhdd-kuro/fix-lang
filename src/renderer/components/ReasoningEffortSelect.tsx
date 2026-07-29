/**
 * @file ReasoningEffortSelect.tsx
 * @description Compact native select for the profile-wide default reasoning
 * effort. Same control pattern as other tray selectors — not a slider.
 */
import React, { useEffect, useState } from "react";
import {
  DEFAULT_REASONING_EFFORT,
  REASONING_EFFORT_SLIDER_STEPS,
  isReasoningEffortSliderStep,
  type ReasoningEffort,
  type ReasoningEffortSliderStep,
} from "~/shared/reasoningEffort";
import { Select } from "./Select";
import { useI18n } from "../i18n/useI18n";

const stepLabelKey = (
  step: ReasoningEffortSliderStep,
):
  | "settings.correction.reasoning.none"
  | `settings.correction.reasoning.step.${Exclude<ReasoningEffortSliderStep, "none">}` => {
  if (step === "none") return "settings.correction.reasoning.none";
  return `settings.correction.reasoning.step.${step}`;
};

type ReasoningEffortSelectProps = {
  className?: string;
  /** Extra classes for the `<select>` itself. */
  selectClassName?: string;
  /** Stable id for an external `<label htmlFor>`. */
  id?: string;
};

export const ReasoningEffortSelect: React.FC<ReasoningEffortSelectProps> = ({
  className,
  selectClassName = "w-full px-2 py-1.5 text-xs",
  id = "tray-reasoning-select",
}) => {
  const { t } = useI18n();
  const [effort, setEffort] = useState<ReasoningEffort>(DEFAULT_REASONING_EFFORT);

  useEffect(() => {
    let mounted = true;
    window.electronAPI
      ?.getDefaultReasoningEffort?.()
      .then((value) => {
        if (mounted && value) {
          setEffort(value);
        }
      })
      .catch((error: unknown) => {
        console.error("ReasoningEffortSelect: failed to load default", error);
      });
    return () => {
      mounted = false;
    };
  }, []);

  return (
    <div className={className}>
      <Select
        id={id}
        aria-label={t("tray.global.reasoning.ariaLabel")}
        className={selectClassName}
        value={
          isReasoningEffortSliderStep(effort) ? effort : DEFAULT_REASONING_EFFORT
        }
        onChange={(event) => {
          const next = event.target.value;
          if (!isReasoningEffortSliderStep(next)) return;
          const previous = effort;
          setEffort(next);
          void window.electronAPI
            ?.setDefaultReasoningEffort?.(next)
            .then((result) => {
              if (!result.success) {
                setEffort(previous);
              }
            })
            .catch((error: unknown) => {
              console.error("ReasoningEffortSelect: failed to save", error);
              setEffort(previous);
            });
        }}
      >
        {REASONING_EFFORT_SLIDER_STEPS.map((step) => (
          <option key={step} value={step}>
            {t(stepLabelKey(step))}
          </option>
        ))}
      </Select>
    </div>
  );
};

export default ReasoningEffortSelect;
