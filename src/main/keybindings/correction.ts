import { app, globalShortcut, Notification } from "electron";
import { COMBO_CANCEL_ACCELERATOR } from "~/features/correction/shared/comboValidation";
import { resolvePresetOutputMode } from "~/features/correction/shared/presetOutputMode";
import { keybindingStore } from "~/features/correction/store/keybindingStore";
import { outputModeStore } from "~/features/correction/store/outputModeStore";
import {
  evaluateSelectionGuards,
  selectionGuardLogContext,
  type SelectionGuardConfirmVerdict,
  type SelectionGuardVerdict,
} from "~/features/guards/shared/selectionGuards";
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
  getAskContext,
  getHighlightedTextWithActiveApp,
  pasteText,
} from "../../utils";
import { fixGrammar } from "../ai.request";
import { buildAskDirectives, resolveAskEnvironment } from "./askEnvironment";
import { buildAppLocaleDirective, runAskFlow } from "./askFlow";
import { abortActiveCombo, withComboCancel } from "./comboCancel";
import {
  COMBO_TOTAL_BUDGET_MS,
  ComboCancelledError,
  ComboStepError,
  ComboValidationFailedError,
  runCombo,
  type ComboStepHistoryPayload,
  type RunComboDependencies,
} from "./comboFlow";
import { ComboLockBusyError, withComboLock } from "./comboLock";
import {
  buildComboCancelledNotification,
  buildComboInvalidNotification,
  buildComboLockBusyNotification,
  buildComboStepFailedNotification,
} from "./comboNotifications";
import { buildCorrectionGoodJobNotification } from "./correctionNotifications";
import { deliverCorrectionOutput } from "./correctionOutput";
import { runSecretGate } from "./secretGate";
import { checkShortcut, handleError, withHotkeyThrottle } from "./utils";
import { effectiveModelRef, resolveCorrectionPreset } from "../ai.request/correction";
import { buildPriceMap, computeCost } from "../ai.request/cost";
import { getCachedModels, isLocalModelId } from "../ai.request/shared";
import * as clipboardChangeTracker from "../clipboard/clipboardChangeTracker";
import { prewarmProviderConnection } from "../llm/prewarm";
import {
  startLatencyTimer,
  type LatencyOutcome,
  type LatencyTimer,
} from "../logging/latencyTimer";
import { logger } from "../logging/logService";
import { confirmSelectionGuard } from "../notifications/confirmSelectionGuard";
import { LocalizedError, showNotificationWithFallback } from "../notifications/error";
import {
  hideOverlaySpinner,
  showOverlaySpinner,
  updateComboProgress,
} from "../webViewWindows";
import { showAskInputWindow } from "../webViewWindows/askInputWindow";
import { showCorrectionResultWindow } from "../webViewWindows/correctionResultWindow";
import type { BrowserWindow } from "electron";
import type { ComboPreset, ComboStep } from "~/features/providers/store/apiStore";
import type { ComboProgressView } from "~/main/webViewWindows/comboProgressView";

/**
 * One decline outcome per confirm reason, so a latency line says which
 * dialog the user backed out of rather than collapsing three different
 * decisions into one number.
 */
const SELECTION_GUARD_DECLINE_OUTCOME = {
  "large-selection": "declined-size",
  "stale-clipboard": "declined-stale",
  "unknown-clipboard-age": "declined-unknown-age",
} as const satisfies Record<SelectionGuardConfirmVerdict["reason"], LatencyOutcome>;

/**
 * Applies a selection-guard verdict to Ask AI's optional context, returning
 * what may be attached — the text, or `""`.
 *
 * Ask DROPS rather than confirms, and that is the whole difference between
 * this and every other preset. A dialog stacked in front of the input window
 * would fight it for focus, and it would ask the wrong question: for a
 * transform the choice is send-or-nothing, while here the question can always
 * stand alone, so refusing the context still leaves a working press. Dropping
 * is also the only option that stays honest about the deny-list, which is not
 * overridable anywhere else and must not become overridable here.
 *
 * The user is told once, by notification, because a context that silently
 * fails to attach is indistinguishable from a hotkey that silently failed to
 * read anything — and that is the one thing the source label was added to
 * stop. Which guard fired goes to the log, not the notification.
 */
