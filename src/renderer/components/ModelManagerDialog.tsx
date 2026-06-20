/**
 * @file ModelManagerDialog.tsx
 * @description Modal dialog for managing local LLM models
 */
import { useCallback, useEffect, useState } from "react";
import { Button } from "./Button";
import { Dialog } from "./Dialog";
import { ListRow } from "./ListRow";
import { Tab } from "./Tab";
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

  const modelTabs = [
    { id: "installed", label: "Installed Models" },
    { id: "recommended", label: "Recommended Models" },
  ];

  return (
    <>
      <Dialog
        isOpen={isOpen}
        onClose={onClose}
        title={
          <span className="flex items-center gap-3">
            Manage Local LLM Models
            <button
              type="button"
              onClick={refreshModels}
              disabled={isRefreshing}
              className={`text-label-secondary hover:text-label-primary transition-colors text-lg ${
                isRefreshing ? "animate-spin" : ""
              }`}
              title="Refresh models"
            >
              ↻
            </button>
          </span>
        }
        widthClassName="max-w-4xl w-full"
        maxHeightClassName="max-h-[90vh]"
      >
        {/* Tab navigation */}
        <div className="mb-4">
          <Tab
            tabs={modelTabs}
            activeId={activeTab}
            onSelect={(id) =>
              setActiveTab(id as "installed" | "recommended")
            }
          />
        </div>

        {/* Content */}
        {isLoading ? (
          <div className="flex justify-center items-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-accent" />
          </div>
        ) : activeTab === "installed" ? (
          <div>
            {localModels.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-8 text-label-secondary">
                <p>No local models installed</p>
                <Button
                  variant="default"
                  onClick={() => setActiveTab("recommended")}
                >
                  Browse recommended models
                </Button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {localModels.map((model) => (
                  <ListRow
                    key={model.id}
                    className="rounded-[6px] border border-separator/40"
                    trailing={
                      <Button
                        variant="destructive"
                        onClick={() =>
                          setDeleteConfirmation({
                            isOpen: true,
                            modelName: model.local?.path,
                          })
                        }
                        aria-label={`Delete ${model.name}`}
                      >
                        Delete
                      </Button>
                    }
                  >
                    <div className="flex flex-col gap-0.5">
                      <span className="font-medium text-label-primary">
                        {model.name}
                      </span>
                      <span className="text-[0.769rem] text-label-secondary truncate">
                        {model.local?.path}
                      </span>
                      {model.local?.size && (
                        <span className="text-[0.769rem] text-label-secondary">
                          {formatSize(model.local.size)}
                        </span>
                      )}
                    </div>
                  </ListRow>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div>
            {recommendedModels.length === 0 ? (
              <div className="flex flex-col items-center py-8 text-label-secondary">
                <p>No recommended models available</p>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {recommendedModels.map((model) => (
                  <ListRow
                    key={model.name}
                    className="rounded-[6px] border border-separator/40 flex-col items-start py-3"
                    trailing={
                      <Button
                        variant={
                          model.status === "error" ? "destructive" : "prominent"
                        }
                        onClick={() => installModel(model.name)}
                        disabled={model.status === "installing"}
                        className={
                          model.status === "installing"
                            ? "animate-pulse cursor-wait"
                            : model.status === "success"
                              ? "opacity-60 pointer-events-none"
                              : ""
                        }
                      >
                        {model.status === "success"
                          ? "Installed"
                          : model.status === "installing"
                            ? "Installing…"
                            : model.status === "error"
                              ? "Retry"
                              : "Install"}
                      </Button>
                    }
                  >
                    <div className="flex flex-col gap-1 w-full">
                      <span className="font-medium text-label-primary">
                        {model.name}
                      </span>
                      <p className="text-[0.846rem] text-label-secondary">
                        {model.description}
                      </p>
                      <div className="flex flex-wrap gap-1.5 mt-1">
                        {model.tags.map((tag) => (
                          <span
                            key={tag}
                            className="px-1.5 py-0.5 bg-separator/30 rounded-full text-[0.692rem] text-label-secondary"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                      <span className="text-[0.769rem] text-label-secondary">
                        {formatSize(model.size)}
                      </span>
                      {model.status === "error" && model.error && (
                        <span className="text-[0.769rem] text-[color:var(--color-danger-hover)]">
                          Error: {model.error}
                        </span>
                      )}
                    </div>
                  </ListRow>
                ))}
              </div>
            )}
          </div>
        )}
      </Dialog>

      {/* Delete Confirmation — nested Dialog */}
      <Dialog
        isOpen={deleteConfirmation.isOpen}
        onClose={() => setDeleteConfirmation({ isOpen: false })}
        title="Confirm Deletion"
        widthClassName="max-w-md w-full"
        footer={
          <>
            <Button
              variant="default"
              onClick={() => setDeleteConfirmation({ isOpen: false })}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() =>
                deleteModel(deleteConfirmation.modelName ?? "")
              }
            >
              Delete
            </Button>
          </>
        }
      >
        <p className="text-[0.846rem] text-label-primary">
          Are you sure you want to delete model{" "}
          <span className="font-semibold">
            {deleteConfirmation.modelName}
          </span>
          ? This action cannot be undone.
        </p>
      </Dialog>
    </>
  );
}
