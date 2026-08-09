import { globalShortcut, Notification } from "electron";
import { resolvePresetOutputMode } from "~/features/correction/shared/presetOutputMode";
import { keybindingStore } from "~/features/correction/store/keybindingStore";
import { outputModeStore } from "~/features/correction/store/outputModeStore";
import { syncHistory } from "~/features/history/main/history";
import { getProfileSetting } from "~/features/providers/store/apiStore";
import { DEFAULT_CORRECTION_PRESET_ID } from "~/prompts";
// No apiStore import needed as api key is handled in shared.ts
import {
  getAskContext,
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
import { startLatencyTimer } from "../logging/latencyTimer";
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
      // Started before anything else in the handler, including the prewarm, so
      // `totalMs` is the number the user actually feels: press → result in
      // front of them. Everything after this line is inside the measurement.
      const latency = startLatencyTimer({
        scope: "correction.latency",
        message: "Transform latency",
        context: { presetId: preset.id },
      });

      logger.info("correction.hotkey", "Hotkey triggered", {
        presetId: preset.id,
      });

      try {
        // Fire-and-forget: starts the provider's TCP+TLS handshake now so it
        // overlaps the AppleScript selection read below (and, for the
        // `requiresInput` branch, the time the user spends typing into the Ask
        // input window) instead of happening serially right before the real
        // request. Never throws, never blocks, never surfaces an error — see
        // `~/main/llm/prewarm.ts`'s own contract. Kept INSIDE the try so that
        // nothing between starting the timer and delivering can return without
        // finishing it, even if that contract is ever broken.
        prewarmProviderConnection(effectiveModelRef(preset));

        // Ask AI inverts the outbound-polish presets below: an empty
        // selection is the normal case (the question can stand alone), so it
        // must never hit the "no text selected" abort. The window itself
        // owns the request from here — asking the user for a question, then
        // handing the answer off to `runAskFlow`. It reads via `getAskContext`
        // rather than the combined `getHighlightedTextWithActiveApp` below,
        // which reads the frontmost app in the same osascript — a round trip
        // this preset would waste, since Ask never uses app context.
        //
        // Same clipboard contract as every other preset, including the
        // fallback: where the text came from travels with it, so the input
        // window can label a clipboard-sourced context instead of passing it
        // off as the user's selection (see `~/utils.ts`).
        //
        // Ask AI also never uses source-app context (see askFlow.ts's own
        // doc comment) — unlike the branch below, it does not read the
        // frontmost app at all, since that read would just be a wasted
        // osascript round-trip for this preset.
        if (preset.requiresInput) {
          const { text: context, source: contextSource } = await getAskContext();
          latency.mark("selectionRead");
          // The one line that says whether the selection made it, and which
          // source it came from. Without it, "the user selected nothing" and
          // "the copy produced nothing so this is their clipboard" both look
          // like the same input window. Lengths only — the text itself never
          // goes in a log.
          logger.debug("correction.hotkey", "Ask context resolved", {
            presetId: preset.id,
            contextLength: context.length,
            contextAttached: context.length > 0,
            contextSource,
          });
          showAskInputWindow(
            { presetId: preset.id, context, contextSource },
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
          // Ask AI's clock stops here on purpose: past this point the elapsed
          // time is the user typing a question, which is not latency. The
          // request half is measured separately from submit, in `askFlow.ts`.
          latency.finish({ outcome: "input-shown" });
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
            // Splits the osascript spawn from the clipboard-change poll that
            // follows it — the two fail slow for completely different reasons
            // (System Events contention vs. a sluggish source app), so a
            // single combined number would not say which one regressed.
            latency.mark("keystrokeSent");
            showOverlaySpinner();
          },
        );
        latency.mark("selectionPoll");

        if (!selectedText || !selectedText.trim()) {
          // Safe even though the spinner may not have been shown yet
          // (e.g. the combined read threw before the callback fired):
          // hiding an overlay that was never shown is a no-op.
          hideOverlaySpinner();
          latency.finish({ outcome: "no-selection" });
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
        latency.mark("aiRequest");

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
        latency.mark("delivery");
        // Finished here, NOT at the end of the handler: everything below is
        // bookkeeping the user never waits for (cost snapshot, history write,
        // IPC). Including it would inflate the number the user feels.
        latency.finish({ outcome: "delivered", delivery });

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
        // No-op when delivery already finished the timer (first finish wins) —
        // a post-delivery throw must not relabel a real measurement as failed.
        latency.finish({ outcome: "failed" });
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
