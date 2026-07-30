import { globalShortcut, screen } from "electron";
import { getActiveApp } from "~/main/accessibility/activeApp";
import { getAxSelectedText } from "~/main/accessibility/selectedText";
import { clipboardFallbackStore } from "~/stores/clipboardFallbackStore";
import { keybindingStore } from "~/stores/keybindingStore";
import { getHighlightedText } from "../../utils";
import { generatePrompt } from "../ai.request";
import { resolveSelectedText } from "./selectionSource";
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
      // up, the frontmost-app read returns FixLang and yields null — and the
      // selection read below, which walks the same frontmost process, would
      // report our own window's selection instead of the user's.
      const activeApp = await getActiveApp();
      const selection = await resolveSelectedText({
        readAx: getAxSelectedText,
        readClipboard: getHighlightedText,
        clipboardFallbackEnabled:
          clipboardFallbackStore.getClipboardFallbackEnabled(),
      });
      if (selection.selectedText === null) {
        // `reason` only — never the outcome itself: spreading it would put the
        // user's selection in the on-disk JSONL.
        logger.warn("promptGen.hotkey", "No text selected or clipboard is empty", {
          reason: selection.reason,
        });
        handleError(
          new LocalizedError("No text selected.", "notifications.error.noTextSelected.body"),
        );
        return;
      }
      const { selectedText, source: selectionSource } = selection;
      const { x, y } = screen.getCursorScreenPoint();
      showOverlaySpinner();

      const result = await generatePrompt({
        text: selectedText,
        activeAppName: activeApp?.name,
      });
      hideOverlaySpinner();

      // Which read supplied the text is the whole diagnosis when a user reports
      // that PromptGen worked on the wrong text — `correction.hotkey` records it
      // on its completion line, and without this PromptGen had no equivalent.
      logger.info("promptGen.hotkey", "Prompt generation completed", {
        selectionSource,
        textLength: selectedText.length,
        // `?? null` throughout: `LogValue` has no `undefined` member.
        model: result.model,
        resolvedModel: result.resolvedModel ?? null,
        activeApp: activeApp?.name ?? null,
      });

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