const resolveAskContextUnderGuards = (
  verdict: SelectionGuardVerdict,
  text: string,
  presetId: string,
): string => {
  if (verdict.kind === "allow") return text;

  logger.warn("correction.hotkey", "Ask context dropped by a selection guard", {
    presetId,
    // The Security dashboard counts `guardEvent`, not the message prose. A
    // dropped context is not a decline: the request went ahead without it.
    guardEvent: "context-dropped",
    guardReason: verdict.reason,
    ...(verdict.kind === "block"
      ? { deniedBundleId: verdict.bundleId }
      : selectionGuardLogContext(verdict)),
  });
  showNotificationWithFallback({
    title: mainT("notifications.askContextDropped.title"),
    body: mainT("notifications.askContextDropped.body"),
  });
  return "";
};

/**
 * `runCombo` throws this dedicated class (`comboFlow.ts`) at every abort
 * point — entry, between steps, mid-step, and the last-ditch check right
 * before `deliver` — rather than leaving `signal.throwIfAborted()`'s
 * `DOMException("AbortError")` to be recognized by `.name` string-sniffing.
 */
const isComboCancelledError = (error: unknown): boolean =>
  error instanceof ComboCancelledError;

/**
 * The abort check for the part of a combo run that happens OUTSIDE
 * `runCombo` — the selection read. Throws the same class `runCombo` throws
 * so one `catch` routes both to the same "Combo Cancelled" notification.
 */
const throwIfComboCancelled = (signal: AbortSignal): void => {
  if (signal.aborted) throw new ComboCancelledError();
};

/**
 * Display name for a failed step's preset (e.g. "Translate" in "Step 2 of 3
 * — Translate"). Re-reads the live profile rather than the t0 snapshot
 * `runCombo` already validated against — this is a display lookup for a
 * notification, not a correctness-sensitive resolve, so a benign miss just
 * falls back to the raw id instead of ever throwing a second error while
 * reporting the first.
 */
const presetNameForStep = (step: ComboStep): string =>
  getProfileSetting("settingsCorrect").presets.find(
    (preset) => preset.id === step.presetId,
  )?.name ?? step.presetId;

/**
 * Writes one history row per completed step (H1), carrying the same cost
 * snapshot glue the single-preset path uses (`buildPriceMap`/`computeCost`)
 * plus the two combo-grouping columns Card 06 added to `HistoryEntry`.
 */
const recordComboStepHistory = (payload: ComboStepHistoryPayload): void => {
  const { result } = payload;
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
      original: payload.originalText,
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
      comboRunId: payload.runId,
      comboStepIndex: payload.stepIndex,
    },
    type: "add",
    // Same bucket as every other preset output — distinguished by presetName,
    // exactly like the single-preset path (H2 of the design).
    featureId: "corrections",
  });
};

/**
 * Builds `runCombo`'s injected dependencies fresh per run — never a module
 * singleton — so `getCorrectionSettings` reads the LIVE profile at t0 (E5)
 * and `defaultOutputMode` reflects the current global setting rather than
 * whatever it was when hotkeys were last (re)registered.
 *
 * `onProgress` (Finding F1, board) is the step-boundary seam `runCombo`
 * exposes for exactly this: this is the ONLY caller that wires it to
 * `updateComboProgress` — `comboFlow.ts` never imports the overlay itself.
 */
const buildComboRunDependencies = (
  onProgress: (view: ComboProgressView) => void,
  latency: LatencyTimer,
): RunComboDependencies => ({
  getCorrectionSettings: () => getProfileSetting("settingsCorrect"),
  fixGrammar: (text, presetId, context) => fixGrammar(text, presetId, context),
  recordStepHistory: recordComboStepHistory,
  // `deliver` is the only seam that sits between "every step has run" and
  // "the user has the result", so it is where the AI/delivery split in the
  // latency breakdown is taken. `aiRequest` covers the whole chain here, not
  // one request — a combo's steps are what the user waits through.
  deliver: async (mode, payload) => {
    latency.mark("aiRequest");
    const delivery = await deliverCorrectionOutput(mode, payload, {
      paste: pasteText,
      showPopup: showCorrectionResultWindow,
    });
    latency.mark("delivery");
    return delivery;
  },
  onProgress,
  defaultOutputMode: outputModeStore.getCorrectionOutputMode(),
  buildAskLocaleDirective: buildAppLocaleDirective,
});

/**
 * Routes a failed/cancelled combo run to exactly one localized notification.
 * Never falls through to a generic message for the three cases the design
 * calls out by name (E4): a validation failure before any request ran, a
 * mid-chain step failure naming the step and its position, and a
 * user-initiated cancel. Anything else (a bug, not a modeled outcome) still
 * goes through `handleError` so it is never silently swallowed.
 */
