import { globalShortcut, screen } from "electron";
import { getActiveApp } from "~/main/accessibility/activeApp";
import { keybindingStore } from "~/stores/keybindingStore";
import { getHighlightedText } from "../../utils";
import { generatePrompt } from "../ai.request";
import { checkShortcut, handleError, withHotkeyThrottle } from "./utils";
import { syncHistory } from "../ipc/features/history";
import { logger } from "../logging/logService";
import { LocalizedError } from "../notifications/error";
import { showOverlaySpinner, hideOverlaySpinner } from "../webViewWindows";
import { showPromptGenWindow } from "../webViewWindows/promptGenWindow";
import type { BrowserWindow } from "electron";

export const registerPromptGenShortcut = (_mainWindow: BrowserWindow): void => {
  const promptGenShortcut = keybindingStore.getKeyBindings().promptGen;
  if (!promptGenShortcut) return;

  const ret = globalShortcut.register(
    promptGenShortcut,
    withHotkeyThrottle(promptGenShortcut, async () => {
    logger.info("promptGen.hotkey", "Hotkey triggered");
    try {
      // Before the spinner and the PromptGen window: once a FixLang window is
      // up, the frontmost-app read returns FixLang and yields null.
      const activeApp = await getActiveApp();
      const selectedText = await getHighlightedText();
      if (!selectedText || !selectedText.trim()) {
        handleError(
          new LocalizedError("No text selected.", "notifications.error.noTextSelected.body"),
        );
        return;
      }
      const { x, y } = screen.getCursorScreenPoint();
      showOverlaySpinner();

      const result = await generatePrompt({
        text: selectedText,
        activeAppName: activeApp?.name,
      });
      hideOverlaySpinner();

      showPromptGenWindow({
        prompts: result.prompts,
        promptTokens: result.promptTokens,
        completionTokens: result.completionTokens,
        x,
        y,
        model: result.model,
        resolvedModel: result.resolvedModel,
      });
      syncHistory({
        entry: {
          original: selectedText,
          corrected: result.prompts
            .map((p, i) => `Prompt ${i + 1}: \n${p}`)
            .join("\n-------------------\n"),
          promptTokens: result.promptTokens ?? 0,
          completionTokens: result.completionTokens ?? 0,
          timestamp: new Date().toISOString(),
          model: result.model,
          provider: result.provider,
          resolvedModel: result.resolvedModel,
          presetName: "PromptGen",
          sessionJson: result.sessionJson,
        },
        type: "add",
        featureId: "promptGen",
      });
    } catch (error) {
      hideOverlaySpinner();
      handleError(error);
    }
  }),
  );
  checkShortcut(ret);
};
