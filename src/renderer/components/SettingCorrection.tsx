import React, { useEffect, useMemo, useState } from "react";
import { DEFAULT_OPENAI_MODEL } from "~/const";
import {
  DEFAULT_CORRECTION_PRESET_ID,
  DEFAULT_CUSTOM_PROMPT,
  DEFAULT_PROMPT_OPTIMIZATION_PRESET_ID,
  DEFAULT_PROMPT_OPTIMIZATION_PROMPT,
  DEFAULT_SUMMARIZE_PRESET_ID,
  DEFAULT_SUMMARIZE_PRESET_PROMPT,
} from "~/prompts/correction";
import { ModelSelect } from "./ModelSelect";
import type {
  CorrectionPreset,
  CorrectionSettings,
  KeyBindings,
} from "~/stores/apiStore";

const STATIC_APP_HOTKEYS: (keyof Pick<
  KeyBindings,
  "translate" | "promptGen" | "profileSwitch"
>)[] = ["translate", "promptGen", "profileSwitch"];

const makeBuiltInPresetDefaults = (): Record<string, CorrectionPreset> => ({
  [DEFAULT_CORRECTION_PRESET_ID]: {
    id: DEFAULT_CORRECTION_PRESET_ID,
    name: "Correction",
    hotkey: "Control+Shift+F",
    systemPrompt: DEFAULT_CUSTOM_PROMPT.trim(),
    model: DEFAULT_OPENAI_MODEL,
    isBuiltIn: true,
    applyGlobalPromptSettings: true,
  },
  [DEFAULT_PROMPT_OPTIMIZATION_PRESET_ID]: {
    id: DEFAULT_PROMPT_OPTIMIZATION_PRESET_ID,
    name: "Prompt optimization",
    hotkey: "Control+Shift+D",
    systemPrompt: DEFAULT_PROMPT_OPTIMIZATION_PROMPT,
    model: DEFAULT_OPENAI_MODEL,
    isBuiltIn: true,
    applyGlobalPromptSettings: false,
  },
  [DEFAULT_SUMMARIZE_PRESET_ID]: {
    id: DEFAULT_SUMMARIZE_PRESET_ID,
    name: "Summarize",
    hotkey: "Control+Shift+S",
    systemPrompt: DEFAULT_SUMMARIZE_PRESET_PROMPT,
    model: DEFAULT_OPENAI_MODEL,
    isBuiltIn: true,
    applyGlobalPromptSettings: false,
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
  applyGlobalPromptSettings: true,
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

const getValidationError = (
  settings: CorrectionSettings,
  keyBindings: KeyBindings | null,
): string | null => {
  const seenHotkeys = new Map<string, string>();
  const reservedHotkeys = new Map<string, string>();

  STATIC_APP_HOTKEYS.forEach((key) => {
    const shortcut = keyBindings?.[key]?.trim();
    if (shortcut) {
      reservedHotkeys.set(shortcut, key);
    }
  });

  for (const preset of settings.presets) {
    if (!preset.name.trim()) {
      return "Every preset needs a name.";
    }

    if (!preset.systemPrompt.trim()) {
      return `Preset "${preset.name}" needs a system prompt.`;
    }

    if (!preset.hotkey.trim()) {
      continue;
    }

    const reservedBinding = reservedHotkeys.get(preset.hotkey);
    if (reservedBinding) {
      return `Hotkey for "${preset.name}" conflicts with ${reservedBinding}.`;
    }

    const duplicate = seenHotkeys.get(preset.hotkey);
    if (duplicate) {
      return `Duplicate hotkey between "${duplicate}" and "${preset.name}".`;
    }

    seenHotkeys.set(preset.hotkey, preset.name);
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

    updatePreset(activePreset.id, defaultPreset);
    setStatus("");
  };

  const handleSave = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const latestKeyBindings = await window.electronAPI.getKeyBindings();

    const validationError = getValidationError(
      correctionSettings,
      latestKeyBindings,
    );
    if (validationError) {
      setStatus(`Error: ${validationError}`);
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
        Correction presets have their own hotkeys here. Translation, prompt
        generator, and profile switch shortcuts stay in the Key Bindings screen.
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
                      <span className="rounded-full bg-gray-700 px-2 py-1 text-[0.85rem] text-gray-200">
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

          <label className="mt-4 flex items-center gap-3 text-sm text-gray-300">
            <input
              type="checkbox"
              checked={activePreset.applyGlobalPromptSettings}
              onChange={() =>
                updatePreset(activePreset.id, {
                  applyGlobalPromptSettings:
                    !activePreset.applyGlobalPromptSettings,
                })
              }
              className="h-4 w-4 rounded border-gray-500 bg-gray-700 text-blue-500"
            />
            Apply global prompt overrides from the Global Prompts tab
          </label>

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