const handleComboError = (error: unknown, combo: ComboPreset): void => {
  if (isComboCancelledError(error)) {
    logger.info("correction.hotkey", "Combo cancelled", { comboId: combo.id });
    new Notification(buildComboCancelledNotification(combo.name)).show();
    return;
  }

  if (error instanceof ComboValidationFailedError) {
    logger.warn("correction.hotkey", "Combo failed validation before any request ran", {
      comboId: combo.id,
      errors: error.errors.map((validationError) => validationError.code),
    });
    new Notification(buildComboInvalidNotification(combo.name)).show();
    return;
  }

  if (error instanceof ComboStepError) {
    logger.error("correction.hotkey", "Combo step failed", {
      comboId: combo.id,
      stepIndex: error.stepIndex,
      code: error.code,
      // Present only for `step-failed`, where the real reason (an API error,
      // an auth failure, a network drop) is the wrapped cause — the notification
      // deliberately shows only the step, so the diagnosis has to live here.
      // Spread rather than an `undefined` value: `LogValue` has no undefined.
      ...(error.cause === undefined
        ? {}
        : {
            cause:
              error.cause instanceof Error
                ? error.cause.message
                : String(error.cause),
          }),
    });
    new Notification(
      buildComboStepFailedNotification({
        stepPosition: error.stepIndex + 1,
        totalSteps: combo.steps.length,
        presetName: presetNameForStep(error.step),
      }),
    ).show();
    return;
  }

  logger.error("correction.hotkey", "Combo failed", {
    comboId: combo.id,
    error: error instanceof Error ? error.message : String(error),
  });
  handleError(error);
};

/**
 * `withComboLock` only frees its lock in a `finally` that runs once the
 * wrapped body's promise SETTLES — and `runComboFromHotkey` awaits
 * `getHighlightedTextWithActiveApp` and (via `deliver`) `pasteText`, both of
 * which reach `src/utils.ts`'s `exec()` calls. The combined selection read is
 * capped at `ACTIVE_APP_READ_TIMEOUT_MS`, but its own fallback
 * (`sendCopyKeystroke`) and `pasteText`'s keystroke have no timeout at all —
 * a wedged frontmost app can hang either one forever. When that happens the
 * body's promise never settles, `withComboLock`'s `finally` never runs, and
 * every later combo press is refused with a now-false "Another combo is
 * already running" until the app restarts. Fixing the `exec()` calls
 * themselves is `src/utils.ts`, outside this card's fence.
 *
 * The fix here does not touch the lock module — it bounds what the lock
 * AWAITS. `runComboFromHotkey`'s own AI-step budget is already capped by
 * `COMBO_TOTAL_BUDGET_MS` (`comboFlow.ts`), but that clock starts inside
 * `runCombo`, AFTER the selection read has already completed, so it does not
 * cover a hang in the read itself or in the final `deliver`/`pasteText` call
 * that happens after the loop. `COMBO_LOCK_MAX_HOLD_MS` adds a fixed grace on
 * top of the AI budget for those two phases — generous for their normal
 * (sub-few-second) cost, but still a hard ceiling — so the promise passed to
 * `withComboLock` always settles, and the lock always frees, even when the
 * real work never does.
 *
 * A legitimately slow combo (the full `COMBO_TOTAL_BUDGET_MS` of AI time)
 * still finishes comfortably inside this budget; only a run stuck
 * meaningfully past its own total budget trips the watchdog.
 */
export const COMBO_LOCK_MAX_HOLD_MS = COMBO_TOTAL_BUDGET_MS + 30_000;

/** Thrown by `withComboLockWatchdog` when the wrapped body outlives `COMBO_LOCK_MAX_HOLD_MS`. */
export class ComboLockWatchdogError extends Error {
  public constructor() {
    super("Combo handler exceeded the maximum lock hold time");
    this.name = "ComboLockWatchdogError";
  }
}

