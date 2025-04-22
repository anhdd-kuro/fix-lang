import React, { useState, useEffect } from "react";
import Tooltip from "./Tooltip";
import {
  DEFAULT_PROMPT_GEN_PROMPT,
  DEFAULT_PROMPT_GEN_IMAGE_PROMPT,
} from "../../prompts";

export const SettingPromptGen: React.FC = () => {
  const [isLoading, setIsLoading] = useState(true);
  const [minLength, setMinLength] = useState<number | null>(null);
  const [maxLength, setMaxLength] = useState<number | null>(null);
  const [batchCount, setBatchCount] = useState<number | null>(null);
  const [nsfw, setNsfw] = useState<boolean | null>(null);
  const [context, setContext] = useState<string>("");
  const [autoCopy, setAutoCopy] = useState<boolean>(false);

  // Get initial values from store and listen for updates
  useEffect(() => {
    const loadSettings = async () => {
      try {
        setIsLoading(true);
        const settings = await window.electronAPI.getPromptgenSettings();
        setMinLength(settings.minLength);
        setMaxLength(settings.maxLength);
        setBatchCount(settings.batchCount);
        setNsfw(settings.nsfw);
        setContext(settings.context || "");
        setAutoCopy(settings.autoCopy || false);
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
      // Default values from schema
      const defaultSettings = {
        minLength: 50,
        maxLength: 150,
        batchCount: 5,
        nsfw: true,
        context: "",
        autoCopy: false,
      };

      // Update local state
      setMinLength(defaultSettings.minLength);
      setMaxLength(defaultSettings.maxLength);
      setBatchCount(defaultSettings.batchCount);
      setNsfw(defaultSettings.nsfw);
      setContext(defaultSettings.context);
      setAutoCopy(defaultSettings.autoCopy);

      // Save to store
      const result =
        await window.electronAPI.setPromptgenSettings(defaultSettings);

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
      minLength === null ||
      maxLength === null ||
      batchCount === null ||
      nsfw === null
    ) {
      setStatus("Error: Settings not loaded");
      return;
    }

    try {
      const result = await window.electronAPI.setPromptgenSettings({
        minLength,
        maxLength,
        batchCount,
        nsfw,
        context,
        autoCopy,
      });
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
      <div className="flex justify-center items-center p-8 text-gray-300">
        Loading settings...
      </div>
    );
  }

  // Ensure we have loaded values before rendering form
  if (
    minLength === null ||
    maxLength === null ||
    nsfw === null ||
    batchCount === null
  ) {
    return (
      <div className="flex justify-center items-center p-8 text-gray-300">
        Failed to load settings
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col">
      <fieldset className="flex flex-col gap-4">
        <div className="grid grid-cols-3 gap-6">
          <div className="flex flex-col gap-2">
            <label
              htmlFor="promptgen-min"
              className="block text-gray-300 text-sm"
            >
              Min Length
            </label>
            <input
              id="promptgen-min"
              type="number"
              name="minLength"
              required
              aria-label="PromptGen minimum length"
              value={minLength}
              onChange={(e) => setMinLength(Number(e.target.value))}
              className="w-full p-1 bg-gray-700 border border-gray-600 rounded text-gray-100"
              placeholder="Min"
            />
          </div>
          <div className="flex flex-col gap-2">
            <label
              htmlFor="promptgen-max"
              className="block text-gray-300 text-sm"
            >
              Max Length
            </label>
            <input
              id="promptgen-max"
              type="number"
              name="maxLength"
              required
              aria-label="PromptGen maximum length"
              value={maxLength}
              onChange={(e) => setMaxLength(Number(e.target.value))}
              className="w-full p-1 bg-gray-700 border border-gray-600 rounded text-gray-100"
              placeholder="Max"
            />
          </div>
          <div className="flex flex-col gap-2">
            <label
              htmlFor="promptgen-batch"
              className="block text-gray-300 text-sm cursor-help"
              aria-label="Number of prompts to generate"
              title="Number of prompts to generate"
            >
              Batch Count
            </label>
            <input
              id="promptgen-batch"
              type="number"
              name="batchCount"
              required
              value={batchCount}
              onChange={(e) => setBatchCount(Number(e.target.value))}
              className="w-20 p-1 bg-gray-700 border border-gray-600 rounded text-gray-100"
              placeholder="Count"
              min="1"
            />
          </div>
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-4 mt-4">
        <div className="flex flex-col gap-2">
          <label
            htmlFor="promptgen-context"
            className="block text-gray-300 text-sm"
          >
            Custom Context
            <span className="text-xs text-gray-400 ml-2">
              (Override default system prompt with your own)
            </span>
          </label>
          <div className="flex flex-col gap-2 mb-2">
            {/* Text prompt template row */}
            <div className="flex items-center gap-2 text-xs text-gray-400">
              <span>Default Text Prompt Template</span>
              <Tooltip tooltipText={DEFAULT_PROMPT_GEN_PROMPT} />
              <button
                type="button"
                className="text-blue-400 hover:text-blue-300"
                onClick={() => setContext(DEFAULT_PROMPT_GEN_PROMPT.trim())}
                title="Use default text prompt template"
              >
                Use as Template
              </button>
            </div>

            {/* Image prompt template row */}
            <div className="flex items-center gap-2 text-xs text-gray-400">
              <span>Image Prompt Template</span>
              <Tooltip tooltipText={DEFAULT_PROMPT_GEN_IMAGE_PROMPT} />
              <button
                type="button"
                className="text-blue-400 hover:text-blue-300"
                onClick={() =>
                  setContext(DEFAULT_PROMPT_GEN_IMAGE_PROMPT.trim())
                }
                title="Use image prompt template"
              >
                Use as Template
              </button>
            </div>
          </div>
          <textarea
            id="promptgen-context"
            name="context"
            aria-label="Custom context for prompt generation"
            value={context}
            onChange={(e) => setContext(e.target.value)}
            className="w-full p-2 bg-gray-700 border border-gray-600 rounded text-gray-100 min-h-20 text-sm"
            placeholder="Leave empty to use default, or enter your own system prompt"
            rows={4}
          />
        </div>

        <div className="flex flex-col gap-2 mt-4">
          <label className="inline-flex items-center text-gray-300">
            <input
              type="checkbox"
              name="nsfw"
              checked={nsfw}
              onChange={() => setNsfw(!nsfw)}
              className="form-checkbox h-4 w-4 text-blue-500"
            />
            <span className="ml-2">Allow NSFW</span>
          </label>

          <label className="inline-flex items-center text-gray-300">
            <input
              type="checkbox"
              name="autoCopy"
              checked={autoCopy}
              onChange={() => setAutoCopy(!autoCopy)}
              className="form-checkbox h-4 w-4 text-blue-500"
            />
            <span className="ml-2">Auto-copy to clipboard</span>
            <span className="ml-2 text-xs text-gray-400">
              (Copies all prompts automatically when generated)
            </span>
          </label>
        </div>
      </fieldset>

      <div className="flex flex-col gap-2 mt-8">
        <button
          type="submit"
          className="px-3 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
        >
          {status || "Save"}
        </button>
        <button
          type="button"
          onClick={handleReset}
          className="px-3 py-2 bg-gray-600 text-white rounded hover:bg-gray-700"
        >
          Reset to Default
        </button>
      </div>
    </form>
  );
};
