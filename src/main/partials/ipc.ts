/**
 * @file ipc.ts
 * @description IPC handlers for settings and key bindings.
 */
import {
  ipcMain,
  app,
  Notification,
  BrowserWindow,
  screen,
  clipboard,
} from "electron";
import { DEFAULT_OPENAI_MODEL } from "~/const";
import { keybindingStore } from "~/stores/keybindingStore";
import { registerHotkeys, unregisterHotkeys } from "./hotkey";
import { getMainWindow } from "./mainWindow";
import { showTranslationWindow } from "./translationWindow";
import { store } from "../../stores/apiStore";
import { fetchOpenAIModels, translateText, summarizeText } from "../ai.request";
import type { KeyBindings, VersionEntry } from "../../stores/apiStore";

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
      return keybindingStore.getKeyBindings();
    } catch (error) {
      console.error("Failed to get key bindings:", error);
      // Fallback to default keybindings on error
      return keybindingStore.getKeyBindings();
    }
  });

  ipcMain.handle("set-key-bindings", async (_event, bindings: KeyBindings) => {
    try {
      if (!bindings || typeof bindings !== "object")
        throw new Error("Invalid key bindings");
      keybindingStore.setKeyBindings(bindings);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  });

  ipcMain.handle("reset-key-bindings", async () => {
    keybindingStore.resetKeyBindings();
    return keybindingStore.getKeyBindings();
  });

  ipcMain.handle("pause-hotkeys", async () => {
    unregisterHotkeys();
  });

  ipcMain.handle("resume-hotkeys", async () => {
    const win = getMainWindow();
    if (win) registerHotkeys(win);
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

  ipcMain.handle("get-last-history", async () => {
    try {
      const history = store.get("history") as VersionEntry[];
      const sortedHistoryByTimestampDesc = history.sort(
        (a, b) =>
          new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      );
      const latest = sortedHistoryByTimestampDesc.at(0);
      return {
        original: latest?.original ?? "",
        corrected: latest?.corrected ?? "",
      };
    } catch (error) {
      console.error("Failed to get last history:", error);
      return { original: "", corrected: "" };
    }
  });

  ipcMain.handle("get-history", async () => {
    try {
      const history = store.get("history") as VersionEntry[];
      const sortedHistoryByTimestampDesc = history.sort(
        (a, b) =>
          new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      );
      return sortedHistoryByTimestampDesc;
    } catch (error) {
      console.error("Failed to get history:", error);
      return [];
    }
  });

  ipcMain.handle("get-translation-history", async () => {
    return store.get("translations");
  });

  ipcMain.handle("clear-history", async () => {
    try {
      store.set("history", []);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  });

  ipcMain.handle("clear-translation-history", async () => {
    store.set("translations", []);
    return { success: true };
  });

  ipcMain.handle("copy-to-clipboard", async (_event, text: string) => {
    clipboard.writeText(text);
    return { success: true };
  });

  // Add quit-app IPC listener
  ipcMain.on("quit-app", () => {
    app.quit();
  });

  // --- Prompt Settings IPC Handlers ---
  ipcMain.handle("get-prompt-settings", async () => {
    try {
      return {
        customSystemPrompt: store.get("customSystemPrompt"),
        customUserPrompt: store.get("customUserPrompt"),
        withGrammar: store.get("withGrammar"),
        withShorten: store.get("withShorten"),
        tone: store.get("tone"),
        temperature: store.get("temperature"),
      };
    } catch (error) {
      console.error("Failed to get prompt settings:", error);
      return {
        customSystemPrompt: "",
        customUserPrompt: "",
        withGrammar: true,
        withShorten: false,
        tone: "",
        temperature: store.get("temperature") as number,
      };
    }
  });

  ipcMain.handle("set-prompt-settings", async (_event, settings) => {
    try {
      const {
        customSystemPrompt,
        customUserPrompt,
        withGrammar,
        withShorten,
        tone,
        temperature,
      } = settings;
      store.set("customSystemPrompt", customSystemPrompt);
      store.set("customUserPrompt", customUserPrompt);
      store.set("withGrammar", withGrammar);
      store.set("withShorten", withShorten);
      store.set("tone", tone);
      store.set("temperature", temperature);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  });

  // --- Translation Target IPC Handlers ---
  ipcMain.handle("get-translation-target-lang", async () => {
    try {
      return (store.get("translationTargetLang") as string) || "";
    } catch (error) {
      console.error("Failed to get translation target language:", error);
      return "";
    }
  });

  ipcMain.handle(
    "set-translation-target-lang",
    async (_event, lang: string) => {
      try {
        if (typeof lang !== "string") throw new Error("Invalid language");
        store.set("translationTargetLang", lang);
        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    }
  );

  // --- Translation IPC Handler ---
  ipcMain.handle(
    "translate-text",
    async (_event, text: string, targetLang: string) => {
      try {
        // Capture cursor position; window will display on completion
        const { x, y } = screen.getCursorScreenPoint();
        getMainWindow()?.webContents.send("start-loading");
        const apiKey = store.get("apiKey") as string;
        const result = await translateText(apiKey, text, targetLang);
        // Get cursor for popup and update popup
        showTranslationWindow({
          ...result,
          originalText: text,
          targetLang,
          loading: false,
          x,
          y,
        });
        // Store translation in history
        const transEntry: VersionEntry = {
          original: text,
          corrected: result.translatedText,
          timestamp: new Date().toISOString(),
        };
        const existing = store.get("translations") as VersionEntry[];
        store.set("translations", [...existing, transEntry]);
        // Send update to main window preview
        getMainWindow()?.webContents.send("update-text", {
          original: text,
          corrected: result.translatedText,
          promptTokens: result.promptTokens,
          completionTokens: result.completionTokens,
        });
        getMainWindow()?.webContents.send("stop-loading");
        return { success: true };
      } catch (error) {
        console.error("Translation failed:", error);
        getMainWindow()?.webContents.send("stop-loading");
        const { x, y } = screen.getCursorScreenPoint();
        // Show error state in popup
        showTranslationWindow({
          translatedText: "",
          error: error instanceof Error ? error.message : "Unknown error",
          originalText: text,
          targetLang,
          loading: false,
          promptTokens: null,
          completionTokens: null,
          x,
          y,
        });
        return {
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    }
  );

  ipcMain.handle(
    "translate",
    async (_event, text: string, targetLang: string) => {
      try {
        const apiKey = store.get("apiKey");
        if (!apiKey) throw new Error("API key not set");
        await translateText(apiKey, text, targetLang);
        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
  );

  ipcMain.handle(
    "summarize",
    async (_event, text: string, maxInput: number) => {
      try {
        const apiKey = store.get("apiKey");
        if (!apiKey) throw new Error("API key not set");
        const result = await summarizeText(apiKey, text, maxInput);
        return {
          success: true,
          summarizedText: result.summarizedText,
          promptTokens: result.promptTokens,
          completionTokens: result.completionTokens,
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
  );

  // Listen for settings-updated events and notify user
  ipcMain.on("settings-updated", () => {
    console.log("Settings updated");
    new Notification({
      title: "Settings Updated",
      body: "Your settings have been saved.",
    }).show();
    // Notify all renderer windows to refresh settings
    BrowserWindow.getAllWindows().forEach((win) => {
      if (!win.isDestroyed()) win.webContents.send("settings-updated");
    });
  });
};