/**
 * Races `body` against a `COMBO_LOCK_MAX_HOLD_MS` timer. Whichever settles
 * first wins. If the timer wins, this function's own promise still rejects
 * (freeing whatever awaits it — in particular `withComboLock`'s `finally`),
 * even though `body`'s underlying work keeps running unobserved in the
 * background.
 *
 * That background work is NOT always a hung `exec()` — a slow-but-not-wedged
 * selection read plus a chain that legitimately uses close to its own
 * `COMBO_TOTAL_BUDGET_MS` can push the whole handler past this ceiling while
 * `runCombo` is still very much alive, mid-chain, inside `withComboCancel`.
 * Left alone, that run finishes on its own schedule and calls
 * `deliver` → `pasteText` AFTER the user was already told (via the rejection
 * below) that it failed. `abortActiveCombo()` closes that gap: it reaches
 * into `withComboCancel`'s live `AbortController` for exactly this run (the
 * lock guarantees at most one is active) and aborts it BEFORE this function
 * rejects, so `runCombo`'s own pre-`deliver` `throwIfCancelled` — and, mid-
 * step, `raceWithTimeout`'s abort listener — turn the abandoned run into a
 * `ComboCancelledError` instead of a late paste. It also frees `activeCombo`
 * for the very next press admitted once the lock below releases, instead of
 * leaving this dead run's abort wired up as the module's only one.
 *
 * A truly wedged `exec()` (see `src/utils.ts`) is unaffected by the abort —
 * only `src/utils.ts` could kill that — but it was never going to reach
 * `deliver` anyway; the paste-after-failure risk this closes is specifically
 * the alive-but-slow case.
 *
 * `abortActiveCombo()` above only reaches a run that has already entered
 * `withComboCancel` (Finding F2, board). A run still stuck in the selection
 * read that PRECEDES it — `getHighlightedTextWithActiveApp`'s own
 * `sendCopyKeystroke` fallback, the exact unbounded `exec()` this whole
 * watchdog exists for — has no `activeCombo` entry yet, so that call is a
 * no-op: the lock frees, a second press starts and runs to completion, and
 * if the wedged frontmost app THEN un-wedges, the first run resumes, enters
 * `withComboCancel`, and races the second run to `deliver` — both paste.
 * `body` is therefore handed its OWN `AbortSignal`, separate from
 * `withComboCancel`'s internal one, created here and aborted in the SAME
 * tick as the `abortActiveCombo()` call above. `runComboFromHotkey` checks
 * it once the selection read resolves — the earliest point after a phase
 * `exec()` cannot itself be cancelled — and refuses to proceed into
 * `withComboCancel`/`runCombo`/`deliver` at all once it is set, so an
 * abandoned run recognizes its own abandonment instead of resuming into a
 * second concurrent chain.
 */
const withComboLockWatchdog = <T>(
  body: (signal: AbortSignal) => Promise<T>,
): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      abortActiveCombo();
      controller.abort();
      reject(new ComboLockWatchdogError());
    }, COMBO_LOCK_MAX_HOLD_MS);

    body(controller.signal).then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });

/**
 * The whole combo hotkey handler body, run inside `withComboLock` (R2 —
 * the lock wraps the selection read and the spinner too, not just
 * `runCombo`, because by the time a lock only around `runCombo` would
 * refuse a second press, that press has already read the selection and
 * shown its own spinner). Delivers the final text exactly once, at the
 * combo-level output mode `runCombo` itself resolves (E2) — this function
 * never calls `deliverCorrectionOutput`/`pasteText` directly.
 */
