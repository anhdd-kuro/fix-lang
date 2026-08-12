import React, { useEffect, useRef, useState } from "react";
import { DEFAULT_CORRECTION_OUTPUT_MODE } from "~/features/correction/shared/outputMode";
import { messageLabel } from "~/features/i18n/shared/message";
import { SegmentedControl } from "./SegmentedControl";
import {
  plainStatus,
  resolveStatus,
  wrappedError,
  type StatusDescriptor,
} from "./statusDescriptor";
import { useI18n } from "../i18n/useI18n";
import type { CorrectionOutputMode } from "~/features/correction/shared/outputMode";

/**
 * Transform output-mode switcher (Show popup vs Direct paste) rendered as a
 * segmented control, same tray-and-settings split as `LanguageTabs`: this is
 * the compact tray rendering of the value; `SettingGeneral.tsx` renders the
 * same underlying `getCorrectionOutputMode`/`setCorrectionOutputMode` value
 * with optional save-status feedback when `showSaveStatus` is set.
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
  /** Settings panel: show saving/error status and disable while persisting. */
  showSaveStatus?: boolean;
};

export const OutputModeTabs: React.FC<OutputModeTabsProps> = ({
  size = "sm",
  className,
  showSaveStatus = false,
}) => {
  const { t, tm, tl } = useI18n();
  const [mode, setMode] = useState<CorrectionOutputMode>(
    DEFAULT_CORRECTION_OUTPUT_MODE,
  );
  const [saveStatus, setSaveStatus] = useState<StatusDescriptor | null>(null);
  const [saveIsError, setSaveIsError] = useState(false);
  const [saving, setSaving] = useState(false);
  const savedStatusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelSavedStatusTimer = () => {
    if (savedStatusTimerRef.current !== null) {
      clearTimeout(savedStatusTimerRef.current);
      savedStatusTimerRef.current = null;
    }
  };

  useEffect(() => () => cancelSavedStatusTimer(), []);

  useEffect(() => {
    let mounted = true;
    const api = window.electronAPI;

    if (!api?.getCorrectionOutputMode) {
      void Promise.resolve().then(() => {
        if (mounted && showSaveStatus) {
          setSaveIsError(true);
          setSaveStatus(
            wrappedError(messageLabel("settings.general.outputMode.unavailable")),
          );
        }
      });
      return () => {
        mounted = false;
      };
    }

    api
      .getCorrectionOutputMode()
      .then((value) => {
        if (mounted) {
          setMode(value);
        }
      })
      .catch((error: unknown) => {
        console.error("OutputModeTabs: Error loading output mode:", error);
        if (mounted && showSaveStatus) {
          setSaveIsError(true);
          setSaveStatus(
            wrappedError(messageLabel("settings.general.outputMode.unavailable")),
          );
        }
      });
    return () => {
      mounted = false;
    };
  }, [showSaveStatus]);

  const persistMode = async (next: CorrectionOutputMode) => {
    const api = window.electronAPI;
    if (!api?.setCorrectionOutputMode) {
      if (showSaveStatus) {
        cancelSavedStatusTimer();
        setSaveIsError(true);
        setSaveStatus(
          wrappedError(messageLabel("settings.general.outputMode.unavailable")),
        );
      }
      return;
    }

    const previous = mode;
    setMode(next);
    if (showSaveStatus) {
      cancelSavedStatusTimer();
      setSaving(true);
      setSaveIsError(false);
      setSaveStatus(plainStatus("settings.general.outputMode.saving"));
    }

    try {
      const result = await api.setCorrectionOutputMode(next);
      if (!result.success) {
        setMode(previous);
        if (showSaveStatus) {
          cancelSavedStatusTimer();
          setSaveIsError(true);
          setSaveStatus(
            wrappedError(
              result.error ??
                messageLabel("settings.general.outputMode.saveFailed"),
            ),
          );
        }
        return;
      }

      setMode(result.mode ?? next);
      if (showSaveStatus) {
        cancelSavedStatusTimer();
        setSaveIsError(false);
        setSaveStatus(plainStatus("settings.general.outputMode.saved"));
        savedStatusTimerRef.current = setTimeout(() => {
          savedStatusTimerRef.current = null;
          setSaveStatus(null);
        }, 2000);
      }
    } catch (error: unknown) {
      console.error("OutputModeTabs: Error saving output mode:", error);
      setMode(previous);
      if (showSaveStatus) {
        cancelSavedStatusTimer();
        setSaveIsError(true);
        setSaveStatus(
          wrappedError(messageLabel("settings.general.outputMode.saveError")),
        );
      }
    } finally {
      if (showSaveStatus) {
        setSaving(false);
      }
    }
  };

  return (
    <div>
      <SegmentedControl
        value={mode}
        onChange={(next) => {
          void persistMode(next);
        }}
        ariaLabel={t("settings.general.correctionOutput.title")}
        size={size}
        equalWidth
        className={className}
        options={[
          {
            value: "paste",
            label: t("settings.general.correctionOutput.paste.label"),
            disabled: saving,
          },
          {
            value: "popup",
            label: t("settings.general.correctionOutput.popup.label"),
            disabled: saving,
          },
        ]}
      />
      {showSaveStatus && saveStatus ? (
        <p
          className={`mt-1 text-xs ${saveIsError ? "text-destructive" : "text-success"}`}
          role="status"
        >
          {resolveStatus(saveStatus, t, tm, tl)}
        </p>
      ) : null}
    </div>
  );
};

export default OutputModeTabs;
