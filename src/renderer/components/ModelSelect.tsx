import React, { useState, useEffect } from "react";
import { DEFAULT_OPENAI_MODEL } from "~/const";

/**
 * Shared component for OpenAI model selection with refresh.
 */
export const ModelSelect: React.FC = () => {
  const [models, setModels] = useState<
    {
      id: string;
      object: string;
      created: number;
      owned_by: string;
    }[]
  >([]);
  const [selectedModel, setSelectedModel] =
    useState<string>(DEFAULT_OPENAI_MODEL);
  const [modelsLoading, setModelsLoading] = useState<boolean>(false);
  const [modelsError, setModelsError] = useState<string>("");

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
    } catch (err) {
      setModelsError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setModelsLoading(false);
    }
  };

  const handleModelChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const modelId = e.target.value;
    setSelectedModel(modelId);
    if (window.electronAPI?.setSelectedModel) {
      try {
        await window.electronAPI.setSelectedModel(modelId);
      } catch (err) {
        console.error("ModelSelect: Failed to persist selected model", err);
      }
    }
  };

  useEffect(() => {
    fetchModels();
    window.electronAPI?.getSelectedModel?.().then((m) => {
      if (m) setSelectedModel(m);
    });
  }, []);

  return (
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
        Model is used for all OpenAI requests. Your API key determines available
        models.
      </p>
    </div>
  );
};