const runComboFromHotkey = async (
  combo: ComboPreset,
  mainWindow: BrowserWindow,
  watchdogSignal: AbortSignal,
  latency: LatencyTimer,
): Promise<void> => {
  logger.info("correction.hotkey", "Combo hotkey triggered", {
    comboId: combo.id,
    comboName: combo.name,
  });

  // Finding F1 (board) — `runCombo` only ever reports "running"/"failed"
  // (it has no visibility into the abort that produces "cancelling", which
  // happens outside its loop, in `withComboCancel`'s `onCancelling` below).
  // This remembers the latest view `onProgress` delivered so `onCancelling`
  // can replay it with `state: "cancelling"` instead of painting a ring it
  // cannot itself describe. Seeded before step 1 fires so a cancel pressed
  // in that narrow window still shows step 1, not a blank ring.
  let latestProgress: ComboProgressView = {
    total: combo.steps.length,
    completed: 0,
    current: 1,
    state: "running",
  };

  /**
   * True once this run's own lock watchdog has given up on it — at which point
   * the user has ALREADY been told the combo failed, and the lock has already
   * admitted whatever press came next.
   *
   * Called at every point where this handler resumes after an await it cannot
   * itself interrupt. The selection read is one (Finding F2); the two guard
   * dialogs below are the others, and they are the only awaits in this handler
   * paced by a HUMAN rather than by a machine — so they are the ones most
   * likely to outlive `COMBO_LOCK_MAX_HOLD_MS`. Without a check there, an
   * abandoned run resumes on the user's click and walks on: it re-shows the
   * spinner, opens a SECOND confirmation dialog for a request already reported
   * as failed, and sends `start-loading` — all after the failure notification,
   * and only stopped at `runCombo`'s own entry check.
   *
   * The `finish` here is a no-op whenever the watchdog's own handler already
   * reported (first-finish-wins), exactly as the pre-existing check is.
   */
  const abandonedByLockWatchdog = (): boolean => {
    if (!watchdogSignal.aborted) return false;

    hideOverlaySpinner();
    logger.warn(
      "correction.hotkey",
      "Combo handler resumed after the lock watchdog already abandoned it; skipping delivery",
      { comboId: combo.id },
    );
    latency.finish({ outcome: "failed", reason: "watchdog-abandoned" });
    return true;
  };

  try {
    // The cancel scope opens HERE, not around `runCombo` alone. `withComboCancel`
    // is what publishes this run to `abortActiveCombo()`, and the selection read
    // below is an await like any other: a profile switch during it used to find
    // no active combo, no-op, and let the read complete — after which every step
    // resolved its `presetId` against the NEW profile, sending a selection
    // captured under profile A to profile B's provider and key. Opening the scope
    // first means that switch aborts the run at the `throwIfComboCancelled` check
    // right after the read, before any request is made. The `exec()` inside the
    // read still cannot be interrupted mid-flight; the abort is observed the
    // moment it returns.
    await withComboCancel(
      async (signal) => {
        // Same combined read as the single-preset path, for the same reason: the
        // frontmost-app read has to happen before any FixLang window becomes
        // visible, or it reports FixLang instead of the real source app.
        // Environment is resolved in parallel so combo steps share the same
        // user-metadata block the single-preset path injects.
        const environmentPromise = resolveAskEnvironment({
          systemLocale: app.getSystemLocale(),
        });
        const { text: selectedText, activeApp, changed } = await getHighlightedTextWithActiveApp(
          () => {
            latency.mark("keystrokeSent");
            showOverlaySpinner();
          },
        );
        latency.mark("selectionPoll");

        // Finding F2 (board, first branch) — the earliest point this handler can
        // check its own abandonment: the combined read's `exec()` cannot be
        // aborted mid-flight, so this only ever observes a PAST watchdog trip,
        // never causes one. A stuck-then-unwedged run stops here instead of
        // proceeding into `runCombo`, where it would otherwise race whatever
        // later run the freed lock already admitted, straight to `deliver`.
        if (abandonedByLockWatchdog()) return;

        // The profile-switch abort this scope exists for. Reached whenever
        // `abortActiveCombo()` fired while the selection read was still in
        // flight; throwing here routes it to the same "Combo Cancelled"
        // notification a Ctrl+Esc press produces, before any request runs.
        throwIfComboCancelled(signal);

        if (!selectedText || !selectedText.trim()) {
          hideOverlaySpinner();
          logger.warn("correction.hotkey", "No text selected or clipboard is empty", {
            comboId: combo.id,
          });
          latency.finish({ outcome: "no-selection" });
          handleError(
            new LocalizedError(
              "No text selected or clipboard is empty.",
              "notifications.error.noTextSelected.body",
            ),
          );
          return;
        }

        // The same guard block, in the same order, as the ordinary preset
        // branch below — a combo is not a lesser send site but a worse one, so
        // it must not be the cheap way around the rails: it hands the same
        // selection to N models in sequence. Read fresh on every press for the
        // same reason as there, and placed AFTER the empty-selection abort so
        // "nothing selected" keeps its own, more basic message.
        const verdict = evaluateSelectionGuards({
          text: selectedText,
          changed,
          activeApp,
          age: clipboardChangeTracker.clipboardAge(),
          settings: guardStore.getSelectionGuardSettings(),
        });

        if (verdict.kind === "block") {
          hideOverlaySpinner();
          latency.finish({ outcome: verdict.reason });
          logger.warn("correction.hotkey", "Combo blocked by a selection guard", {
            comboId: combo.id,
            guardEvent: "blocked",
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
          latency.pause();
          const proceed = await confirmSelectionGuard(verdict);
          latency.resume();

          if (!proceed) {
            latency.finish({ outcome: SELECTION_GUARD_DECLINE_OUTCOME[verdict.reason] });
            logger.info("correction.hotkey", "Combo declined at a selection-guard confirm", {
              comboId: combo.id,
              guardEvent: "declined",
              guardReason: verdict.reason,
              ...selectionGuardLogContext(verdict),
            });
            // NO error notification — Cancel is a choice, not an error.
            return;
          }

          // The dialog above is paced by the user, so it is the likeliest await
          // in this handler to outlive the lock watchdog.
          if (abandonedByLockWatchdog()) return;

          showOverlaySpinner();
        }

        // `site: "combo"` is a real entry in `SECRET_SEND_SITE_POLICY`, not
        // `correction` borrowed: a combo delivers the LAST step's output, so a
        // mask taken here would have to survive every step in between and could
        // land a restored credential in a derived artifact. That decision lives
        // in the one table (see its file header) and is never re-derived here.
        const gate = await runSecretGate({
          site: "combo",
          text: selectedText,
          settings: secretGuardStore.getSecretGuardSettings(),
          aroundDialog: async (showDialog) => {
            hideOverlaySpinner();
            latency.pause();
            const answer = await showDialog();
            latency.resume();
            showOverlaySpinner();
            return answer;
          },
        });

        if (gate.gateDecision === "declined") {
          hideOverlaySpinner();
          latency.finish({ outcome: "secret-declined" });
          logger.info("correction.hotkey", "Combo declined at the secret guard", {
            comboId: combo.id,
            appliedMode: gate.appliedMode,
          });
          // NO error notification, same as the large-selection Cancel.
          return;
        }

        // Same reason as after the size confirm: the gate may have opened its
        // own dialog and waited on a person.
        if (abandonedByLockWatchdog()) return;

        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("start-loading");
        }

        const userMetadata = buildAskDirectives(await environmentPromise);
        const result = await runCombo(
          { combo, input: gate.sentText, activeAppName: activeApp?.name, userMetadata, signal },
          buildComboRunDependencies(
            (view) => {
              latestProgress = view;
              updateComboProgress(view);
            },
            latency,
          ),
        );

        logger.info("correction.hotkey", "Combo completed", {
          comboId: combo.id,
          steps: result.completed.length,
          delivery: result.delivery,
        });
        latency.finish({ outcome: "delivered", delivery: result.delivery });

        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("stop-loading");
        } else {
          logger.warn(
            "correction.hotkey",
            "Cannot send IPC message: mainWindow is null or destroyed",
          );
        }

        hideOverlaySpinner();
      },
      () => {
        logger.info("correction.hotkey", "Combo cancelling", { comboId: combo.id });
        updateComboProgress({ ...latestProgress, state: "cancelling" });
      },
    );
  } catch (error) {
    hideOverlaySpinner();
    // First-`finish`-wins, so this never relabels a run that already reported
    // `delivered` and then threw on the way out.
    latency.finish({
      outcome: "failed",
      reason: isComboCancelledError(error) ? "cancelled" : "error",
    });

    // Finding F3 (board, minor) — `watchdogSignal.aborted` can only be true
    // here because THIS run's own watchdog timer already fired (each run
    // gets a fresh signal; see `withComboLockWatchdog`), and that same timer
    // callback calls `abortActiveCombo()` — the only thing that can turn a
    // still-alive run's next cancellation check into `ComboCancelledError` —
    // strictly before it ever rejects with `ComboLockWatchdogError`. So
    // whenever both are true, the watchdog's OWN catch branch in
    // `registerCorrectionShortcut` is guaranteed to show a notification for
    // this exact trip already (there or on the way); showing "Combo
    // Cancelled" here too would be a second banner for one event — and the
    // wrong one, since it reads as a cancel the user never pressed.
    if (watchdogSignal.aborted && isComboCancelledError(error)) {
      logger.info(
        "correction.hotkey",
        "Combo cancelled by the lock watchdog; notification already shown by the watchdog's own handler",
        { comboId: combo.id },
      );
      return;
    }

    handleComboError(error, combo);
  }
};

