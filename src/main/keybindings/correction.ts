import { globalShortcut, Notification } from "electron";
import { resolvePresetOutputMode } from "~/features/correction/shared/presetOutputMode";
import { keybindingStore } from "~/features/correction/store/keybindingStore";
import { outputModeStore } from "~/features/correction/store/outputModeStore";
import { syncHistory } from "~/features/history/main/history";
import { getProfileSetting } from "~/features/providers/store/apiStore";
import { DEFAULT_CORRECTION_PRESET_ID } from "~/prompts";
// No apiStore import needed as api key is handled in shared.ts
import {
  getHighlightedTextForOptionalContext,
  getHighlightedTextWithActiveApp,
  pasteText,
} from "../../utils";
import { fixGrammar } from "../ai.request";
import { runAskFlow } from "./askFlow";
import { buildCorrectionGoodJobNotification } from "./correctionNotifications";
import { deliverCorrectionOutput } from "./correctionOutput";
import { checkShortcut, handleError, withHotkeyThrottle } from "./utils";
import { effectiveModelRef } from "../ai.request/correction";
import { buildPriceMap, computeCost } from "../ai.request/cost";
import { getCachedModels, isLocalModelId } from "../ai.request/shared";
import { prewarmProviderConnection } from "../llm/prewarm";
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

      // Fire-and-forget: starts the provider's TCP+TLS handshake now so it
      // overlaps the AppleScript selection read below (and, for the
      // `requiresInput` branch, the time the user spends typing into the Ask
      // input window) instead of happening serially right before the real
      // request. Never throws, never blocks, never surfaces an error — see
      // `~/main/llm/prewarm.ts`'s own contract.
      prewarmProviderConnection(effectiveModelRef(preset));

      try {
        // Ask AI inverts the outbound-polish presets below: an empty
        // selection is the normal case (the question can stand alone), so it
        // must never hit the "no text selected" abort. The window itself
        // owns the request from here — asking the user for a question, then
        // handing the answer off to `runAskFlow`. It reads via
        // `getHighlightedTextForOptionalContext`, NOT the combined
        // `getHighlightedTextWithActiveApp` below — the two disagree on
        // purpose about what an unchanged clipboard means: the optional
        // variant reports "" (no context) so a stale, unrelated clipboard is
        // never attached as the question's context; the combined variant
        // below instead falls back to the clipboard's own content, same as
        // it always did, because it also has to support a real re-selection
        // of text byte-identical to the clipboard (see `~/utils.ts`).
        //
        // Ask AI also never uses source-app context (see askFlow.ts's own
        // doc comment) — unlike the branch below, it does not read the
        // frontmost app at all, since that read would just be a wasted
        // osascript round-trip for this preset.
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

        // One osascript invocation reads the frontmost app and THEN sends
        // the Cmd-C keystroke (see getHighlightedTextWithActiveApp) instead
        // of two separate spawns. The callback fires right after that script
        // returns — before the clipboard-change poll — which is the
        // earliest point it is still safe to show the overlay spinner: the
        // frontmost-app read must precede any FixLang window becoming
        // visible, since afterwards it would report FixLang and yield null.
        const { text: selectedText, activeApp } = await getHighlightedTextWithActiveApp(
          () => {
            showOverlaySpinner();
          },
        );

        if (!selectedText || !selectedText.trim()) {
          // Safe even though the spinner may not have been shown yet
          // (e.g. the combined read threw before the callback fired):
          // hiding an overlay that was never shown is a no-op.
          hideOverlaySpinner();
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
