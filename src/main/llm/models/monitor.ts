/**
 * @file monitor.ts
 * @description Background process to monitor and detect local LLM models
 */
import { app, BrowserWindow } from "electron";
import { fetchAvailableModels } from "~/main/ai.request/shared";
import { apiStore, getCurrentProfileSettings } from "~/stores/apiStore";
import { getLocalModels } from "./discover";
import type { Model } from "~/stores/apiStore";

// Configuration
const CONFIG = {
  // Time between model checks (in milliseconds)
  CHECK_INTERVAL: 5 * 60 * 1000, // 5 minutes
  // Initial delay before first check (in milliseconds)
  INITIAL_DELAY: 10 * 1000, // 10 seconds after app starts
  // Maximum consecutive failures before reducing check frequency
  MAX_FAILURES: 3,
  // Extended interval after repeated failures (in milliseconds)
  EXTENDED_INTERVAL: 15 * 60 * 1000, // 15 minutes
};

// State tracking
let modelCheckInterval: NodeJS.Timeout | null = null;
let isRunning = false;
let consecutiveFailures = 0;
// Using _prefix to indicate intentionally unused variable that might be used in future
let _lastSuccessfulCheck: number | null = null;

/**
 * Start the background model monitoring process
 */
export function startModelMonitoring(): void {
  if (isRunning) {
    console.log("Model monitoring is already running");
    return;
  }

  console.log("Starting local LLM model monitoring");

  // Delay the initial check to let the app finish startup
  setTimeout(() => {
    // Initial model check
    void checkForModelChanges();

    // Set up periodic checks
    modelCheckInterval = setInterval(
      () => void checkForModelChanges(),
      CONFIG.CHECK_INTERVAL
    );
  }, CONFIG.INITIAL_DELAY);

  // Ensure we clean up when the app quits
  app.on("will-quit", stopModelMonitoring);

  isRunning = true;
}

/**
 * Stop the background model monitoring process
 */
export function stopModelMonitoring(): void {
  if (!isRunning) {
    return;
  }

  console.log("Stopping local LLM model monitoring");

  if (modelCheckInterval) {
    clearInterval(modelCheckInterval);
    modelCheckInterval = null;
  }

  isRunning = false;
  consecutiveFailures = 0;
}

/**
 * Get the main window to send notifications
 */
function getMainWindow(): BrowserWindow | null {
  const windows = BrowserWindow.getAllWindows();
  return windows.length > 0 ? windows[0] : null;
}

/**
 * Check for changes in available local models
 */
async function checkForModelChanges(): Promise<void> {
  try {
    console.log("Checking for local model changes...");

    // Get current models from store
    const storedModels = (apiStore.get("models") as Model[]) || [];
    const storedLocalModels = storedModels.filter((model) => model.local);

    // Get latest models from Ollama
    const currentLocalModels = await getLocalModels();

    // Check if models have changed
    const { hasChanges, added, removed } = detectModelChanges(
      storedLocalModels,
      currentLocalModels
    );

    // Handle changes if any detected
    if (hasChanges) {
      console.log(
        `Local model changes detected: ${added.length} added, ${removed.length} removed`
      );

      // Re-fetch all models (both cloud and local)
      const apiKey = getCurrentProfileSettings().apiKey;
      const allModels = await fetchAvailableModels(apiKey);

      // Update the store with the latest models
      apiStore.set("models", allModels);

      // Send notification to the renderer process if main window exists
      const mainWindow = getMainWindow();
      if (mainWindow?.webContents) {
        mainWindow.webContents.send("models-updated", {
          added: added.length,
          removed: removed.length,
        });
      }

      // Display notification if there are obvious changes
      if (added.length > 0 || removed.length > 0) {
        // This would be a good place to show a system notification
        // if we want to notify the user of model changes
      }
    }

    // Reset failure counter on success
    consecutiveFailures = 0;
    _lastSuccessfulCheck = Date.now();
  } catch (error) {
    consecutiveFailures += 1;
    console.error(
      `Error checking for model changes (failure ${consecutiveFailures}/${CONFIG.MAX_FAILURES}):`,
      error
    );

    // If we've had too many failures, adjust the check interval
    if (
      consecutiveFailures >= CONFIG.MAX_FAILURES &&
      modelCheckInterval !== null
    ) {
      console.log(
        "Too many consecutive failures, reducing model check frequency"
      );
      clearInterval(modelCheckInterval);
      modelCheckInterval = setInterval(
        () => void checkForModelChanges(),
        CONFIG.EXTENDED_INTERVAL
      );
    }
  }
}

/**
 * Detect if there are changes between stored and current models
 * @returns Object containing change status and details
 */
function detectModelChanges(
  storedModels: Model[],
  currentModels: Model[]
): { hasChanges: boolean; added: Model[]; removed: Model[] } {
  // Create maps for faster lookups
  const storedModelMap = new Map(
    storedModels.map((model) => [model.id, model])
  );
  const currentModelMap = new Map(
    currentModels.map((model) => [model.id, model])
  );

  // Find models that were added (exist in current but not in stored)
  const added: Model[] = currentModels.filter(
    (model) => !storedModelMap.has(model.id)
  );

  // Find models that were removed (exist in stored but not in current)
  const removed: Model[] = storedModels.filter(
    (model) => !currentModelMap.has(model.id)
  );

  // Also check for path changes in models that exist in both sets
  const changed: Model[] = currentModels.filter((model) => {
    const storedModel = storedModelMap.get(model.id);
    return storedModel && storedModel.local?.path !== model.local?.path;
  });

  const hasChanges =
    added.length > 0 || removed.length > 0 || changed.length > 0;

  return { hasChanges, added, removed };
}
