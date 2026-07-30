import { globalShortcut, Notification } from "electron";
import { resolvePresetOutputMode } from "~/features/correction/shared/presetOutputMode";
import { keybindingStore } from "~/features/correction/store/keybindingStore";
import { outputModeStore } from "~/features/correction/store/outputModeStore";
import { syncHistory } from "~/features/history/main/history";
import { getProfileSetting } from "~/features/providers/store/apiStore";
import { getActiveApp } from "~/main/accessibility/activeApp";
import { DEFAULT_CORRECTION_PRESET_ID } from "~/prompts";
// No apiStore import needed as api key is handled in shared.ts
import { getHighlightedText, getHighlightedTextForOptionalContext, pasteText } from "../../utils";
import { fixGrammar } from "../ai.request";
import { runAskFlow } from "./askFlow";
import { buildCorrectionGoodJobNotification } from "./correctionNotifications";
import { deliverCorrectionOutput } from "./correctionOutput";
import { checkShortcut, handleError, withHotkeyThrottle } from "./utils";
import { buildPriceMap, computeCost } from "../ai.request/cost";
import { getCachedModels, isLocalModelId } from "../ai.request/shared";
import { logger } from "../logging/logService";
import { LocalizedError } from "../notifications/error";
import { hideOverlaySpinner, showOverlaySpinner } from "../webViewWindows";
import { showAskInputWindow } from "../webViewWindows/askInputWindow";
import { showCorrectionResultWindow } from "../webViewWindows/correctionResultWindow";
import type { BrowserWindow } from "electron";

export const registerCorrectionShortcut = (mainWindow: BrowserWindow) => {
  const correctionSettings = getProfileSetting("settingsCorrect");
  const registeredShortcuts = new Set<string>();
  const { promptGen, profileSwitch } =
    keybindingStore.getKeyBindings();
  const reservedShortcuts = new Set([promptGen, profileSwitch]);

  correctionSettings.presets.forEach((preset) => {
    const shortcut = preset.hotkey?.trim();

    if (!shortcut) {
      return;
    }

    if (registeredShortcuts.has(shortcut)) {
      logger.warn("correction.register", "Skipping duplicate correction shortcut", {
        presetId: preset.id,
      });
      return;
    }

    if (reservedShortcuts.has(shortcut)) {
      logger.warn("correction.register", "Skipping conflicting correction shortcut", {
        presetId: preset.id,
      });
      return;
    }

    registeredShortcuts.add(shortcut);

    const registered = globalShortcut.register(
      shortcut,
      withHotkeyThrottle(shortcut, async () => {
      logger.info("correction.hotkey", "Hotkey triggered", {
        presetId: preset.id,
      });

      try {
        // Must precede `showOverlaySpinner` below: once a FixLang window is on
        // screen this read reports FixLang and yields null.
        const activeApp = await getActiveApp();

        // Ask AI inverts the outbound-polish presets below: an empty
        // selection is the normal case (the question can stand alone), so it
        // must never hit the "no text selected" abort. The window itself
        // owns the request from here — asking the user for a question, then
        // handing the answer off to `runAskFlow`. It reads via
        // `getHighlightedTextForOptionalContext`, NOT `getHighlightedText`:
        // the latter cannot tell "nothing selected" apart from "clipboard
        // still holds whatever was there before", so a stale clipboard would
        // otherwise be silently attached as the question's context.
        if (preset.requiresInput) {
          const context = await getHighlightedTextForOptionalContext();
          showAskInputWindow(
            { presetId: preset.id, context },
            {
              onSubmit: (question) => {
                void runAskFlow({ preset, context, question, mainWindow });
              },
              onCancel: () => {
                logger.debug("correction.hotkey", "Ask input cancelled", {
                  presetId: preset.id,
                });
              },
            },
          );
          return;
        }

        const selectedText = await getHighlightedText();

        if (!selectedText || !selectedText.trim()) {
          logger.warn(
            "correction.hotkey",
            "No text selected or clipboard is empty",
            { presetId: preset.id },
          );
          handleError(
            new LocalizedError(
              "No text selected or clipboard is empty.",
              "notifications.error.noTextSelected.body",
            ),
          );
          return;
        }

        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("start-loading");
        }

        showOverlaySpinner();
        const result = await fixGrammar(selectedText, preset.id, {
          activeAppName: activeApp?.name,
        });

        if (
          result.correctedText === selectedText &&
          preset.id === DEFAULT_CORRECTION_PRESET_ID
        ) {
          new Notification(buildCorrectionGoodJobNotification()).show();
        }

        // Settings offers the per-preset output mode on EVERY preset, not just
        // the `requiresInput` one, so resolve it here too — reading the global
        // store directly would leave that control visible, writable, persisted
        // and inert for all six polish presets.
        const delivery = await deliverCorrectionOutput(
          resolvePresetOutputMode(
            preset.outputMode,
            outputModeStore.getCorrectionOutputMode(),
          ),
          {
            presetName: preset.name,
            text: result.correctedText,
          },
          {
            paste: pasteText,
            showPopup: showCorrectionResultWindow,
          },
        );

        logger.info("correction.hotkey", "Correction completed", {
          presetId: preset.id,
          textLength: selectedText.length,
          model: result.model,
          // `?? null` throughout: `LogValue` has no `undefined` member.
          provider: result.provider ?? null,
          resolvedModel: result.resolvedModel ?? null,
          activeApp: activeApp?.name ?? null,
          delivery,
        });

        if (mainWindow && !mainWindow.isDestroyed()) {
          // Cost snapshot (#56): price the served model against the cached
          // OpenRouter /models price map. Local (Ollama) → $0; no confident
          // match → N/A. All logic is in the pure computeCost; this is glue.
          const servedId = result.resolvedModel ?? result.model;
          const cost = computeCost(
            {
              model: result.model,
              resolvedModel: result.resolvedModel,
              promptTokens: result.promptTokens ?? 0,
              completionTokens: result.completionTokens ?? 0,
              provider: result.provider,
              isLocal: isLocalModelId(servedId, result.provider),
            },
            buildPriceMap(getCachedModels()),
          );

          syncHistory({
            entry: {
              original: selectedText,
              corrected: result.correctedText,
              promptTokens: result.promptTokens ?? 0,
              completionTokens: result.completionTokens ?? 0,
              timestamp: new Date().toISOString(),
              model: result.model,
              provider: result.provider,
              resolvedModel: result.resolvedModel,
              presetName: result.presetName,
              // Spread the snapshot; undefined fields (N/A) round-trip to NULL.
              estimatedCostUsd: cost.estimatedCostUsd ?? undefined,
              pricePrompt: cost.pricePrompt ?? undefined,
              priceCompletion: cost.priceCompletion ?? undefined,
              costStatus: cost.status,
              sessionJson: result.sessionJson,
            },
            type: "add",
            // All preset outputs share the "corrections" bucket and are
            // distinguished by presetName (drives the dynamic history filter).
            featureId: "corrections",
          });
          mainWindow.webContents.send("stop-loading");
        } else {
          logger.warn(
            "correction.hotkey",
            "Cannot send IPC message: mainWindow is null or destroyed",
          );
        }

        hideOverlaySpinner();
      } catch (error) {
        hideOverlaySpinner();
        logger.error("correction.hotkey", "Correction failed", {
          presetId: preset.id,
          error: error instanceof Error ? error.message : String(error),
        });
        handleError(error);
      }
    }),
    );

    checkShortcut(registered);
  });
};
