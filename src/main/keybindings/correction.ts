import { globalShortcut, Notification } from "electron";
import { resolvePresetOutputMode } from "~/features/correction/shared/presetOutputMode";
import { keybindingStore } from "~/features/correction/store/keybindingStore";
import { outputModeStore } from "~/features/correction/store/outputModeStore";
import { evaluateSelectionGuards } from "~/features/guards/shared/selectionGuards";
import { guardStore } from "~/features/guards/store/guardStore";
import { syncHistory } from "~/features/history/main/history";
import { getProfileSetting } from "~/features/providers/store/apiStore";
import { restoreSecrets } from "~/features/secretGuard/shared/maskSecrets";
import { resolveSecretGuardOutputMode } from "~/features/secretGuard/shared/secretGuardOutputMode";
import { secretGuardStore } from "~/features/secretGuard/store/secretGuardStore";
import { mainT } from "~/main/i18n";
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
import { runSecretGate } from "./secretGate";
import { checkShortcut, handleError, withHotkeyThrottle } from "./utils";
import { effectiveModelRef } from "../ai.request/correction";
import { buildPriceMap, computeCost } from "../ai.request/cost";
import { getCachedModels, isLocalModelId } from "../ai.request/shared";
import * as clipboardChangeTracker from "../clipboard/clipboardChangeTracker";
import { prewarmProviderConnection } from "../llm/prewarm";
import { startLatencyTimer } from "../logging/latencyTimer";
import { logger } from "../logging/logService";
import { confirmLargeSelection } from "../notifications/confirmLargeSelection";
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
          latency.mark("selectionRead");
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
        const { text: selectedText, activeApp, changed } = await getHighlightedTextWithActiveApp(
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

        // Read fresh on every press, not once at registerCorrectionShortcut
        // time: a settings change must take effect on the very next hotkey
        // press, not only after the next hotkey reload.
        //
        // This check runs on the resolved read result rather than inside
        // `getHighlightedTextWithActiveApp`'s own `onFrontmostReadAndKeystrokeSent`
        // callback: by the time this line runs, the Cmd-C keystroke has
        // already fired inside that same osascript session, and returning
        // early from inside the callback would skip the clipboard restore in
        // its `finally`. So be honest about what this guards: it prevents
        // TRANSMISSION, not reading — the selection is still copied and
        // restored, it just never reaches a provider.
        const verdict = evaluateSelectionGuards({
          text: selectedText,
          changed,
          activeApp,
          ageMs: clipboardChangeTracker.ageMs(),
          settings: guardStore.getSelectionGuardSettings(),
        });

        if (verdict.kind === "block") {
          hideOverlaySpinner();
          // `verdict.reason` doubles as the `LatencyOutcome` member, so no
          // separate mapping table between guard reasons and log outcomes.
          latency.finish({ outcome: verdict.reason });
          logger.warn("correction.hotkey", "Transform blocked by a selection guard", {
            presetId: preset.id,
            guardReason: verdict.reason,
            ...(verdict.reason === "stale-clipboard"
              ? { selectionAgeMs: verdict.ageMs, ageLimitMs: verdict.limitMs }
              : { deniedBundleId: verdict.bundleId }),
          });
          handleError(
            verdict.reason === "stale-clipboard"
              ? new LocalizedError(
                  "Selection blocked: clipboard is older than the configured age limit.",
                  "notifications.error.staleClipboard.body",
                  { seconds: Math.round(verdict.limitMs / 1000) },
                )
              : new LocalizedError(
                  "Selection blocked: the frontmost app is on the deny-list.",
                  "notifications.error.appNotAllowed.body",
                  { app: activeApp?.name ?? verdict.bundleId },
                ),
          );
          return;
        }

        if (verdict.kind === "confirm") {
          hideOverlaySpinner();
          latency.pause();
          const proceed = await confirmLargeSelection(verdict.chars, verdict.limit);
          latency.resume();

          if (!proceed) {
            latency.finish({ outcome: "declined-size" });
            logger.info(
              "correction.hotkey",
              "Transform declined at the large-selection confirm",
              { presetId: preset.id, textLength: verdict.chars, charLimit: verdict.limit },
            );
            // NO error notification — the user clicked Cancel, which is not
            // an error. A toast here would train people to dismiss toasts.
            return;
          }

          showOverlaySpinner();
        }

        // Read fresh on every press, same reason as the selection guards
        // above. `runSecretGate` is the ONLY entry point: the per-site policy
        // lives in `SECRET_SEND_SITE_POLICY`, and re-deriving any part of it
        // here is what that one table exists to prevent.
        const gate = await runSecretGate({
          site: "correction",
          text: selectedText,
          settings: secretGuardStore.getSecretGuardSettings(),
          // Wraps ONLY the modal, never the whole gate: bracketing the gate
          // would hide and re-show the spinner on every transform in confirm
          // mode, including the vast majority where nothing is detected and no
          // dialog opens at all.
          aroundDialog: async (showDialog) => {
            hideOverlaySpinner();
            latency.pause();
            const answer = await showDialog();
            // No `mark()` between pause and resume: the wait would land in the
            // phase delta instead of `pausedMs`.
            latency.resume();
            showOverlaySpinner();
            return answer;
          },
        });

        if (gate.gateDecision === "declined") {
          hideOverlaySpinner();
          latency.finish({ outcome: "secret-declined" });
          logger.info(
            "correction.hotkey",
            "Transform declined at the secret guard",
            { presetId: preset.id, appliedMode: gate.appliedMode },
          );
          // NO error notification, same as the large-selection Cancel. Usually
          // that is because the user answered the dialog and a toast confirming
          // their own Cancel would train people to dismiss toasts. It is NOT
          // always a user choice: `confirmSecretSend` fails closed on a
          // reentrant call and returns false without ever showing a dialog, so
          // this branch also covers a decline nobody made. Staying silent is
          // still right there — the transform simply did not happen, the
          // selection is untouched, and the gate already logged why — but the
          // reason is "there is nothing a toast could usefully say", not
          // "the user decided".
          return;
        }

        // What the model actually saw. Identity-equal to `selectedText` when
        // masking is off or nothing matched, so comparing the reply against
        // THIS rather than the selection is free in the common case and the
        // only correct comparison once a mask is in play.
        const sentText = gate.sentText;

        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("start-loading");
        }

        const result = await fixGrammar(sentText, preset.id, {
          activeAppName: activeApp?.name,
        });
        latency.mark("aiRequest");

        // ONE branch: a masking mode always returns a `SecretMasking`, and an
        // empty one restores cleanly.
        const restore =
          gate.restoreOnReply && gate.masking !== null
            ? restoreSecrets(result.correctedText, gate.masking)
            : ({ ok: true, text: result.correctedText } as const);

        if (!restore.ok) {
          logger.warn("secretGuard.mask", "Could not restore masked values into the reply", {
            presetId: preset.id,
            appliedMode: gate.appliedMode,
            reason: restore.reason,
            missingCount: restore.missingCount,
            placeholderCount: gate.masking?.placeholderCount ?? 0,
          });
          new Notification({
            title: mainT("notifications.secretGuard.restoreFailed.title"),
            body: mainT("notifications.secretGuard.restoreFailed.body"),
          }).show();
        }

        if (
          restore.ok &&
          result.correctedText === sentText &&
          preset.id === DEFAULT_CORRECTION_PRESET_ID
        ) {
          new Notification(buildCorrectionGoodJobNotification()).show();
        }

        // Settings offers the per-preset output mode on EVERY preset, not just
        // the `requiresInput` one, so resolve it here too — reading the global
        // store directly would leave that control visible, writable, persisted
        // and inert for all six polish presets.
        //
        // A failed restore then overrides that to the popup, carrying the
        // MASKED reply: a partial restore mixes real secrets and placeholders
        // indistinguishably, and the popup is copyable.
        const delivery = await deliverCorrectionOutput(
          resolveSecretGuardOutputMode(
            resolvePresetOutputMode(
              preset.outputMode,
              outputModeStore.getCorrectionOutputMode(),
            ),
            restore.ok,
          ),
          {
            presetName: preset.name,
            text: restore.ok ? restore.text : result.correctedText,
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
          appliedMode: gate.appliedMode,
          gateDecision: gate.gateDecision,
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
              // Both sides are what CROSSED the wire: masked when masking is
              // on, raw when it is off (`sentText` is the selection itself
              // then). The history DB is unencrypted under `userData` and the
              // snapshot viewer has copy buttons, so storing the restored text
              // here would recreate — durably — exactly the exposure masking
              // removed. Raw history after a Send anyway is correct: the
              // dialog said the real value would be included.
              original: sentText,
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
