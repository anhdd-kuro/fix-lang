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
    "installed",
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
            : model,
        ),
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
            : model,
        ),
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
            : model,
        ),
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
      <div className="bg-card rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex justify-between items-center p-4 border-b border-border">
          <h2 className="text-xl font-semibold text-foreground">
            Manage Local LLM Models
          </h2>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-border">
          <button
            className={`px-4 py-2 ${
              activeTab === "installed"
                ? "border-b-2 border-primary text-primary"
                : "text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => setActiveTab("installed")}
          >
            Installed Models
          </button>
          <button
            className={`px-4 py-2 ${
              activeTab === "recommended"
                ? "border-b-2 border-primary text-primary"
                : "text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => setActiveTab("recommended")}
          >
            Recommended Models
          </button>
          <div className="ml-auto px-4 py-2">
            <button
              onClick={refreshModels}
              disabled={isRefreshing}
              className={`text-card-foreground hover:text-foreground ${
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
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
          ) : activeTab === "installed" ? (
            /* Installed Models Tab */
            <div>
              {localModels.length === 0 ? (
                <div className="text-center text-muted-foreground py-8">
                  <p>No local models installed</p>
                  <button
                    onClick={() => setActiveTab("recommended")}
                    className="mt-2 text-primary hover:underline"
                  >
                    Browse recommended models
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {localModels.map((model) => (
                    <div
                      key={model.id}
                      className="border border-border rounded-lg p-4 bg-card hover:bg-accent"
                    >
                      <div className="flex justify-between">
                        <h3 className="text-lg font-medium text-foreground">
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
                            className="text-destructive hover:text-destructive"
                            title="Delete model"
                          >
                            🗑️
                          </button>
                        </div>
                      </div>
                      <div className="mt-2 text-sm text-muted-foreground">
                        <div>
                          Path:{" "}
                          <span className="text-card-foreground">
                            {model.local?.path}
                          </span>
                        </div>
                        {model.local?.size && (
                          <div>
                            Size:{" "}
                            <span className="text-card-foreground">
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
                <div className="text-center text-muted-foreground py-8">
                  <p>No recommended models available</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-4">
                  {recommendedModels.map((model) => (
                    <div
                      key={model.name}
                      className="border border-border rounded-lg p-4 bg-card hover:bg-accent"
                    >
                      <div className="flex justify-between">
                        <h3 className="text-lg font-medium text-foreground">
                          {model.name}
                        </h3>
                        <div>
                          <button
                            onClick={() => installModel(model.name)}
                            disabled={model.status === "installing"}
                            className={`px-3 py-1 rounded text-sm ${
                              model.status === "success"
                                ? "bg-success text-success-foreground cursor-default"
                                : model.status === "installing"
                                  ? "bg-primary text-primary-foreground animate-pulse cursor-wait"
                                  : model.status === "error"
                                    ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                    : "bg-primary text-primary-foreground hover:bg-primary"
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
                      <p className="mt-2 text-card-foreground">
                        {model.description}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {model.tags.map((tag) => (
                          <span
                            key={tag}
                            className="px-2 py-1 bg-secondary rounded-full text-xs text-card-foreground"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                      <div className="mt-2 text-sm text-muted-foreground">
                        <span>Size: {formatSize(model.size)}</span>
                      </div>
                      {model.status === "error" && model.error && (
                        <div className="mt-2 text-sm text-destructive">
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
            <div className="bg-card rounded-lg shadow-xl p-6 max-w-md w-full">
              <h3 className="text-xl font-semibold text-foreground mb-4">
                Confirm Deletion
              </h3>
              <p className="text-card-foreground mb-6">
                Are you sure you want to delete model{" "}
                <span className="font-semibold">
                  {deleteConfirmation.modelName}
                </span>
                ? This action cannot be undone.
              </p>
              <div className="flex justify-end space-x-3">
                <button
                  onClick={() => setDeleteConfirmation({ isOpen: false })}
                  className="px-4 py-2 bg-secondary text-secondary-foreground rounded hover:bg-secondary"
                >
                  Cancel
                </button>
                <button
                  onClick={() =>
                    deleteModel(deleteConfirmation.modelName || "")
                  }
                  className="px-4 py-2 bg-destructive text-destructive-foreground rounded hover:bg-destructive/90"
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
