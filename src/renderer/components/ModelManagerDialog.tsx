/**
 * @file ModelManagerDialog.tsx
 * @description Modal dialog for managing local LLM models
 */
import { useCallback, useEffect, useState } from "react";
import type { Model } from "~/stores/apiStore";

// Define the model installation status for UI feedback
type ModelInstallStatus = "idle" | "installing" | "success" | "error";

// Type for recommended models
type RecommendedModel = {
  name: string;
  description: string;
  size: number; // Size in bytes
  tags: string[];
  status?: ModelInstallStatus;
  error?: string;
};

type ModelManagerProps = {
  isOpen: boolean;
  onClose: () => void;
};

export default function ModelManagerDialog({
  isOpen,
  onClose,
}: ModelManagerProps) {
  // State for installed local models
  const [localModels, setLocalModels] = useState<Model[]>([]);
  // State for recommended models
  const [recommendedModels, setRecommendedModels] = useState<
    RecommendedModel[]
  >([]);
  // State for the active tab
  const [activeTab, setActiveTab] = useState<"installed" | "recommended">(
    "installed"
  );
  // Deletion confirmation state
  const [deleteConfirmation, setDeleteConfirmation] = useState<{
    isOpen: boolean;
    modelName?: string;
  }>({ isOpen: false });
  // Loading states
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Format file size to a human-readable string
  const formatSize = (size: number): string => {
    if (size >= 1_000_000_000) {
      return `${(size / 1_000_000_000).toFixed(1)} GB`;
    } else if (size >= 1_000_000) {
      return `${(size / 1_000_000).toFixed(1)} MB`;
    } else if (size >= 1_000) {
      return `${(size / 1_000).toFixed(1)} KB`;
    }
    return `${size} B`;
  };

  // Load models
  const loadModels = useCallback(async () => {
    try {
      setIsLoading(true);
      // Get installed models from the store
      const result = await window.electronAPI.fetchAIModels();

      // Handle different response formats
      if (result.success && result.models) {
        // New format with success property
        setLocalModels(result.models.filter((model: Model) => model.local));
      } else if (Array.isArray(result)) {
        // Old format returns array directly
        setLocalModels(result.filter((model: Model) => model.local));
      } else {
        console.error("Unexpected result format from fetchAIModels", result);
        setLocalModels([]);
      }

      // Get recommended models
      const recommended = await window.electronAPI.getRecommendedModels();
      setRecommendedModels(recommended);
    } catch (error) {
      console.error("Failed to load models:", error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Refresh models list
  const refreshModels = async () => {
    setIsRefreshing(true);
    await loadModels();
    setIsRefreshing(false);
  };

  // Handle installing a model
  const installModel = async (modelName: string) => {
    try {
      // Update the status of the model being installed
      setRecommendedModels((prev) =>
        prev.map((model) =>
          model.name === modelName
            ? { ...model, status: "installing" as ModelInstallStatus }
            : model
        )
      );

      // Install the model
      const result = await window.electronAPI.pullLocalModel(modelName);

      // Update status based on result
      setRecommendedModels((prev) =>
        prev.map((model) =>
          model.name === modelName
            ? {
                ...model,
                status: result.success ? "success" : "error",
                error: result.error,
              }
            : model
        )
      );

      // Refresh models list if successful
      if (result.success) {
        // Give it a moment to complete registration
        setTimeout(() => {
          refreshModels();
        }, 1000);
      }
    } catch (error) {
      console.error(`Failed to install model ${modelName}:`, error);
      setRecommendedModels((prev) =>
        prev.map((model) =>
          model.name === modelName
            ? {
                ...model,
                status: "error",
                error: error instanceof Error ? error.message : String(error),
              }
            : model
        )
      );
    }
  };

  // Handle deleting a model
  const deleteModel = async (modelName: string) => {
    try {
      const result = await window.electronAPI.deleteLocalModel(modelName);
      if (result.success) {
        // Close the confirmation dialog
        setDeleteConfirmation({ isOpen: false });
        // Refresh the model list
        refreshModels();
      } else {
        alert(`Failed to delete model: ${result.error}`);
      }
    } catch (error) {
      console.error(`Failed to delete model ${modelName}:`, error);
      alert(`Error: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  // Load models when the dialog opens
  useEffect(() => {
    if (isOpen) {
      loadModels();
    }
  }, [isOpen, loadModels]);

  // Early return if dialog is not open
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50">
      <div className="bg-gray-800 rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex justify-between items-center p-4 border-b border-gray-700">
          <h2 className="text-xl font-semibold text-white">
            Manage Local LLM Models
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-700">
          <button
            className={`px-4 py-2 ${
              activeTab === "installed"
                ? "border-b-2 border-blue-500 text-blue-400"
                : "text-gray-400 hover:text-white"
            }`}
            onClick={() => setActiveTab("installed")}
          >
            Installed Models
          </button>
          <button
            className={`px-4 py-2 ${
              activeTab === "recommended"
                ? "border-b-2 border-blue-500 text-blue-400"
                : "text-gray-400 hover:text-white"
            }`}
            onClick={() => setActiveTab("recommended")}
          >
            Recommended Models
          </button>
          <div className="ml-auto px-4 py-2">
            <button
              onClick={refreshModels}
              disabled={isRefreshing}
              className={`text-gray-300 hover:text-white ${
                isRefreshing ? "animate-spin" : ""
              }`}
              title="Refresh models"
            >
              ↻
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-4">
          {isLoading ? (
            <div className="flex justify-center items-center h-full">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
            </div>
          ) : activeTab === "installed" ? (
            /* Installed Models Tab */
            <div>
              {localModels.length === 0 ? (
                <div className="text-center text-gray-400 py-8">
                  <p>No local models installed</p>
                  <button
                    onClick={() => setActiveTab("recommended")}
                    className="mt-2 text-blue-400 hover:underline"
                  >
                    Browse recommended models
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {localModels.map((model) => (
                    <div
                      key={model.id}
                      className="border border-gray-700 rounded-lg p-4 bg-gray-800 hover:bg-gray-750"
                    >
                      <div className="flex justify-between">
                        <h3 className="text-lg font-medium text-white">
                          {model.name}
                        </h3>
                        <div className="flex space-x-2">
                          <button
                            onClick={() =>
                              setDeleteConfirmation({
                                isOpen: true,
                                modelName: model.local?.path,
                              })
                            }
                            className="text-red-400 hover:text-red-300"
                            title="Delete model"
                          >
                            🗑️
                          </button>
                        </div>
                      </div>
                      <div className="mt-2 text-sm text-gray-400">
                        <div>
                          Path:{" "}
                          <span className="text-gray-300">
                            {model.local?.path}
                          </span>
                        </div>
                        {model.local?.size && (
                          <div>
                            Size:{" "}
                            <span className="text-gray-300">
                              {formatSize(model.local.size)}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            /* Recommended Models Tab */
            <div>
              {recommendedModels.length === 0 ? (
                <div className="text-center text-gray-400 py-8">
                  <p>No recommended models available</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-4">
                  {recommendedModels.map((model) => (
                    <div
                      key={model.name}
                      className="border border-gray-700 rounded-lg p-4 bg-gray-800 hover:bg-gray-750"
                    >
                      <div className="flex justify-between">
                        <h3 className="text-lg font-medium text-white">
                          {model.name}
                        </h3>
                        <div>
                          <button
                            onClick={() => installModel(model.name)}
                            disabled={model.status === "installing"}
                            className={`px-3 py-1 rounded text-sm ${
                              model.status === "success"
                                ? "bg-green-600 text-white cursor-default"
                                : model.status === "installing"
                                  ? "bg-blue-600 text-white animate-pulse cursor-wait"
                                  : model.status === "error"
                                    ? "bg-red-600 text-white hover:bg-red-700"
                                    : "bg-blue-500 text-white hover:bg-blue-600"
                            }`}
                          >
                            {model.status === "success"
                              ? "Installed"
                              : model.status === "installing"
                                ? "Installing..."
                                : model.status === "error"
                                  ? "Retry"
                                  : "Install"}
                          </button>
                        </div>
                      </div>
                      <p className="mt-2 text-gray-300">{model.description}</p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {model.tags.map((tag) => (
                          <span
                            key={tag}
                            className="px-2 py-1 bg-gray-700 rounded-full text-xs text-gray-300"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                      <div className="mt-2 text-sm text-gray-400">
                        <span>Size: {formatSize(model.size)}</span>
                      </div>
                      {model.status === "error" && model.error && (
                        <div className="mt-2 text-sm text-red-400">
                          Error: {model.error}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Delete Confirmation Dialog */}
        {deleteConfirmation.isOpen && (
          <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50">
            <div className="bg-gray-800 rounded-lg shadow-xl p-6 max-w-md w-full">
              <h3 className="text-xl font-semibold text-white mb-4">
                Confirm Deletion
              </h3>
              <p className="text-gray-300 mb-6">
                Are you sure you want to delete model{" "}
                <span className="font-semibold">
                  {deleteConfirmation.modelName}
                </span>
                ? This action cannot be undone.
              </p>
              <div className="flex justify-end space-x-3">
                <button
                  onClick={() => setDeleteConfirmation({ isOpen: false })}
                  className="px-4 py-2 bg-gray-700 text-white rounded hover:bg-gray-600"
                >
                  Cancel
                </button>
                <button
                  onClick={() =>
                    deleteModel(deleteConfirmation.modelName || "")
                  }
                  className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
