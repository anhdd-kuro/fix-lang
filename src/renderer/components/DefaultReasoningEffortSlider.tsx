/**
 * @file DefaultReasoningEffortSlider.tsx
 * @description Profile-wide default reasoning effort control for the tray —
 * the same Faster↔Smarter slider used per-preset in Settings, wired to the
 * profile-wide default persistence calls instead of a single preset.
 */
import React, { useCallback, useEffect, useState } from "react";
import { DEFAULT_REASONING_EFFORT, type ReasoningEffort } from "~/shared/reasoningEffort";
import { ReasoningEffortSlider } from "./ReasoningEffortSlider";

type DefaultReasoningEffortSliderProps = {
  className?: string;
  /** Overrides the default "Reasoning effort" label text. */
  label?: React.ReactNode;
  /** Adornment rendered next to the label (e.g. a help tooltip). */
  labelAdornment?: React.ReactNode;
};

export const DefaultReasoningEffortSlider: React.FC<
  DefaultReasoningEffortSliderProps
> = ({ className, label, labelAdornment }) => {
  const [effort, setEffort] = useState<ReasoningEffort>(DEFAULT_REASONING_EFFORT);

  const reloadEffort = useCallback((): void => {
    void window.electronAPI
      ?.getDefaultReasoningEffort?.()
      .then((value) => {
        if (value) {
          setEffort(value);
        }
      })
      .catch((error: unknown) => {
        console.error("DefaultReasoningEffortSlider: failed to load default", error);
      });
  }, []);

  useEffect(() => {
    reloadEffort();
  }, [reloadEffort]);

  useEffect(() => {
    // Tray stays mounted across profile switches and settings edits in other
    // windows — without these subscriptions the slider would keep showing the
    // previous profile's effort while writes go to the active one.
    const offProfile = window.electronAPI?.onActiveProfileChanged?.(reloadEffort);
    const offSettings = window.electronAPI?.onSettingsUpdated?.(reloadEffort);
    return () => {
      offProfile?.();
      offSettings?.();
    };
  }, [reloadEffort]);

  return (
    <div className={className}>
      <ReasoningEffortSlider
        value={effort}
        label={label}
        labelAdornment={labelAdornment}
        onChange={(next) => {
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
              console.error("DefaultReasoningEffortSlider: failed to save", error);
              setEffort(previous);
            });
        }}
      />
    </div>
  );
};

export default DefaultReasoningEffortSlider;