export const registerCorrectionShortcut = (mainWindow: BrowserWindow) => {
  const correctionSettings = getProfileSetting("settingsCorrect");
  const registeredShortcuts = new Set<string>();
  const { promptGen, profileSwitch } =
    keybindingStore.getKeyBindings();
  // The combo cancel accelerator is the migration path, not redundancy with the
  // pre-save gate: that gate never re-runs on an already-stored profile, so a
  // preset saved before the chord was reserved would register here and win the
  // race against the combo run's own registration, leaving the run
  // uncancellable with no error anywhere.
  const reservedShortcuts = new Set([
    promptGen,
    profileSwitch,
    COMBO_CANCEL_ACCELERATOR,
  ]);

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

        // ONCE PER PRESS for every preset, not just Ask. The same rendered
        // string is what Autocomplete and `fixGrammar` inject into the system
        // prompt (`withUserMetadata`) and what Ask appends to the submitted
        // message / shows in the transparency row. Resolving it again
        // downstream would let those surfaces drift. Started HERE so it
        // overlaps the selection read on both branches — a `defaults` spawn
        // bounded by `INPUT_SOURCE_TIMEOUT_MS` must not sit in front of the
        // input window or the overlay spinner.
        const environmentPromise = resolveAskEnvironment({
          systemLocale: app.getSystemLocale(),
        });

        // Ask AI inverts the outbound-polish presets below: an empty
        // selection is the normal case (the question can stand alone), so it
        // must never hit the "no text selected" abort. The window itself
        // owns the request from here — asking the user for a question, then
        // handing the answer off to `runAskFlow`.
        //
        // Same clipboard contract as every other preset, including the
        // fallback: where the text came from travels with it, so the input
        // window can label a clipboard-sourced context instead of passing it
        // off as the user's selection (see `~/utils.ts`).
        //
        // Ask AI still never puts a source app in its PROMPT (see askFlow.ts's
        // own doc comment). It does now READ one: `getAskContext` goes through
        // the combined reader so the frontmost app comes back with the text,
        // because the deny-list is a rule about where text may be read FROM,
        // and a rule covering every preset except the one with a free-text box
        // would be a rule with a hole in the shape of its own purpose. It costs
        // one extra AppleScript statement in a script this press already runs,
        // not an extra spawn.
        if (preset.requiresInput) {
          const {
            text: askText,
            source: contextSource,
            activeApp: askActiveApp,
            changed: askChanged,
          } = await getAskContext();
          latency.mark("selectionRead");

          // Ask reaches the same guards as every other preset, and reaches
          // them HERE — before the window opens — rather than at submit.
          // The window is a consent surface for what it displays, not a
          // substitute for the rules the user configured: a denied app, a
          // clipboard of unknown age and a whole selected document are all
          // things they asked to be stopped on, and none of them is answered
          // by a label. Attaching nothing is a supported state for this
          // preset, so a refusal here drops the CONTEXT and still opens the
          // window — the question can stand alone, and killing the press
          // outright would make the guard read as a broken hotkey.
          //
          // Between the two awaits on purpose: it is synchronous, so it costs
          // the overlap above nothing, and putting it after the environment
          // await would leave a dropped context resolved a second later than
          // it needs to be.
          const askVerdict = evaluateSelectionGuards({
            text: askText,
            changed: askChanged,
            activeApp: askActiveApp,
            age: clipboardChangeTracker.clipboardAge(),
            settings: guardStore.getSelectionGuardSettings(),
          });
          const context = resolveAskContextUnderGuards(askVerdict, askText, preset.id);

          // The two reads above overlap, so this phase is what was LEFT of the
          // environment read once the context read returned — ~0 whenever the
          // clipboard poll was the slower half, which is the point of starting
          // it first. It is still its own phase because the alternative is the
          // `defaults` timeout landing in `totalMs` under no phase at all.
          const askEnvironment = await environmentPromise;
          latency.mark("environmentRead");
          const contextDirectives = buildAskDirectives(askEnvironment);
          // Re-resolved rather than read off the `preset` captured at hotkey
          // registration: `fixGrammar` looks the preset up again at SUBMIT, and
          // the row promises to show what will actually be sent.
          const systemPrompt = resolveCorrectionPreset(preset.id).systemPrompt;
          // The one line that says whether the selection made it, and which
          // source it came from. Without it, "the user selected nothing" and
          // "the copy produced nothing so this is their clipboard" both look
          // like the same input window. Lengths only — the text itself never
          // goes in a log, and neither does a directive line: those name the
          // user's own presets and state the minute they pressed the hotkey.
          logger.debug("correction.hotkey", "Ask context resolved", {
            presetId: preset.id,
            contextLength: context.length,
            contextAttached: context.length > 0,
            contextSource,
            directivesLength: contextDirectives.length,
            recentTransformCount: askEnvironment.recentTransforms.length,
            keyboardInputSourceRead: askEnvironment.keyboardInputSource !== null,
          });
          showAskInputWindow(
            {
              presetId: preset.id,
              context,
              contextSource,
              systemPrompt,
              contextDirectives,
            },
            {
              onSubmit: (question) => {
                void runAskFlow({
                  preset,
                  context,
                  question,
                  directives: contextDirectives,
                  mainWindow,
                });
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
          age: clipboardChangeTracker.clipboardAge(),
          settings: guardStore.getSelectionGuardSettings(),
        });

        if (verdict.kind === "block") {
          hideOverlaySpinner();
          // `verdict.reason` doubles as the `LatencyOutcome` member, so no
          // separate mapping table between guard reasons and log outcomes.
          latency.finish({ outcome: verdict.reason });
          logger.warn("correction.hotkey", "Transform blocked by a selection guard", {
            presetId: preset.id,
            guardEvent: "blocked",
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
          latency.pause();
          const proceed = await confirmSelectionGuard(verdict);
          latency.resume();

          if (!proceed) {
            latency.finish({ outcome: SELECTION_GUARD_DECLINE_OUTCOME[verdict.reason] });
            logger.info("correction.hotkey", "Transform declined at a selection-guard confirm", {
              presetId: preset.id,
              guardEvent: "declined",
              guardReason: verdict.reason,
              ...selectionGuardLogContext(verdict),
            });
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

        const userMetadata = buildAskDirectives(await environmentPromise);
        const result = await fixGrammar(sentText, preset.id, {
          activeAppName: activeApp?.name,
          userMetadata,
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
          // Not a bare `new Notification` — this warning is the ONLY thing
          // explaining a popup full of placeholders, and an unsigned build
          // fails notification delivery on the async `failed` event.
          showNotificationWithFallback({
            title: mainT("notifications.secretGuard.restoreFailed.title"),
            body: mainT("notifications.secretGuard.restoreFailed.body"),
            urgency: "critical",
          });
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

  // Same pass, same dedup set, same reserved skip (E1) — a combo on a chord
  // a preset already took (or on `promptGen`/`profileSwitch`/the reserved
  // combo-cancel chord) is skipped with a warn exactly like a preset would
  // be, not through a second, independently-maintained copy of this logic.
  (correctionSettings.combos ?? []).forEach((combo) => {
    const shortcut = combo.hotkey?.trim();

    if (!shortcut) {
      return;
    }

    if (registeredShortcuts.has(shortcut)) {
      logger.warn("correction.register", "Skipping duplicate correction shortcut", {
        comboId: combo.id,
      });
      return;
    }

    if (reservedShortcuts.has(shortcut)) {
      logger.warn("correction.register", "Skipping conflicting correction shortcut", {
        comboId: combo.id,
      });
      return;
    }

    registeredShortcuts.add(shortcut);

    const registered = globalShortcut.register(
      shortcut,
      withHotkeyThrottle(shortcut, async () => {
        // Started at the press boundary, not inside the handler, so the lock-busy
        // and watchdog exits below are measured too. A press swallowed by
        // `withHotkeyThrottle` never gets here and so never starts a timer —
        // same contract as the single-preset path.
        const latency = startLatencyTimer({
          scope: "correction.latency",
          message: "Combo latency",
          context: { comboId: combo.id },
        });

        try {
          await withComboLock(() =>
            withComboLockWatchdog((signal) =>
              runComboFromHotkey(combo, mainWindow, signal, latency),
            ),
          );
        } catch (error) {
          if (error instanceof ComboLockBusyError) {
            logger.warn(
              "correction.hotkey",
              "Refused a second combo press while one is already running",
              { comboId: combo.id },
            );
            latency.finish({ outcome: "failed", reason: "lock-busy" });
            new Notification(buildComboLockBusyNotification()).show();
            return;
          }
          if (error instanceof ComboLockWatchdogError) {
            // The lock is already free by the time we get here — the
            // `finally` in `withComboLock` ran as soon as this promise
            // rejected. Logged loudly: this only fires when something inside
            // the handler is genuinely stuck (see the watchdog's own doc
            // comment), which is worth knowing about even though the user
            // just sees the generic failure notification below.
            logger.error(
              "correction.hotkey",
              "Combo handler exceeded max lock hold time; lock released",
              { comboId: combo.id, maxHoldMs: COMBO_LOCK_MAX_HOLD_MS },
            );
            latency.finish({ outcome: "failed", reason: "lock-watchdog" });
            handleError(error);
            return;
          }
          // Unreachable in practice: `runComboFromHotkey` catches everything
          // else itself. Kept as a fallback so a future change to that
          // function cannot silently swallow an error here instead — and the
          // timer is finished here too, so even that path cannot leave a press
          // unmeasured. First-`finish`-wins makes this a no-op on every path
          // that already reported.
          latency.finish({ outcome: "failed", reason: "unhandled" });
          handleError(error);
        }
      }),
    );

    checkShortcut(registered);
  });
};
