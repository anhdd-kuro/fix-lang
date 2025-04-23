import { globalShortcut, Notification, screen } from "electron";
import { getOpenAIKey, store } from "~/stores/apiStore";
import { keybindingStore } from "~/stores/keybindingStore";
import { getHighlightedText } from "../../utils";
import { generatePrompt } from "../ai.request";
import { checkShortcut, handleError } from "./utils";
import { syncHistory } from "../ipc/features/history";
import { showOverlaySpinner, hideOverlaySpinner } from "../partials";
import { showPromptGenWindow } from "../partials/promptGenWindow";
import type { BrowserWindow } from "electron";

export const registerPromptGenShortcut = (_mainWindow: BrowserWindow): void => {
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

      showPromptGenWindow({
        prompts: result.prompts,
        promptTokens: result.promptTokens,
        completionTokens: result.completionTokens,
        x,
        y,
        autoCopy: promptGenSettings.autoCopy || false,
      });
      syncHistory({
        entry: {
          original: selectedText,
          corrected: result.prompts[0],
          promptTokens: result.promptTokens ?? 0,
          completionTokens: result.completionTokens ?? 0,
          timestamp: new Date().toISOString(),
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
