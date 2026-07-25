import React, { useEffect, useMemo, useState } from "react";
import {
  DEFAULT_CORRECTION_PRESET_ID,
  DEFAULT_CUSTOM_PROMPT,
  DEFAULT_PROMPT_OPTIMIZATION_PRESET_ID,
  DEFAULT_PROMPT_OPTIMIZATION_PROMPT,
  DEFAULT_SUMMARIZE_PRESET_ID,
  DEFAULT_SUMMARIZE_PRESET_PROMPT,
  DEFAULT_TRANSLATE_PRESET_ID,
  DEFAULT_TRANSLATE_PRESET_PROMPT,
} from "~/prompts/correction";
import { ModelSelect } from "./ModelSelect";
import { validateHotkeys } from "./validateHotkeys";
import { useI18n } from "../i18n/useI18n";
import type { Translator } from "~/shared/i18n/translate";
import type { CorrectionPreset, CorrectionSettings } from "~/stores/apiStore";

// why: preset display names ("Correction", "Summarize", …) are user-editable
// data (renamed freely in the UI, just like a custom preset's name), not UI
// chrome — per the i18n plan, user-authored/user-owned data is interpolated,
// never translated. Only the surrounding labels/buttons/messages below go
// through `t()`.

const makeBuiltInPresetDefaults = (): Record<string, CorrectionPreset> => ({
  [DEFAULT_CORRECTION_PRESET_ID]: {
    id: DEFAULT_CORRECTION_PRESET_ID,
    name: "Correction",
    hotkey: "Control+Shift+F",
    systemPrompt: DEFAULT_CUSTOM_PROMPT.trim(),
    model: "", // empty = inherit the global default model
    isBuiltIn: true,
  },
  [DEFAULT_PROMPT_OPTIMIZATION_PRESET_ID]: {
    id: DEFAULT_PROMPT_OPTIMIZATION_PRESET_ID,
    name: "Prompt optimization",
    hotkey: "Control+Shift+D",
    systemPrompt: DEFAULT_PROMPT_OPTIMIZATION_PROMPT,
    model: "", // empty = inherit the global default model
    isBuiltIn: true,
  },
  [DEFAULT_SUMMARIZE_PRESET_ID]: {
    id: DEFAULT_SUMMARIZE_PRESET_ID,
    name: "Summarize",
    hotkey: "Control+Shift+S",
    systemPrompt: DEFAULT_SUMMARIZE_PRESET_PROMPT,
    model: "", // empty = inherit the global default model
    isBuiltIn: true,
  },
  [DEFAULT_TRANSLATE_PRESET_ID]: {
    id: DEFAULT_TRANSLATE_PRESET_ID,
    name: "Translate",
    hotkey: "Control+Shift+T",
    systemPrompt: DEFAULT_TRANSLATE_PRESET_PROMPT.trim(),
    model: "", // empty = inherit the global default model
    isBuiltIn: true,
  },
});

const buildDefaultSettings = (): CorrectionSettings => ({
  presets: Object.values(makeBuiltInPresetDefaults()),
  selectedPresetId: DEFAULT_CORRECTION_PRESET_ID,
});

const makeCustomPreset = (count: number): CorrectionPreset => ({
  id: `custom-${Date.now()}`,
  name: `Custom preset ${count}`,
  hotkey: "",
  systemPrompt: DEFAULT_CUSTOM_PROMPT.trim(),
  model: "", // empty = inherit the global default model
  isBuiltIn: false,
});

const captureHotkey = (
  event: React.KeyboardEvent<HTMLInputElement>,
): string => {
  event.preventDefault();

  const parts: string[] = [];

  if (event.ctrlKey) parts.push("Control");
  if (event.metaKey) parts.push("Command");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");

  const key = event.key.length === 1 ? event.key.toUpperCase() : event.key;

  if (!["Control", "Command", "Alt", "Shift"].includes(key)) {
    parts.push(key);
  }

  return parts.join("+");
};

/**
 * Validates form fields (name + systemPrompt) on each preset.
 * Returns the first (already-localized) error message, or null if all fields
 * are valid. Hotkey conflict validation is handled separately by
 * validateHotkeys().
 */
