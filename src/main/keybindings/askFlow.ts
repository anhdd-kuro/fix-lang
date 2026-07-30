/**
 * @file askFlow.ts
 * @description The Ask AI submit path: composes the question (+ optional
 * selection context) into a single message, appends a call-time app-locale
 * directive, sends it through the normal `fixGrammar` request, and delivers
 * the answer via `deliverCorrectionOutput` — reusing the exact same
 * spinner/history/cost plumbing as `correction.ts`'s own hotkey flow.
 *
 * Deliberately does NOT pass a `context` (source-app) argument to
 * `fixGrammar`: that third argument only exists to build an active-app system
 * prompt block for outbound-polish presets, and passing it here would make it
 * fight the Ask preset's own system prompt (see `ai.request/transform-context.ts`).
 * Leaving it out keeps that system prompt byte-identical to the preset's own
 * text, exactly like the fourth (non-context) call site.
 */
import { resolvePresetOutputMode } from "~/shared/presetOutputMode";
import { getLocale } from "~/stores/localeStore";
import { outputModeStore } from "~/stores/outputModeStore";
import { pasteText } from "../../utils";
import { fixGrammar } from "../ai.request";
import { composeAskMessage } from "./askMessage";
import { deliverCorrectionOutput } from "./correctionOutput";
import { handleError } from "./utils";
import { buildPriceMap, computeCost } from "../ai.request/cost";
import { getCachedModels, isLocalModelId } from "../ai.request/shared";
import { syncHistory } from "../ipc/features/history";
import { logger } from "../logging/logService";
import { hideOverlaySpinner, showOverlaySpinner } from "../webViewWindows";
import { showAskResultWindow } from "../webViewWindows/askResultWindow";
import type { BrowserWindow } from "electron";
import type { CorrectionPreset } from "~/stores/apiStore";

export type RunAskFlowParams = {
  preset: CorrectionPreset;
  /** The selection carried in as optional context; empty when nothing was selected. */
  context: string;
  /** The user's typed question from the Ask AI input window. */
  question: string;
  mainWindow: BrowserWindow | null;
};

/**
 * Builds the app-locale directive appended to the composed message at call
 * time. Kept out of the stored preset prompt (`src/prompts/ask.md`) on
 * purpose: baking it in would freeze it at whatever locale was active when
 * the prompt asset was written, instead of tracking the user's current
 * choice.
 */
const buildAppLocaleDirective = (): string => `App locale: ${getLocale()}`;

/**
 * Runs the Ask AI request once the input window reports a submitted
 * question. A no-op (silently returns) when `composeAskMessage` reports the
 * question was empty/whitespace-only — the input window itself is expected
 * to have already blocked that submission, so this is a defensive fallback,
 * not the primary guard.
 */
export const runAskFlow = async ({
  preset,
  context,
  question,
  mainWindow,
}: RunAskFlowParams): Promise<void> => {
  const composed = composeAskMessage({ question, context });
  if (composed === null) {
    return;
  }

  const message = `${composed}\n\n${buildAppLocaleDirective()}`;

  showOverlaySpinner();

  try {
    const result = await fixGrammar(message, preset.id);

    const delivery = await deliverAskResult({
      preset,
      question,
      input: context,
      result,
    });

    logger.info("correction.hotkey", "Ask completed", {
      presetId: preset.id,
      model: result.model,
      provider: result.provider ?? null,
      resolvedModel: result.resolvedModel ?? null,
      delivery,
    });

    if (mainWindow && !mainWindow.isDestroyed()) {
      recordAskHistory(message, result);
    }

    hideOverlaySpinner();
  } catch (error) {
    hideOverlaySpinner();
    logger.error("correction.hotkey", "Ask failed", {
      presetId: preset.id,
      error: error instanceof Error ? error.message : String(error),
    });
    handleError(error);
  }
};

type FixGrammarResult = Awaited<ReturnType<typeof fixGrammar>>;

type DeliverAskResultParams = {
  preset: CorrectionPreset;
  question: string;
  /** The selection carried in as optional context; shown in the result popup. */
  input: string;
  result: FixGrammarResult;
};

const deliverAskResult = async ({
  preset,
  question,
  input,
  result,
}: DeliverAskResultParams) => {
  return deliverCorrectionOutput(
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
      showPopup: (payload) =>
        showAskResultWindow({
          presetName: payload.presetName,
          question,
          answer: payload.text,
          markdown: preset.markdownOutput ?? false,
          input,
        }),
    },
  );
};

const recordAskHistory = (message: string, result: FixGrammarResult): void => {
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
      original: message,
      corrected: result.correctedText,
      promptTokens: result.promptTokens ?? 0,
      completionTokens: result.completionTokens ?? 0,
      timestamp: new Date().toISOString(),
      model: result.model,
      provider: result.provider,
      resolvedModel: result.resolvedModel,
      presetName: result.presetName,
      estimatedCostUsd: cost.estimatedCostUsd ?? undefined,
      pricePrompt: cost.pricePrompt ?? undefined,
      priceCompletion: cost.priceCompletion ?? undefined,
      costStatus: cost.status,
      // Undefined when the request produced no snapshot; round-trips to NULL.
      sessionJson: result.sessionJson,
    },
    type: "add",
    featureId: "corrections",
  });
};
