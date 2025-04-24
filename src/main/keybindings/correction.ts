import { globalShortcut, Notification } from "electron";
// No apiStore import needed as api key is handled in shared.ts
import { keybindingStore } from "~/stores/keybindingStore";
import { getHighlightedText, pasteText } from "../../utils";
import { fixGrammar } from "../ai.request";
import { syncHistory } from "../ipc/features/history";
import { hideOverlaySpinner, showOverlaySpinner } from "../partials";
import { checkShortcut, handleError } from "./utils";
import type { BrowserWindow } from "electron";

export const registerCorrectionShortcut = (mainWindow: BrowserWindow) => {
  const fixShortcut = keybindingStore.getKeyBindings().correction;
  const retFix = globalShortcut.register(fixShortcut, async () => {
    console.log(`${fixShortcut} is pressed`);

    try {
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
      const result = await fixGrammar(selectedText);

      if (result.correctedText === selectedText) {
        new Notification({
          title: "Good job!",
          body: "Your text is already correct. No changes have been made.",
        }).show();
      }

      await pasteText(result.correctedText);

      if (mainWindow && !mainWindow.isDestroyed()) {
        syncHistory({
          entry: {
            original: selectedText,
            corrected: result.correctedText,
            promptTokens: result.promptTokens ?? 0,
            completionTokens: result.completionTokens ?? 0,
            timestamp: new Date().toISOString(),
          },
          type: "add",
          featureId: "corrections",
        });
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
