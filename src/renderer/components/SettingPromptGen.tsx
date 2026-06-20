import React, { useState, useEffect } from "react";
import { DEFAULT_OPENAI_MODEL } from "~/const";
import { ModelSelect } from "./ModelSelect";
import Tooltip from "./Tooltip";
import {
  DEFAULT_PROMPT_GEN_PROMPT,
  DEFAULT_PROMPT_GEN_IMAGE_PROMPT,
} from "../../prompts";

const defaultSettings = {
  minLength: 50,
  maxLength: 150,
  batchCount: 5,
  nsfw: true,
  context: "",
  model: DEFAULT_OPENAI_MODEL,
  autoCopy: false,
};

export const SettingPromptGen: React.FC = () => {
  const [isLoading, setIsLoading] = useState(true);
  const [promptGenSettings, setPromptGenSettings] = useState<{
    minLength: number;
    maxLength: number;
    batchCount: number;
    nsfw: boolean;
    context: string;
    model: string;
    autoCopy: boolean;
  }>(defaultSettings);

  // Get initial values from store and listen for updates
  useEffect(() => {
    const loadSettings = async () => {
      try {
        setIsLoading(true);
        const settings = await window.electronAPI.getPromptGenSettings();
        setPromptGenSettings(settings);
      } catch (err) {
        console.error("Failed to load PromptGen settings:", err);
      } finally {
        setIsLoading(false);
      }
    };

    // Load initial settings
    loadSettings();

    // Listen for settings updates
    const off = window.electronAPI.onSettingsUpdated?.(() => {
      loadSettings();
    });

    return () => off?.();
  }, []);

  // Get initial values from store and listen for updates
  useEffect(() => {
    const loadSettings = async () => {
      try {
        setIsLoading(true);
        const settings = await window.electronAPI.getPromptGenSettings();
        setPromptGenSettings(settings);
      } catch (err) {
        console.error("Failed to load PromptGen settings:", err);
      } finally {
        setIsLoading(false);
      }
    };

    // Load initial settings
    loadSettings();

    // Listen for settings updates
    const off = window.electronAPI.onSettingsUpdated?.(() => {
      loadSettings();
    });

    return () => off?.();
  }, []);

  const [status, setStatus] = useState<string>("");

  const handleReset = async () => {
    try {
      setPromptGenSettings(defaultSettings);

      // Save to store
      const result =
        await window.electronAPI.setPromptGenSettings(defaultSettings);

      if (result.success) {
        setStatus("Reset to defaults!");
        setTimeout(() => setStatus(""), 2000);
      } else {
        setStatus("Error resetting");
      }
    } catch (err) {
      console.error("Failed to reset PromptGen settings:", err);
      setStatus("Error resetting");
    }
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (
      promptGenSettings.minLength === null ||
      promptGenSettings.maxLength === null ||
      promptGenSettings.batchCount === null ||
      promptGenSettings.nsfw === null
    ) {
      setStatus("Error: Settings not loaded");
      return;
    }

    try {
      const result =
        await window.electronAPI.setPromptGenSettings(promptGenSettings);
      if (result.success) {
        setStatus("Saved!");
        setTimeout(() => setStatus(""), 2000);
      } else {
        setStatus("Error saving settings");
      }
    } catch (err) {
      console.error("Failed to save PromptGen settings:", err);
      setStatus("Error saving settings");
    }
  };

  if (isLoading) {
    return (
      <div className="flex justify-center items-center p-8 text-label-primary">
        Loading settings...
      </div>
    );
  }

  // Ensure we have loaded values before rendering form
  if (
    promptGenSettings.minLength === null ||
    promptGenSettings.maxLength === null ||
    promptGenSettings.nsfw === null ||
    promptGenSettings.batchCount === null
  ) {
    return (
      <div className="flex justify-center items-center p-8 text-label-primary">
        Failed to load settings
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col">
      {/* Model Selection */}
      <ModelSelect
        featureId="settingsPromptGen"
        useFeatureModel={true}
        onChange={(modelId) =>
          setPromptGenSettings({ ...promptGenSettings, model: modelId })
        }
      />

      <fieldset className="flex flex-col gap-4">
        <div className="grid grid-cols-3 gap-6">
          <div className="flex flex-col gap-2">
            <label
              htmlFor="promptGen-min"
              className="block text-label-primary text-sm"
            >
              Min Length
            </label>
            <input
              id="promptGen-min"
              type="number"
              name="minLength"
              required
              aria-label="PromptGen minimum length"
              value={promptGenSettings.minLength}
              onChange={(e) =>
                setPromptGenSettings({
                  ...promptGenSettings,
                  minLength: Number(e.target.value),
                })
              }
              className="w-full p-1 bg-control border border-separator/60 rounded text-label-primary"
              placeholder="Min"
            />
          </div>
          <div className="flex flex-col gap-2">
            <label
              htmlFor="promptGen-max"
              className="block text-label-primary text-sm"
            >
              Max Length
            </label>
            <input
              id="promptGen-max"
              type="number"
              name="maxLength"
              required
              aria-label="PromptGen maximum length"
              value={promptGenSettings.maxLength}
              onChange={(e) =>
                setPromptGenSettings({
                  ...promptGenSettings,
                  maxLength: Number(e.target.value),
                })
              }
              className="w-full p-1 bg-control border border-separator/60 rounded text-label-primary"
              placeholder="Max"
            />
          </div>
          <div className="flex flex-col gap-2">
            <label
              htmlFor="promptGen-batch"
              className="block text-label-primary text-sm cursor-help"
              aria-label="Number of prompts to generate"
              title="Number of prompts to generate"
            >
              Batch Count
            </label>
            <input
              id="promptGen-batch"
              type="number"
              name="batchCount"
              required
              value={promptGenSettings.batchCount}
              onChange={(e) =>
                setPromptGenSettings({
                  ...promptGenSettings,
                  batchCount: Number(e.target.value),
                })
              }
              className="w-20 p-1 bg-control border border-separator/60 rounded text-label-primary"
              placeholder="Count"
              min="1"
            />
          </div>
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-4 mt-4">
        <div className="flex flex-col gap-2">
          <label
            htmlFor="promptGen-context"
            className="block text-label-primary text-sm"
          >
            Custom Context
            <span className="text-xs text-label-secondary ml-2">
              (Override default system prompt with your own)
            </span>
          </label>
          <div className="flex flex-col gap-2 mb-2">
            {/* Text prompt template row */}
            <div className="flex items-center gap-2 text-xs text-label-secondary">
              <span>Default Text Prompt Template</span>
              <Tooltip tooltipText={DEFAULT_PROMPT_GEN_PROMPT} />
              <button
                type="button"
                className="text-accent hover:text-accent-hover"
                onClick={() =>
                  setPromptGenSettings({
                    ...promptGenSettings,
                    context: DEFAULT_PROMPT_GEN_PROMPT.trim(),
                  })
                }
                title="Use default text prompt template"
              >
                Use as Template
              </button>
            </div>

            {/* Image prompt template row */}
            <div className="flex items-center gap-2 text-xs text-label-secondary">
              <span>Image Prompt Template</span>
              <Tooltip tooltipText={DEFAULT_PROMPT_GEN_IMAGE_PROMPT} />
              <button
                type="button"
                className="text-accent hover:text-accent-hover"
                onClick={() =>
                  setPromptGenSettings({
                    ...promptGenSettings,
                    context: DEFAULT_PROMPT_GEN_IMAGE_PROMPT.trim(),
                  })
                }
                title="Use image prompt template"
              >
                Use as Template
              </button>
            </div>
          </div>
          <textarea
            id="promptGen-context"
            name="context"
            aria-label="Custom context for prompt generation"
            value={promptGenSettings.context}
            onChange={(e) =>
              setPromptGenSettings({
                ...promptGenSettings,
                context: e.target.value,
              })
            }
            className="w-full p-2 bg-control border border-separator/60 rounded text-label-primary min-h-20 text-sm"
            placeholder="Leave empty to use default, or enter your own system prompt"
            rows={4}
          />
        </div>

        <div className="flex flex-col gap-2 mt-4">
          <label className="inline-flex items-center text-label-primary">
            <input
              type="checkbox"
              name="nsfw"
              checked={promptGenSettings.nsfw}
              onChange={() =>
                setPromptGenSettings({
                  ...promptGenSettings,
                  nsfw: !promptGenSettings.nsfw,
                })
              }
              className="form-checkbox h-4 w-4 text-accent"
            />
            <span className="ml-2">Allow NSFW</span>
          </label>

          <label className="inline-flex items-center text-label-primary">
            <input
              type="checkbox"
              name="autoCopy"
              checked={promptGenSettings.autoCopy}
              onChange={() =>
                setPromptGenSettings({
                  ...promptGenSettings,
                  autoCopy: !promptGenSettings.autoCopy,
                })
              }
              className="form-checkbox h-4 w-4 text-accent"
            />
            <span className="ml-2">Auto-copy to clipboard</span>
            <span className="ml-2 text-xs text-label-secondary">
              (Copies all prompts automatically when generated)
            </span>
          </label>
        </div>
      </fieldset>

      <div className="flex flex-col gap-2 mt-8">
        <button
          type="submit"
          className="px-3 py-2 bg-accent text-label-primary rounded hover:bg-accent-hover"
        >
          {status || "Save"}
        </button>
        <button
          type="button"
          onClick={handleReset}
          className="px-3 py-2 bg-control text-label-primary rounded hover:bg-control"
        >
          Reset to Default
        </button>
      </div>
    </form>
  );
};
