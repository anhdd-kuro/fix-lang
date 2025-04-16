/**
 * @file ipc.ts
 * @description IPC handlers for settings and key bindings.
 */
import { ipcMain } from "electron";
import { store } from "./store";
import { KeyBindings } from "./store";
import { updateTrayMenu } from "./tray";
import { fetchOpenAIModels } from "./openai";

export const registerIpcHandlers = () => {
  ipcMain.handle("fetch-openai-models", async () => {
    try {
      const apiKey = store.get("apiKey");
      if (!apiKey) throw new Error("API key not set");
      const models = await fetchOpenAIModels(apiKey);
      const latestSortedModels = models.sort((a, b) => b.created - a.created);
      store.set("models", { models: latestSortedModels });

      return { success: true, models: latestSortedModels };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  });
  ipcMain.handle("get-api-key", async () => {
    try {
      const apiKey = store.get("apiKey");
      return apiKey || "";
    } catch (error) {
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
      return {
        fix: "Control+Shift+F",
        undo: "Control+Shift+Z",
        retry: "Control+Shift+A",
      };
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

  ipcMain.handle("get-selected-model", async () => {
    try {
      return store.get("selectedModel") || "gpt-4o-mini";
    } catch (error) {
      return "gpt-4o-mini";
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
