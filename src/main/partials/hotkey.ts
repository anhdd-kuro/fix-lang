import {
  app,
  globalShortcut,
  Notification,
  screen,
  BrowserWindow,
} from "electron";
import { store } from "~/stores/apiStore";
import { keybindingStore } from "~/stores/keybindingStore";
import {
  fixGrammar,
  translateText,
  summarizeText,
  generatePrompt,
} from "../ai.request";
import { showOverlaySpinner, hideOverlaySpinner } from "./overlayWindow";
import { showPromptGenWindow } from "./promptGenWindow";
import { showSummaryWindow } from "./summaryWindow";
import { showTranslationWindow } from "./translationWindow";
import { getHighlightedText, pasteText } from "../../utils";
import type { VersionEntry, SettingsStore } from "~/stores/apiStore";

// State to store the last operation's text for Undo/Retry
let lastOriginalText: string | null = null;
let _lastFixedText: string | null = null;

/**
 * Registers global shortcuts for the application.
 * @param mainWindow The main browser window instance.
 */
export const registerHotkeys = (mainWindow: BrowserWindow): void => {
  console.log("Attempting to register hotkeys...");

  registerFixShortcut(mainWindow);
  registerTranslateShortcut(mainWindow);
  registerSummarizeShortcut(mainWindow);
  registerPromptGenShortcut(mainWindow);
  registerDevToolsShortcut();
};

const registerFixShortcut = (mainWindow: BrowserWindow) => {
  const fixShortcut = keybindingStore.getKeyBindings().correction;
  const retFix = globalShortcut.register(fixShortcut, async () => {
    console.log(`${fixShortcut} is pressed`);

    // Get API Key from store
    try {
      const apiKey = getOpenAIKey();
      const selectedText = await getHighlightedText();

      if (!selectedText || !selectedText.trim()) {
        console.log("No text selected or clipboard is empty.");
        new Notification({
          title: "Error",
          body: "No text selected or clipboard is empty.",
          urgency: "critical",
        }).show();
        return;
      }

      console.log(`Selected text: ${selectedText}`);
      // Send 'start-loading' to renderer before calling fixGrammar
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("start-loading");
      }

      showOverlaySpinner();
      const result = await fixGrammar(apiKey, selectedText);

      // Store texts for potential Undo/Retry
      lastOriginalText = selectedText;
      _lastFixedText = result.correctedText;
      if (result.correctedText === selectedText) {
        new Notification({
          title: "Good job!",
          body: "Your text is already correct. No changes have been made.",
        }).show();
      }

      await pasteText(result.correctedText);

      // History management is now handled directly in the fix-grammar IPC handler
      // No need to manage history here

      // Send the original and corrected text to the renderer process for preview
      if (mainWindow && !mainWindow.isDestroyed()) {
        console.log("Sending text update via IPC to renderer...");
        mainWindow.webContents.send("update-text", {
          original: selectedText,
          corrected: result.correctedText,
          promptTokens: result.promptTokens,
          completionTokens: result.completionTokens,
        });
        // Hide spinner overlay for renderer UI
        mainWindow.webContents.send("stop-loading");
      } else {
        console.warn(
          "Cannot send IPC message: mainWindow is null or destroyed."
        );
      }
      // Always hide global spinner overlay (robust)
      hideOverlaySpinner();
    } catch (error) {
      // Hide spinner overlay even on error
      hideOverlaySpinner();
      handleError(error);
    }
  });

  checkShortcut(retFix);
};

const checkShortcut = (shortcut: boolean) => {
  if (!shortcut) {
    console.error(`Shortcut ${shortcut} is not set in settings.`);
    handleError(new Error(`Shortcut ${shortcut} is not set in settings.`));
    return false;
  }
  console.log(`Global shortcut ${shortcut} registered successfully.`);
  return true;
};

/**
 * Registers the global shortcut for translation.
 */
const registerTranslateShortcut = (mainWindow: BrowserWindow) => {
  const translateShortcut = keybindingStore.getKeyBindings().translate;
  // Skip registration if undefined or empty to avoid errors
  if (!translateShortcut) {
    console.warn(
      "[Hotkey] translate shortcut is undefined, skipping registration."
    );
    return;
  }
  const ret = globalShortcut.register(translateShortcut, async () => {
    console.log(`${translateShortcut} is pressed (Translate)`);
    const apiKey = getOpenAIKey();
    const selectedText = await getHighlightedText();
    // Dynamically read the latest translation target from settings
    const settings = store.get(
      "settingsTranslate"
    ) as SettingsStore["settingsTranslate"];
    const lang = settings.destinationLang || app.getLocale();
    if (!selectedText || !selectedText.trim()) {
      new Notification({ title: "Error", body: "No text selected." }).show();
      return;
    }
    // Capture cursor position for positioning the popup on completion
    const { x, y } = screen.getCursorScreenPoint();
    // Show overlay spinner in main window
    if (mainWindow && !mainWindow.isDestroyed())
      mainWindow.webContents.send("start-loading");
    showOverlaySpinner();
    try {
      const result = await translateText(apiKey, selectedText, lang);
      // Update popup with result
      showTranslationWindow({
        ...result,
        originalText: selectedText,
        targetLang: lang,
        loading: false,
        x,
        y,
      });
      // Persist translation to store
      const transEntry: VersionEntry = {
        original: selectedText,
        corrected: result.translatedText,
        timestamp: new Date().toISOString(),
      };
      const allTrans = store.get("translations") as VersionEntry[];
      store.set("translations", [...allTrans, transEntry]);
      // Update main window text areas
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("update-text", {
          original: selectedText,
          corrected: result.translatedText,
          promptTokens: result.promptTokens,
          completionTokens: result.completionTokens,
        });
      }
    } catch (error) {
      new Notification({
        title: "Error",
        body:
          error instanceof Error
            ? error.message
            : "Failed to translate text. Please try again.",
        urgency: "critical",
      }).show();
    } finally {
      if (mainWindow && !mainWindow.isDestroyed())
        mainWindow.webContents.send("stop-loading");
      hideOverlaySpinner();
    }
  });
  checkShortcut(ret);
};