const validateFormFields = (
  settings: CorrectionSettings,
  t: Translator,
): string | null => {
  for (const preset of settings.presets) {
    if (!preset.name.trim()) {
      return t("settings.correction.error.nameRequired");
    }

    if (!preset.systemPrompt.trim()) {
      return t("settings.correction.error.promptRequired", { name: preset.name });
    }
  }

  return null;
};

export const SettingCorrection: React.FC = () => {
  const { t } = useI18n();
  const [correctionSettings, setCorrectionSettings] =
    useState<CorrectionSettings>(buildDefaultSettings);
  const [status, setStatus] = useState("");
  // Separate from `status` text so the styling never depends on matching an
  // English "Error" prefix — `status` itself is always already localized.
  const [statusIsError, setStatusIsError] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const builtInDefaults = useMemo(() => makeBuiltInPresetDefaults(), []);

  const activePreset =
    correctionSettings.presets.find(
      (preset) => preset.id === correctionSettings.selectedPresetId,
    ) || correctionSettings.presets[0];

  const loadSettings = async () => {
    try {
      setIsLoading(true);
      const [settings] = await Promise.all([
        window.electronAPI.getCorrectSettings(),
        window.electronAPI.getKeyBindings(),
      ]);
      setCorrectionSettings(settings);
    } catch (error) {
      console.error("Failed to load correction presets:", error);
      setCorrectionSettings(buildDefaultSettings());
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadSettings();
  }, []);

  useEffect(() => {
    const off = window.electronAPI.onSettingsUpdated?.(() => {
      loadSettings();
    });

    return () => off?.();
  }, []);

  const updatePreset = (
    presetId: string,
    updates: Partial<CorrectionPreset>,
  ) => {
    setCorrectionSettings((current) => ({
      ...current,
      presets: current.presets.map((preset) =>
        preset.id === presetId ? { ...preset, ...updates } : preset,
      ),
    }));
  };

  const handleAddPreset = () => {
    const nextPreset = makeCustomPreset(correctionSettings.presets.length + 1);

    setCorrectionSettings((current) => ({
      presets: [...current.presets, nextPreset],
      selectedPresetId: nextPreset.id,
    }));
    setStatus("");
    setStatusIsError(false);
  };

  const handleDuplicatePreset = () => {
    if (!activePreset) {
      return;
    }

    const duplicatedPreset: CorrectionPreset = {
      ...activePreset,
      id: `custom-${Date.now()}`,
      name: `${activePreset.name} Copy`,
      hotkey: "",
      isBuiltIn: false,
    };

    setCorrectionSettings((current) => ({
      presets: [...current.presets, duplicatedPreset],
      selectedPresetId: duplicatedPreset.id,
    }));
    setStatus("");
    setStatusIsError(false);
  };

  const handleDeletePreset = () => {
    if (!activePreset || activePreset.isBuiltIn) {
      return;
    }

    setCorrectionSettings((current) => {
      const presets = current.presets.filter(
        (preset) => preset.id !== activePreset.id,
      );
      const fallbackPreset =
        presets.find((preset) => preset.id === DEFAULT_CORRECTION_PRESET_ID) ||
        presets[0];

      return {
        presets,
        selectedPresetId: fallbackPreset?.id || DEFAULT_CORRECTION_PRESET_ID,
      };
    });
    setStatus("");
    setStatusIsError(false);
  };

  const handleResetBuiltIn = () => {
    if (!activePreset?.isBuiltIn) {
      return;
    }

    const defaultPreset = builtInDefaults[activePreset.id];
    if (!defaultPreset) {
      return;
    }

    // Built-in defaults omit temperature/maxTokens; spreading them alone would
    // retain any user override (merge keeps omitted keys). Explicitly clear the
    // optional AI params so Reset truly restores the built-in state.
    updatePreset(activePreset.id, {
      ...defaultPreset,
      temperature: defaultPreset.temperature,
      maxTokens: defaultPreset.maxTokens,
    });
    setStatus("");
    setStatusIsError(false);
  };

  const handleSave = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    // Form validation: name + systemPrompt fields must be non-empty.
    const formError = validateFormFields(correctionSettings, t);
    if (formError) {
      setStatusIsError(true);
      setStatus(t("settings.general.error", { message: formError }));
      return;
    }

    // Hotkey conflict validation: fetch latest app keybindings and check
    // all preset hotkeys against each other and against promptGen/profileSwitch.
    const latestKeyBindings = await window.electronAPI.getKeyBindings();
    const conflict = validateHotkeys(
      correctionSettings.presets,
      latestKeyBindings,
    );
    if (conflict) {
      setStatusIsError(true);
      setStatus(
        t("settings.general.error", {
          message: t("settings.correction.hotkeyConflict", {
            hotkey: conflict.hotkey,
            presetOrKey: conflict.presetOrKey,
            conflictsWith: conflict.conflictsWith,
          }),
        }),
      );
      return;
    }

    setStatusIsError(false);
    setStatus(t("settings.correction.saving"));

    const result =
      await window.electronAPI.setCorrectSettings(correctionSettings);

    if (result.success) {
      setStatusIsError(false);
      setStatus(t("settings.correction.saved"));
      setTimeout(() => setStatus(""), 2000);
      return;
    }

    setStatusIsError(true);
    setStatus(t("settings.correction.saveError"));
  };

  if (isLoading) {
    return (
      <div className="p-8 text-center text-card-foreground">
        {t("settings.correction.loading")}
      </div>
    );
  }

  if (!activePreset) {
    return (
      <div className="p-8 text-center text-card-foreground">
        {t("settings.correction.noPresets")}
      </div>
    );
  }

  return (
    <form onSubmit={handleSave} className="flex flex-col gap-6">
      <div className="rounded-lg border border-border bg-card/60 p-4 text-sm text-card-foreground">
        {t("settings.correction.hotkeyInfo")}
      </div>

      <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="rounded-lg border border-border bg-card/70 p-3">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-foreground">
                {t("settings.correction.presetsHeading")}
              </h3>
              <p className="text-xs text-muted-foreground">
                {t("settings.correction.presetsHint")}
              </p>
            </div>
            <button
              type="button"
              onClick={handleAddPreset}
              className="h-9 rounded-md bg-primary px-3 text-xs font-semibold text-foreground transition-colors hover:bg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
            >
              {t("settings.correction.addPreset")}
            </button>
          </div>

          <ul className="flex flex-col gap-2">
            {correctionSettings.presets.map((preset) => {
              const isSelected = preset.id === activePreset.id;

              return (
                <li key={preset.id}>
                  <button
                    type="button"
                    onClick={() =>
                      setCorrectionSettings((current) => ({
                        ...current,
                        selectedPresetId: preset.id,
                      }))
                    }
                    className={`w-full rounded-lg border px-3 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none ${
                      isSelected
                        ? "border-primary bg-primary/10"
                        : "border-border bg-background/40 hover:border-border hover:bg-card"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-foreground">
                          {preset.name}
                        </p>
                        <p className="mt-1 truncate text-xs text-muted-foreground">
                          {preset.hotkey || t("settings.correction.noHotkeyAssigned")}
                        </p>
                      </div>
                      <span className="rounded-full bg-secondary px-2 py-1 text-[11px] text-card-foreground">
                        {preset.isBuiltIn
                          ? t("settings.correction.badge.builtIn")
                          : t("settings.correction.badge.custom")}
                      </span>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </aside>

        <section className="rounded-lg border border-border bg-card/70 p-4">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-semibold text-foreground">
                {activePreset.name}
              </h3>
              <p className="text-sm text-muted-foreground">
                {t("settings.correction.configureHint")}
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleDuplicatePreset}
                className="h-9 rounded-md border border-border px-3 text-xs font-semibold text-card-foreground transition-colors hover:border-border hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
              >
                {t("settings.correction.duplicate")}
              </button>
              <button
                type="button"
                onClick={handleResetBuiltIn}
                disabled={!activePreset.isBuiltIn}
                className="h-9 rounded-md border border-border px-3 text-xs font-semibold text-card-foreground transition-colors hover:border-border hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
              >
                {t("settings.correction.resetBuiltIn")}
              </button>
              <button
                type="button"
                onClick={handleDeletePreset}
                disabled={activePreset.isBuiltIn}
                className="h-9 rounded-md border border-destructive/50 px-3 text-xs font-semibold text-destructive transition-colors hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive motion-reduce:transition-none"
              >
                {t("common.delete")}
              </button>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="flex flex-col gap-2">
              <label htmlFor="preset-name" className="text-sm text-card-foreground">
                {t("settings.correction.presetName")}
              </label>
              <input
                id="preset-name"
                type="text"
                value={activePreset.name}
                onChange={(event) =>
                  updatePreset(activePreset.id, { name: event.target.value })
                }
                className="h-10 rounded-md border border-border bg-secondary px-3 text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>

            <div className="flex flex-col gap-2">
              <label htmlFor="preset-hotkey" className="text-sm text-card-foreground">
                {t("settings.correction.hotkeyLabel")}
              </label>
              <input
                id="preset-hotkey"
                type="text"
                value={activePreset.hotkey}
                onKeyDown={(event) => {
                  if (event.key === "Backspace" || event.key === "Delete") {
                    event.preventDefault();
                    updatePreset(activePreset.id, { hotkey: "" });
                    return;
                  }

                  updatePreset(activePreset.id, {
                    hotkey: captureHotkey(event),
                  });
                }}
                placeholder={t("settings.hotkeys.pressShortcut")}
                readOnly
                className="h-10 rounded-md border border-border bg-secondary px-3 text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <button
                type="button"
                onClick={() => updatePreset(activePreset.id, { hotkey: "" })}
                className="self-start rounded-md border border-border px-3 py-2 text-xs font-semibold text-card-foreground transition-colors hover:border-border hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
              >
                {t("settings.correction.clearHotkey")}
              </button>
              <p className="text-xs text-muted-foreground">
                {t("settings.correction.hotkeyHint")}
              </p>
            </div>
          </div>

          <div className="mt-4">
            <ModelSelect
              persistSelection={false}
              selectedModelId={activePreset.model}
              onChange={(modelId) =>
                updatePreset(activePreset.id, { model: modelId })
              }
            />
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <label htmlFor="preset-temperature" className="text-sm text-card-foreground">
                {t("settings.correction.temperature")}
              </label>
              <input
                id="preset-temperature"
                type="number"
                min={0}
                max={2}
                step={0.05}
                placeholder={t("settings.correction.temperatureDefault")}
                value={activePreset.temperature ?? ""}
                onChange={(event) => {
                  const raw = event.target.value;
                  const parsed = parseFloat(raw);
                  updatePreset(activePreset.id, {
                    temperature: raw === "" || isNaN(parsed) ? undefined : parsed,
                  });
                }}
                className="h-10 rounded-md border border-border bg-secondary px-3 text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <p className="text-xs text-muted-foreground">
                {t("settings.correction.temperatureHint")}
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <label htmlFor="preset-max-tokens" className="text-sm text-card-foreground">
                {t("settings.correction.maxTokens")}
              </label>
              <input
                id="preset-max-tokens"
                type="number"
                min={100}
                max={32000}
                step={500}
                placeholder={t("settings.correction.maxTokensDefault")}
                value={activePreset.maxTokens ?? ""}
                onChange={(event) => {
                  const raw = event.target.value;
                  const parsed = parseInt(raw, 10);
                  updatePreset(activePreset.id, {
                    maxTokens: raw === "" || isNaN(parsed) ? undefined : parsed,
                  });
                }}
                className="h-10 rounded-md border border-border bg-secondary px-3 text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <p className="text-xs text-muted-foreground">
                {t("settings.correction.maxTokensHint")}
              </p>
            </div>
          </div>

          <div className="mt-4 flex flex-col gap-2">
            <label htmlFor="system-prompt" className="text-sm text-card-foreground">
              {t("settings.correction.systemPrompt")}
            </label>
            <textarea
              id="system-prompt"
              value={activePreset.systemPrompt}
              onChange={(event) =>
                updatePreset(activePreset.id, {
                  systemPrompt: event.target.value,
                })
              }
              rows={16}
              className="min-h-72 rounded-md border border-border bg-secondary p-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
        </section>
      </div>

      <div className="flex items-center justify-end gap-3">
        <button
          type="submit"
          className="h-10 rounded-md bg-primary px-4 text-sm font-semibold text-foreground transition-colors hover:bg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
        >
          {t("settings.correction.savePresets")}
        </button>
      </div>

      {status && (
        <p
          className={`text-sm ${statusIsError ? "text-destructive" : "text-success"}`}
          role="status"
        >
          {status}
        </p>
      )}
    </form>
  );
};
