import React, { useEffect, useState } from "react";
import { DEFAULT_CORRECTION_OUTPUT_MODE } from "~/shared/outputMode";
import { SegmentedControl } from "./SegmentedControl";
import { useI18n } from "../i18n/useI18n";
import type { CorrectionOutputMode } from "~/shared/outputMode";

/**
 * Transform output-mode switcher (Show popup vs Direct paste) rendered as a
 * segmented control, same tray-and-settings split as `LanguageTabs`: this is
 * the compact tray rendering of the value; `SettingGeneral.tsx` renders the
 * same underlying `getCorrectionOutputMode`/`setCorrectionOutputMode` value
 * as a labelled radio group with descriptions.
 *
 * Loads once on mount and saves on change — mirrors `SettingGeneral`'s own
 * load/save pattern; changing the mode does not currently broadcast
 * `settings-updated`, so this and `SettingGeneral` are not kept live in sync
 * with each other while both are open (same gap that already exists there).
 */

export type OutputModeTabsSize = "sm" | "md";

type OutputModeTabsProps = {
  /** `sm` for dense surfaces (tray); `md` for settings. */
  size?: OutputModeTabsSize;
  /** Extra classes for the container — e.g. `w-full` in a settings panel. */
  className?: string;
};

export const OutputModeTabs: React.FC<OutputModeTabsProps> = ({
  size = "sm",
  className,
}) => {
  const { t } = useI18n();
  const [mode, setMode] = useState<CorrectionOutputMode>(
    DEFAULT_CORRECTION_OUTPUT_MODE,
  );

  useEffect(() => {
    let mounted = true;
    window.electronAPI
      ?.getCorrectionOutputMode?.()
      .then((value) => {
        if (mounted) {
          setMode(value);
        }
      })
      .catch((error: unknown) => {
        console.error("OutputModeTabs: Error loading output mode:", error);
      });
    return () => {
      mounted = false;
    };
  }, []);

  return (
    <SegmentedControl
      value={mode}
      onChange={(next) => {
        const previous = mode;
        setMode(next);
        void window.electronAPI
          ?.setCorrectionOutputMode?.(next)
          .then((result) => {
            if (!result.success) {
              setMode(previous);
            }
          })
          .catch((error: unknown) => {
            console.error("OutputModeTabs: Error saving output mode:", error);
            setMode(previous);
          });
      }}
      ariaLabel={t("settings.general.correctionOutput.title")}
      size={size}
      equalWidth
      className={className}
      options={[
        {
          value: "paste",
          label: t("settings.general.correctionOutput.paste.label"),
        },
        {
          value: "popup",
          label: t("settings.general.correctionOutput.popup.label"),
        },
      ]}
    />
  );
};

export default OutputModeTabs;
