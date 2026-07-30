/**
 * @file ModelManagerDialog.tsx
 * @description Modal dialog for managing local LLM models
 */
import { useCallback, useEffect, useState } from "react";
import { Button } from "./Button";
import { useI18n } from "../i18n/useI18n";
import type { Model } from "~/features/providers/store/apiStore";

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
  const { t } = useI18n();
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
        alert(
          t("models.manager.deleteFailedAlert", {
            message: result.error ?? "",
          }),
        );
      }
    } catch (error) {
      console.error(`Failed to delete model ${modelName}:`, error);
      alert(
        t("models.manager.errorAlert", {
          message: error instanceof Error ? error.message : String(error),
        }),
      );
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
        <div className="flex justify-between items-center p-4 border-b border-card-control-border">
          <h2 className="text-xl font-semibold text-foreground">
            {t("models.manager.title")}
          </h2>
          <Button
            onClick={onClose}
            variant="ghost"
            className="text-muted-foreground hover:text-foreground"
            aria-label={t("common.close")}
          >
            ✕
          </Button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-card-control-border">
          <Button
            variant={activeTab === "installed" ? "primary" : "ghost"}
            className={`px-4 py-2 ${
              activeTab === "installed"
                ? "border-b-2 border-primary"
                : "text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => setActiveTab("installed")}
          >
            {t("models.manager.tabs.installed")}
          </Button>
          <Button
            variant={activeTab === "recommended" ? "primary" : "ghost"}
            className={`px-4 py-2 ${
              activeTab === "recommended"
                ? "border-b-2 border-primary"
                : "text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => setActiveTab("recommended")}
          >
            {t("models.manager.tabs.recommended")}
          </Button>
          <div className="ml-auto px-4 py-2">
            <Button
              onClick={refreshModels}
              variant="ghost"
              disabled={isRefreshing}
              className={`text-card-foreground hover:text-foreground ${
                isRefreshing ? "animate-spin" : ""
              }`}
              title={t("models.manager.refresh")}
            >
              ↻
            </Button>
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
                  <p>{t("models.manager.installed.empty")}</p>
                  <Button
                    onClick={() => setActiveTab("recommended")}
                    variant="ghost"
                    className="mt-2 text-primary hover:underline"
                  >
                    {t("models.manager.installed.browseRecommended")}
                  </Button>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {localModels.map((model) => (
                    <div
                      key={model.id}
                      className="border border-card-control-border rounded-lg p-4 bg-card hover:bg-accent"
                    >
                      <div className="flex justify-between">
                        <h3 className="text-lg font-medium text-foreground">
                          {model.name}
                        </h3>
                        <div className="flex space-x-2">
                          <Button
                            onClick={() =>
                              setDeleteConfirmation({
                                isOpen: true,
                                modelName: model.local?.path,
                              })
                            }
                            variant="destructive"
                            title={t("models.manager.deleteTitle")}
                          >
                            🗑️
                          </Button>
                        </div>
                      </div>
                      <div className="mt-2 text-sm text-muted-foreground">
                        <div>
                          {t("models.manager.pathLabel")}{" "}
                          <span className="text-card-foreground">
                            {model.local?.path}
                          </span>
                        </div>
                        {model.local?.size && (
                          <div>
                            {t("models.manager.sizeLabel")}{" "}
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
                  <p>{t("models.manager.recommended.empty")}</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-4">
                  {recommendedModels.map((model) => (
                    <div
                      key={model.name}
                      className="border border-card-control-border rounded-lg p-4 bg-card hover:bg-accent"
                    >
                      <div className="flex justify-between">
                        <h3 className="text-lg font-medium text-foreground">
                          {model.name}
                        </h3>
                        <div>
                          <Button
                            onClick={() => installModel(model.name)}
                            variant={
                              model.status === "error"
                                ? "destructive"
                                : "primary"
                            }
                            disabled={model.status === "installing"}
                            className={`px-3 py-1 rounded text-sm ${
                              model.status === "success"
                                ? "bg-success text-success-foreground cursor-default [&:where(:enabled:hover)]:bg-success [&:where(:enabled:active)]:bg-success"
                                : model.status === "installing"
                                  ? "bg-primary text-primary-foreground animate-pulse cursor-wait"
                                  : model.status === "error"
                                    ? "bg-destructive text-destructive-foreground"
                                    : "bg-primary text-primary-foreground hover:bg-primary"
                            }`}
                          >
                            {model.status === "success"
                              ? t("models.manager.install.installed")
                              : model.status === "installing"
                                ? t("models.manager.install.installing")
                                : model.status === "error"
                                  ? t("common.retry")
                                  : t("models.manager.install.install")}
                          </Button>
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
                        <span>
                          {t("models.manager.sizeLabel")}{" "}
                          {formatSize(model.size)}
                        </span>
                      </div>
                      {model.status === "error" && model.error && (
                        <div className="mt-2 text-sm text-destructive">
                          {t("models.manager.recommendedError", {
                            message: model.error,
                          })}
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
                {t("models.manager.confirmDelete.title")}
              </h3>
              <p className="text-card-foreground mb-6">
                {t("models.manager.confirmDelete.message", {
                  modelName: deleteConfirmation.modelName ?? "",
                })}
              </p>
              <div className="flex justify-end space-x-3">
                <Button
                  onClick={() => setDeleteConfirmation({ isOpen: false })}
                  variant="secondary"
                  className="px-4 py-2 rounded"
                >
                  {t("common.cancel")}
                </Button>
                <Button
                  onClick={() =>
                    deleteModel(deleteConfirmation.modelName || "")
                  }
                  variant="destructive"
                  className="px-4 py-2 rounded"
                >
                  {t("common.delete")}
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
