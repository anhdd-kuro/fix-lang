import { globalShortcut, screen } from "electron";
import { keybindingStore } from "~/features/correction/store/keybindingStore";
import {
  evaluateSelectionGuards,
  selectionGuardLogContext,
} from "~/features/guards/shared/selectionGuards";
import { guardStore } from "~/features/guards/store/guardStore";
import { syncHistory } from "~/features/history/main/history";
import { secretGuardStore } from "~/features/secretGuard/store/secretGuardStore";
import { getHighlightedTextWithActiveApp } from "../../utils";
import { generatePrompt } from "../ai.request";
import { runSecretGate } from "./secretGate";
import { checkShortcut, handleError, withHotkeyThrottle } from "./utils";
import * as clipboardChangeTracker from "../clipboard/clipboardChangeTracker";
import { logger } from "../logging/logService";
import { confirmSelectionGuard } from "../notifications/confirmSelectionGuard";
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
      // One osascript invocation reads the frontmost app and THEN sends the
      // Cmd-C keystroke (see getHighlightedTextWithActiveApp), replacing the
      // former getActiveApp() + getHighlightedText() pair. The callback fires
      // right after that script returns — before the clipboard-change poll —
      // which is the earliest point it is still safe to show the overlay
      // spinner: the frontmost-app read must precede any FixLang window
      // becoming visible, since afterwards it would report FixLang and
      // yield null.
      const { text: selectedText, activeApp, changed } = await getHighlightedTextWithActiveApp(
        () => {
          showOverlaySpinner();
        },
      );

      if (!selectedText || !selectedText.trim()) {
        // Safe even though the spinner may not have been shown yet (e.g. the
        // combined read threw before the callback fired): hiding an overlay
        // that was never shown is a no-op.
        hideOverlaySpinner();
        handleError(
          new LocalizedError("No text selected.", "notifications.error.noTextSelected.body"),
        );
        return;
      }

      // Read fresh on every press, not once at registerPromptGenShortcut
      // time: a settings change must take effect on the very next hotkey
      // press, not only after the next hotkey reload.
      //
      // This check runs on the resolved read result rather than inside
      // getHighlightedTextWithActiveApp's own onFrontmostReadAndKeystrokeSent
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
        age: clipboardChangeTracker.clipboardAge(),
        settings: guardStore.getSelectionGuardSettings(),
      });

      if (verdict.kind === "block") {
        hideOverlaySpinner();
        logger.warn("promptGen.hotkey", "PromptGen blocked by a selection guard", {
          guardReason: verdict.reason,
          deniedBundleId: verdict.bundleId,
        });
        handleError(
          new LocalizedError(
            "Selection blocked: the frontmost app is on the deny-list.",
            "notifications.error.appNotAllowed.body",
            { app: activeApp?.name ?? verdict.bundleId },
          ),
        );
        return;
      }

      if (verdict.kind === "confirm") {
        hideOverlaySpinner();
        const proceed = await confirmSelectionGuard(verdict);

        if (!proceed) {
          logger.info("promptGen.hotkey", "PromptGen declined at a selection-guard confirm", {
            guardReason: verdict.reason,
            ...selectionGuardLogContext(verdict),
          });
          // NO error notification — the user clicked Cancel, which is not an
          // error. A toast here would train people to dismiss toasts.
          return;
        }

        showOverlaySpinner();
      }

      // Read fresh on every press, same reason as the selection guards above.
      // `runSecretGate` is the ONLY entry point: `SECRET_SEND_SITE_POLICY` is
      // what makes promptGen's mask a mask-NO-restore, and re-deriving that
      // here is exactly what the one table exists to prevent.
      const gate = await runSecretGate({
        site: "promptGen",
        text: selectedText,
        settings: secretGuardStore.getSecretGuardSettings(),
        // Wraps ONLY the modal, so the spinner does not blink on every press
        // in confirm mode where nothing is detected and no dialog opens.
        aroundDialog: async (showDialog) => {
          hideOverlaySpinner();
          const answer = await showDialog();
          showOverlaySpinner();
          return answer;
        },
      });

      if (gate.gateDecision === "declined") {
        hideOverlaySpinner();
        logger.info("promptGen.hotkey", "PromptGen declined at the secret guard", {
          appliedMode: gate.appliedMode,
        });
        // NO error notification, same as the large-selection Cancel.
        return;
      }

      // `gate.masking` is deliberately ignored: promptGen's output is a
      // generated prompt, not a rewrite, and it never pastes — a prompt
      // carrying placeholders is the correct artifact, so nothing is restored.
      const sentText = gate.sentText;

      const { x, y } = screen.getCursorScreenPoint();

      const result = await generatePrompt({
        text: sentText,
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
          // What CROSSED the wire: masked when masking is on, raw when it is
          // off (`sentText` is the selection itself then). The history DB is
          // unencrypted under `userData` and the snapshot viewer has copy
          // buttons.
          original: sentText,
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
