import { globalShortcut, Notification, screen } from "electron";
import { store } from "~/stores/apiStore";
import { keybindingStore } from "~/stores/keybindingStore";
import { getHighlightedText } from "../../utils";
import { summarizeText } from "../ai.request";
import { checkShortcut, handleError } from "./utils";
import { syncHistory } from "../ipc/features/history";
import { showOverlaySpinner, hideOverlaySpinner } from "../partials";
import { showSummaryWindow } from "../partials/summaryWindow";
import type { BrowserWindow } from "electron";

export const registerSummarizeShortcut = (_mainWindow: BrowserWindow): void => {
  const summarizeShortcut = keybindingStore.getKeyBindings().summarize;
  if (!summarizeShortcut) return;
  const ret = globalShortcut.register(summarizeShortcut, async () => {
    console.log(`${summarizeShortcut} pressed (Summarize)`);
    try {
      const selectedText = await getHighlightedText();
      if (!selectedText || !selectedText.trim()) {
        new Notification({ title: "Error", body: "No text selected." }).show();
        return;
      }
      const { x, y } = screen.getCursorScreenPoint();
      showOverlaySpinner();
      const result = await summarizeText(
        selectedText,
        store.get("maxSummaryTokens") as number
      );
      hideOverlaySpinner();

      showSummaryWindow({
        summarizedText: result.summarizedText,
        promptTokens: result.promptTokens,
        completionTokens: result.completionTokens,
        x,
        y,
      });
      syncHistory({
        entry: {
          original: selectedText,
          corrected: result.summarizedText,
          promptTokens: result.promptTokens ?? 0,
          completionTokens: result.completionTokens ?? 0,
          timestamp: new Date().toISOString(),
        },
        type: "add",
        featureId: "summarize",
      });
    } catch (error) {
      hideOverlaySpinner();
      handleError(error);
    }
  });
  checkShortcut(ret);
};
