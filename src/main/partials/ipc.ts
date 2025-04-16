/**
 * @file ipc.ts
 * @description IPC handlers for settings and key bindings.
 */
import { ipcMain } from "electron";
import { DEFAULT_OPENAI_MODEL } from "~/const";
import { fetchOpenAIModels } from "./openai";
import { store } from "./store";
import { updateTrayMenu } from "./tray";
import type { KeyBindings } from "./store";

export const registerIpcHandlers = () => {
  ipcMain.handle("get-api-key", async () => {
    try {
      const apiKey = store.get("apiKey");
      return apiKey || "";
    } catch (error) {
      console.error("Failed to get API key:", error);
      return "";
    }
  });

  ipcMain.handle("set-api-key", async (_event, apiKey: string) => {
    try {
      if (typeof apiKey !== "string") throw new Error("Invalid API key");
      store.set("apiKey", apiKey);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  });

  ipcMain.handle("get-key-bindings", async () => {
    try {
      const bindings = store.get("keyBindings");
      return bindings;
    } catch (error) {
      console.error("Failed to get key bindings:", error);
      return {
        fix: "Control+Shift+F",
        undo: "Control+Shift+Z",
        retry: "Control+Shift+A",
      };
    }
  });

  ipcMain.handle("fetch-openai-models", async (_event, refetch = false) => {
    try {
      const apiKey = store.get("apiKey");
      if (!apiKey) throw new Error("API key not set");

      const fetchedModels = store.get("models");
      if (
        Array.isArray(fetchedModels) &&
        fetchedModels.length > 0 &&
        !refetch
      ) {
        return { success: true, models: fetchedModels };
      }

      const models = await fetchOpenAIModels(apiKey);
      console.log(`🚀 \n - ipcMain.handle \n - models:`, models);
      // Defensive: Only set if models is an array
      if (Array.isArray(models)) {
        const latestSortedModels = models.sort((a, b) => b.created - a.created);
        store.set("models", latestSortedModels);
        return { success: true, models: latestSortedModels };
      }
    } catch (error) {
      if (error instanceof Error) {
        return {
          success: false,
          error: error.message,
        };
      }

      return {
        success: false,
        error: "Unknown error",
      };
    }
  });

  ipcMain.handle("get-selected-model", async () => {
    try {
      return store.get("selectedModel");
    } catch (error) {
      console.error("Failed to get selected model:", error);
      return DEFAULT_OPENAI_MODEL;
    }
  });

  ipcMain.handle("set-selected-model", async (_event, modelId: string) => {
    try {
      if (typeof modelId !== "string" || !modelId)
        throw new Error("Invalid model id");
      store.set("selectedModel", modelId);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  });

  ipcMain.handle("set-key-bindings", async (_event, bindings: KeyBindings) => {
    try {
      if (!bindings || typeof bindings !== "object")
        throw new Error("Invalid key bindings");
      store.set("keyBindings", bindings);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  });

  ipcMain.on("settings-updated", () => {
    updateTrayMenu();
  });
};
