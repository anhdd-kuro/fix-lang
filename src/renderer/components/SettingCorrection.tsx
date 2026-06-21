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
import type { CorrectionPreset, CorrectionSettings } from "~/stores/apiStore";

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
  model: DEFAULT_OPENAI_MODEL,
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
 * Returns the first error message, or null if all fields are valid.
 * Hotkey conflict validation is handled separately by validateHotkeys().
 */
const validateFormFields = (
  settings: CorrectionSettings,
): string | null => {
  for (const preset of settings.presets) {
    if (!preset.name.trim()) {
      return "Every preset needs a name.";
    }

    if (!preset.systemPrompt.trim()) {
      return `Preset "${preset.name}" needs a system prompt.`;
    }
  }

  return null;
};

export const SettingCorrection: React.FC = () => {
  const [correctionSettings, setCorrectionSettings] =
    useState<CorrectionSettings>(buildDefaultSettings);
  const [status, setStatus] = useState("");
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
  };

  const handleSave = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    // Form validation: name + systemPrompt fields must be non-empty.
    const formError = validateFormFields(correctionSettings);
    if (formError) {
      setStatus(`Error: ${formError}`);
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
      setStatus(
        `Error: Hotkey "${conflict.hotkey}" used by both "${conflict.presetOrKey}" and "${conflict.conflictsWith}".`,
      );
      return;
    }

    setStatus("Saving...");

    const result =
      await window.electronAPI.setCorrectSettings(correctionSettings);

    if (result.success) {
      setStatus("Saved! Correction presets updated.");
      setTimeout(() => setStatus(""), 2000);
      return;
    }

    setStatus("Error saving correction presets.");
  };

  if (isLoading) {
    return (
      <div className="p-8 text-center text-gray-300">Loading presets...</div>
    );
  }

  if (!activePreset) {
    return (
      <div className="p-8 text-center text-gray-300">No presets found.</div>
    );
  }

  return (
    <form onSubmit={handleSave} className="flex flex-col gap-6">
      <div className="rounded-lg border border-gray-700 bg-gray-800/60 p-4 text-sm text-gray-300">
        Correction preset hotkeys are edited here. The prompt generator and
        profile switch shortcuts are in the PromptGen and Profiles tabs.
      </div>

      <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="rounded-lg border border-gray-700 bg-gray-800/70 p-3">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-gray-100">Presets</h3>
              <p className="text-xs text-gray-400">
                Select a preset to edit its prompt and hotkey.
              </p>
            </div>
            <button
              type="button"
              onClick={handleAddPreset}
              className="h-9 rounded-md bg-blue-600 px-3 text-xs font-semibold text-white transition-colors hover:bg-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 motion-reduce:transition-none"
            >
              Add preset
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
                    className={`w-full rounded-lg border px-3 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 motion-reduce:transition-none ${
                      isSelected
                        ? "border-blue-500 bg-blue-500/10"
                        : "border-gray-700 bg-gray-900/40 hover:border-gray-600 hover:bg-gray-800"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-gray-100">
                          {preset.name}
                        </p>
                        <p className="mt-1 truncate text-xs text-gray-400">
                          {preset.hotkey || "No hotkey assigned"}
                        </p>
                      </div>
                      <span className="rounded-full bg-gray-700 px-2 py-1 text-[11px] text-gray-200">
                        {preset.isBuiltIn ? "Built-in" : "Custom"}
                      </span>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </aside>

        <section className="rounded-lg border border-gray-700 bg-gray-800/70 p-4">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-semibold text-gray-100">
                {activePreset.name}
              </h3>
              <p className="text-sm text-gray-400">
                Configure the prompt, model, and shortcut for this preset.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleDuplicatePreset}
                className="h-9 rounded-md border border-gray-600 px-3 text-xs font-semibold text-gray-200 transition-colors hover:border-gray-500 hover:bg-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 motion-reduce:transition-none"
              >
                Duplicate
              </button>
              <button
                type="button"
                onClick={handleResetBuiltIn}
                disabled={!activePreset.isBuiltIn}
                className="h-9 rounded-md border border-gray-600 px-3 text-xs font-semibold text-gray-200 transition-colors hover:border-gray-500 hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 motion-reduce:transition-none"
              >
                Reset built-in
              </button>
              <button
                type="button"
                onClick={handleDeletePreset}
                disabled={activePreset.isBuiltIn}
                className="h-9 rounded-md border border-red-500/50 px-3 text-xs font-semibold text-red-200 transition-colors hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 motion-reduce:transition-none"
              >
                Delete
              </button>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="flex flex-col gap-2">
              <label htmlFor="preset-name" className="text-sm text-gray-300">
                Preset name
              </label>
              <input
                id="preset-name"
                type="text"
                value={activePreset.name}
                onChange={(event) =>
                  updatePreset(activePreset.id, { name: event.target.value })
                }
                className="h-10 rounded-md border border-gray-600 bg-gray-700 px-3 text-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
              />
            </div>

            <div className="flex flex-col gap-2">
              <label htmlFor="preset-hotkey" className="text-sm text-gray-300">
                Hotkey
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
                placeholder="Press shortcut"
                readOnly
                className="h-10 rounded-md border border-gray-600 bg-gray-700 px-3 text-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
              />
              <button
                type="button"
                onClick={() => updatePreset(activePreset.id, { hotkey: "" })}
                className="self-start rounded-md border border-gray-600 px-3 py-2 text-xs font-semibold text-gray-200 transition-colors hover:border-gray-500 hover:bg-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 motion-reduce:transition-none"
              >
                Clear hotkey
              </button>
              <p className="text-xs text-gray-400">
                Press a shortcut here, or clear it to disable the preset hotkey.
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
              <label htmlFor="preset-temperature" className="text-sm text-gray-300">
                Temperature
              </label>
              <input
                id="preset-temperature"
                type="number"
                min={0}
                max={2}
                step={0.05}
                placeholder="Default (1)"
                value={activePreset.temperature ?? ""}
                onChange={(event) => {
                  const raw = event.target.value;
                  const parsed = parseFloat(raw);
                  updatePreset(activePreset.id, {
                    temperature: raw === "" || isNaN(parsed) ? undefined : parsed,
                  });
                }}
                className="h-10 rounded-md border border-gray-600 bg-gray-700 px-3 text-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
              />
              <p className="text-xs text-gray-400">
                Leave blank to use the default (1). Range: 0–2.
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <label htmlFor="preset-max-tokens" className="text-sm text-gray-300">
                Max Tokens
              </label>
              <input
                id="preset-max-tokens"
                type="number"
                min={100}
                max={32000}
                step={500}
                placeholder="Default (10000)"
                value={activePreset.maxTokens ?? ""}
                onChange={(event) => {
                  const raw = event.target.value;
                  const parsed = parseInt(raw, 10);
                  updatePreset(activePreset.id, {
                    maxTokens: raw === "" || isNaN(parsed) ? undefined : parsed,
                  });
                }}
                className="h-10 rounded-md border border-gray-600 bg-gray-700 px-3 text-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
              />
              <p className="text-xs text-gray-400">
                Leave blank to use the default (10000). Range: 100–32000.
              </p>
            </div>
          </div>

          <div className="mt-4 flex flex-col gap-2">
            <label htmlFor="system-prompt" className="text-sm text-gray-300">
              System prompt
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
              className="min-h-72 rounded-md border border-gray-600 bg-gray-700 p-3 text-sm text-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
            />
          </div>
        </section>
      </div>

      <div className="flex items-center justify-end gap-3">
        <button
          type="submit"
          className="h-10 rounded-md bg-blue-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 motion-reduce:transition-none"
        >
          Save presets
        </button>
      </div>

      {status && (
        <p
          className={`text-sm ${
            status.startsWith("Error") ? "text-red-400" : "text-green-400"
          }`}
          role="status"
        >
          {status}
        </p>
      )}
    </form>
  );
};
