import { globalShortcut, screen } from "electron";
import { keybindingStore } from "~/stores/keybindingStore";
import { getHighlightedText } from "../../utils";
import { generatePrompt } from "../ai.request";
import { checkShortcut, handleError } from "./utils";
import { syncHistory } from "../ipc/features/history";
import { showOverlaySpinner, hideOverlaySpinner } from "../webViewWindows";
import { showPromptGenWindow } from "../webViewWindows/promptGenWindow";
import type { BrowserWindow } from "electron";

export const registerPromptGenShortcut = (_mainWindow: BrowserWindow): void => {
  const promptGenShortcut = keybindingStore.getKeyBindings().promptGen;
  if (!promptGenShortcut) return;

  const ret = globalShortcut.register(promptGenShortcut, async () => {
    console.log(`${promptGenShortcut} pressed (PromptGen)`);
    try {
      const selectedText = await getHighlightedText();
      if (!selectedText || !selectedText.trim()) {
        handleError(new Error("No text selected."));
        return;
      }
      const { x, y } = screen.getCursorScreenPoint();
      showOverlaySpinner();

      const result = await generatePrompt({
        text: selectedText,
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
          resolvedModel: result.resolvedModel,
          presetName: "PromptGen",
        },
        type: "add",
        featureId: "promptGen",
      });
    } catch (error) {
      hideOverlaySpinner();
      handleError(error);
    }
  });
  checkShortcut(ret);
};
