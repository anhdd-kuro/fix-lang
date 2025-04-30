import { app, globalShortcut, Notification, screen } from "electron";
import { store } from "~/stores/apiStore";
import { keybindingStore } from "~/stores/keybindingStore";
import { getHighlightedText } from "../../utils";
import { translateText } from "../ai.request";
import { checkShortcut } from "./utils";
import { syncHistory } from "../ipc/features/history";
import { showOverlaySpinner, hideOverlaySpinner } from "../partials";
import { showTranslationWindow } from "../partials/translationWindow";
import type { BrowserWindow } from "electron";
import type { SettingsStore } from "~/stores/apiStore";

export const registerTranslateShortcut = (mainWindow: BrowserWindow) => {
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
      const result = await translateText(selectedText, lang);
      // Update popup with result
      showTranslationWindow({
        ...result,
        originalText: selectedText,
        targetLang: lang,
        loading: false,
        x,
        y,
      });
      syncHistory({
        entry: {
          original: selectedText,
          corrected: result.translatedText,
          promptTokens: result.promptTokens ?? 0,
          completionTokens: result.completionTokens ?? 0,
          timestamp: new Date().toISOString(),
          model: result.model,
        },
        type: "add",
        featureId: "translations",
      });
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
