import { globalShortcut, Notification } from "electron";
import { DEFAULT_CORRECTION_PRESET_ID } from "~/prompts";
// No apiStore import needed as api key is handled in shared.ts
import { getProfileSetting } from "~/stores/apiStore";
import { keybindingStore } from "~/stores/keybindingStore";
import { getHighlightedText, pasteText } from "../../utils";
import { fixGrammar } from "../ai.request";
import { checkShortcut, handleError } from "./utils";
import { syncHistory } from "../ipc/features/history";
import { hideOverlaySpinner, showOverlaySpinner } from "../webViewWindows";
import type { BrowserWindow } from "electron";

export const registerCorrectionShortcut = (mainWindow: BrowserWindow) => {
  const correctionSettings = getProfileSetting("settingsCorrect");
  const registeredShortcuts = new Set<string>();
  const { translate, promptGen, profileSwitch } =
    keybindingStore.getKeyBindings();
  const reservedShortcuts = new Set([translate, promptGen, profileSwitch]);

  correctionSettings.presets.forEach((preset) => {
    const shortcut = preset.hotkey?.trim();

    if (!shortcut) {
      return;
    }

    if (registeredShortcuts.has(shortcut)) {
      console.warn(`Skipping duplicate correction shortcut: ${shortcut}`);
      return;
    }

    if (reservedShortcuts.has(shortcut)) {
      console.warn(`Skipping conflicting correction shortcut: ${shortcut}`);
      return;
    }

    registeredShortcuts.add(shortcut);

    const registered = globalShortcut.register(shortcut, async () => {
      console.log(`${shortcut} is pressed for preset ${preset.name}`);

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

        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("start-loading");
        }

        showOverlaySpinner();
        const result = await fixGrammar(selectedText, preset.id);

        if (
          result.correctedText === selectedText &&
          preset.id === DEFAULT_CORRECTION_PRESET_ID
        ) {
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
              model: result.model,
              presetName: result.presetName,
            },
            type: "add",
            featureId: "corrections",
          });
          mainWindow.webContents.send("stop-loading");
        } else {
          console.warn(
            "Cannot send IPC message: mainWindow is null or destroyed.",
          );
        }

        hideOverlaySpinner();
      } catch (error) {
        hideOverlaySpinner();
        handleError(error);
      }
    });

    checkShortcut(registered);
  });
};
