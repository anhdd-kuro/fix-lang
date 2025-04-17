import React, { useState, useEffect } from "react";
import { DEFAULT_OPENAI_MODEL } from "~/const";

/**
 * General settings tab for API key and model selection.
 */
export const SettingGeneral: React.FC = () => {
  // State for the API Key input field
  const [apiKeyInput, setApiKeyInput] = useState<string>("");
  const [saveStatus, setSaveStatus] = useState<string>("");

  // --- Model selection state ---
  const [models, setModels] = useState<
    { id: string; object: string; created: number; owned_by: string }[]
  >([]);
  const [selectedModel, setSelectedModel] =
    useState<string>(DEFAULT_OPENAI_MODEL);

  const [modelsLoading, setModelsLoading] = useState<boolean>(false);
  const [modelsError, setModelsError] = useState<string>("");

  // Fetch models from OpenAI API
  const fetchModels = async (refetch = false) => {
    setModelsLoading(true);
    setModelsError("");
    try {
      if (!window.electronAPI?.fetchOpenAIModels) {
        setModelsError("electronAPI.fetchOpenAIModels not available");
        setModelsLoading(false);
        return;
      }
      const result = await window.electronAPI.fetchOpenAIModels(refetch);
      if (result.success) {
        setModels(result.models ?? []);
      } else {
        setModelsError(result.error || "Failed to fetch models");
      }
    } catch (error) {
      setModelsError(error instanceof Error ? error.message : "Unknown error");
    } finally {
      setModelsLoading(false);
    }
  };

  // Initialize component
  useEffect(() => {
    fetchModels();
    window.electronAPI?.getSelectedModel?.().then((model) => {
      if (model) {
        setSelectedModel(model);
      }
    });

    // Fetch API Key
    window.electronAPI
      ?.getApiKey()
      .then((key) => {
        console.log(
          `SettingGeneral: Received key (length: ${key?.length ?? 0})`
        );
        setApiKeyInput(key || ""); // Set input value, default to empty string
      })
      .catch((error) => {
        console.error("SettingGeneral: Error fetching API key:", error);
        setSaveStatus("Error fetching key");
      });
  }, []);

  // Handle changes to the input field
  const handleApiKeyChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setApiKeyInput(event.target.value);
    setSaveStatus(""); // Clear status on change
  };

  // Handle saving the API Key when the input loses focus
  const handleApiKeyBlur = async () => {
    if (!window.electronAPI?.setApiKey) {
      console.error("setApiKey function not available on electronAPI");
      setSaveStatus("Error: Cannot save key");
      return;
    }

    // Basic validation
    if (
      apiKeyInput &&
      !apiKeyInput.startsWith("sk-") &&
      apiKeyInput.length > 0
    ) {
      console.warn("API key doesn't start with 'sk-', might not be valid");
      // We'll still try to save it, but warn the user
      setSaveStatus("Warning: Key format may be invalid, but saving anyway...");
    } else {
      setSaveStatus("Saving...");
    }

    console.log(
      `SettingGeneral: Attempting to save API key (length: ${apiKeyInput.length})`
    );

    try {
      // Add a small delay to ensure UI updates before the potentially blocking IPC call
      await new Promise((resolve) => setTimeout(resolve, 100));

      const result = await window.electronAPI.setApiKey(apiKeyInput);
      await fetchModels(true);

      if (result.success) {
        console.log("SettingGeneral: API Key saved successfully.");
        setSaveStatus("Saved!");

        // Verify the key was saved by retrieving it again
        const verifiedKey = await window.electronAPI.getApiKey();
        if (verifiedKey !== apiKeyInput) {
          console.error("SettingGeneral: API Key verification failed");
          setSaveStatus("Warning: Key saved but verification failed");
        }
      } else {
        console.error("SettingGeneral: Failed to save API Key:", result.error);
        setSaveStatus(`Error: ${result.error || "Unknown error"}`);
      }
    } catch (error) {
      console.error("SettingGeneral: Error calling setApiKey:", error);
      setSaveStatus("Error saving key");
    }
  };

  // Handle model selection change
  const handleModelChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const modelId = e.target.value;
    setSelectedModel(modelId);
    if (window.electronAPI?.setSelectedModel) {
      try {
        await window.electronAPI.setSelectedModel(modelId);
      } catch (error) {
        console.error(
          "Failed to persist selected model to main process:",
          error
        );
      }
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="mb-4">
        <label
          htmlFor="api-key-input"
          className="block text-sm font-medium text-gray-300 mb-1"
        >
          OpenAI API Key
        </label>
        <input
          id="api-key-input"
          type="password"
          className="w-full p-2 bg-gray-700 border border-gray-600 rounded text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
          value={apiKeyInput}
          onChange={handleApiKeyChange}
          onBlur={handleApiKeyBlur}
          placeholder="Enter your OpenAI API key"
          aria-label="OpenAI API Key"
        />
        {saveStatus && (
          <p
            className={`text-xs mt-1 ${saveStatus.startsWith("Error") ? "text-red-400" : saveStatus.startsWith("Warning") ? "text-yellow-400" : "text-green-400"}`}
            role="status"
          >
            {saveStatus}
          </p>
        )}
        <p className="text-xs text-gray-500 mt-1">
          Your API key is stored locally and never sent to our servers.
        </p>
      </div>
      <div className="mb-4">
        <label
          htmlFor="model-select"
          className="block text-sm font-medium text-gray-300 mb-1"
        >
          OpenAI Model
        </label>
        <div className="flex gap-2 items-center">
          <select
            id="model-select"
            className="w-full p-2 bg-gray-700 border border-gray-600 rounded text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
            aria-label="Select OpenAI Model"
            value={models.length > 0 ? selectedModel : ""}
            onChange={handleModelChange}
            disabled={modelsLoading || !!modelsError}
          >
            {modelsLoading && <option>Loading models...</option>}
            {!modelsLoading && models.length === 0 && (
              <option>No models found</option>
            )}
            {!modelsLoading &&
              models.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.id}{" "}
                  {model.owned_by !== "openai" ? `(${model.owned_by})` : ""}
                </option>
              ))}
          </select>
          <button
            type="button"
            aria-label="Refetch models"
            title="Refetch models"
            className="px-2 py-1 bg-blue-500 text-white rounded hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-400"
            onClick={() => fetchModels(true)}
            disabled={modelsLoading}
          >
            &#x21bb;
          </button>
        </div>
        {modelsError && (
          <p className="text-xs text-red-400 mt-1" role="alert">
            {modelsError}
          </p>
        )}
        <p className="text-xs text-gray-500 mt-1">
          Model is used for all OpenAI requests. Your API key determines
          available models.
        </p>
      </div>
    </div>
  );
};