// Registers the global shortcut for summarize.
const registerSummarizeShortcut = (_mainWindow: BrowserWindow): void => {
  const summarizeShortcut = keybindingStore.getKeyBindings().summarize;
  if (!summarizeShortcut) return;
  const ret = globalShortcut.register(summarizeShortcut, async () => {
    console.log(`${summarizeShortcut} pressed (Summarize)`);
    try {
      const apiKey = getOpenAIKey();
      const selectedText = await getHighlightedText();
      if (!selectedText || !selectedText.trim()) {
        new Notification({ title: "Error", body: "No text selected." }).show();
        return;
      }
      const { x, y } = screen.getCursorScreenPoint();
      showOverlaySpinner();
      const result = await summarizeText(
        apiKey,
        selectedText,
        store.get("maxSummaryTokens") as number
      );
      hideOverlaySpinner();

      // Save summarization to history
      try {
        const entry = {
          original: selectedText,
          corrected: result.summarizedText,
          timestamp: new Date().toISOString(),
          promptTokens: result.promptTokens,
          completionTokens: result.completionTokens,
        };
        const historySummarize =
          (store.get("historySummarize") as VersionEntry[]) ?? [];
        historySummarize.unshift(entry);
        if (historySummarize.length > 20) historySummarize.pop();
        store.set("historySummarize", historySummarize);

        // Notify all windows of history update
        BrowserWindow.getAllWindows().forEach((window) => {
          if (!window.isDestroyed()) {
            window.webContents.send("summarize-history-updated");
          }
        });

        console.log(`Saved summarize entry to history`);
      } catch (e) {
        console.error("Failed to save summarize history entry from hotkey:", e);
      }

      showSummaryWindow({
        summarizedText: result.summarizedText,
        promptTokens: result.promptTokens,
        completionTokens: result.completionTokens,
        x,
        y,
      });
    } catch (error) {
      hideOverlaySpinner();
      handleError(error);
    }
  });
  checkShortcut(ret);
};

// Registers the global shortcut for prompt generation
const registerPromptGenShortcut = (_mainWindow: BrowserWindow): void => {
  const promptGenShortcut = keybindingStore.getKeyBindings().promptGen;
  if (!promptGenShortcut) return;

  const ret = globalShortcut.register(promptGenShortcut, async () => {
    console.log(`${promptGenShortcut} pressed (PromptGen)`);
    try {
      const apiKey = getOpenAIKey();
      const selectedText = await getHighlightedText();
      if (!selectedText || !selectedText.trim()) {
        new Notification({ title: "Error", body: "No text selected." }).show();
        return;
      }
      const { x, y } = screen.getCursorScreenPoint();
      showOverlaySpinner();
      // Get all required settings
      const promptGenSettings = store.get("settingsPromptGen");
      const model = store.get("selectedModel") as string;
      const temperature = store.get("temperature") as number;

      const result = await generatePrompt({
        apiKey,
        text: selectedText,
        model,
        temperature,
        ...promptGenSettings,
      });
      hideOverlaySpinner();

      // Save to history if generation was successful
      if (result.prompts.length > 0) {
        try {
          // Save generated prompts to history directly
          const entry = {
            original: selectedText,
            corrected: result.prompts.join("\n"),
            timestamp: new Date().toISOString(),
            promptTokens: result.promptTokens,
            completionTokens: result.completionTokens,
          };

          // Directly manage history in the store
          const history = (store.get("historyPromptGen") as VersionEntry[]) ?? [];
          // Add new entry at the beginning
          const newHistory = [entry, ...history].slice(0, 50);
          store.set("historyPromptGen", newHistory);
          
          // Notify all windows of history update
          BrowserWindow.getAllWindows().forEach((window) => {
            if (!window.isDestroyed()) {
              window.webContents.send("promptGen-history-updated");
            }
          });

          console.log(
            `Saved ${result.prompts.length} prompt generation to history`
          );
        } catch (e) {
          console.error(
            "Failed to save prompt generation history from hotkey:",
            e
          );
        }
      }

      showPromptGenWindow({
        prompts: result.prompts,
        promptTokens: result.promptTokens,
        completionTokens: result.completionTokens,
        x,
        y,
        autoCopy: promptGenSettings.autoCopy || false,
      });
    } catch (error) {
      hideOverlaySpinner();
      handleError(error);
    }
  });
  checkShortcut(ret);
};

const handleError = (error: unknown) => {
  console.error("Error during grammar fixing or IPC send:", error);
  // Optional: Show error notification
  new Notification({
    title: "Error",
    body:
      error instanceof Error
        ? error.message
        : "Failed to correct text. Please try again.",
    urgency: "critical",
  }).show();
};

const getOpenAIKey = () => {
  const apiKey = store.get("apiKey");
  if (!apiKey) {
    throw new Error("OpenAI API Key not set in settings.");
  }
  return apiKey;
};

/**
 * Opens/toggles DevTools for the focused window on F12.
 */
const registerDevToolsShortcut = (): void => {
  const ret = globalShortcut.register("F12", () => {
    const win = BrowserWindow.getFocusedWindow();
    if (win) win.webContents.toggleDevTools();
  });
  checkShortcut(ret);
};

/**
 * Un-registers all global shortcuts when the app quits.
 */
export const unregisterHotkeys = () => {
  globalShortcut.unregisterAll();
  console.log("All global shortcuts unregistered.");
};
