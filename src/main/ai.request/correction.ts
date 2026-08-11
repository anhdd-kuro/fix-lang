import { resolveReasoningEffort } from "~/features/correction/shared/reasoningEffort";
import { serializeHistorySession } from "~/features/history/shared/historySession";
import { estimateTextTokens } from "~/features/history/store/historyStore";
import { parseModelRef } from "~/features/providers/shared/modelRef";
import {
  getDefaultModelId,
  getDefaultReasoningEffort,
  getProfileSetting,
  type CorrectionPreset,
  type ProviderId,
} from "~/features/providers/store/apiStore";
import {
  DEFAULT_PROMPT_OPTIMIZATION_PRESET_ID,
  DEFAULT_SUMMARIZE_PRESET_ID,
} from "~/prompts";
import { makeAIRequest } from "./shared";
import {
  appContextPolicyForPreset,
  withActiveAppContext,
} from "./transform-context";
import type { TransformContext } from "./transform-context";

type CorrectionResult = {
  correctedText: string;
  promptTokens: number;
  completionTokens: number;
  model: string;
  /**
   * Provider that served the request. Optional because a bare or absent model
   * ref names no provider, and reporting `undefined` beats inventing one.
   */
  provider?: ProviderId;
  /** Concrete model the provider served (resolves alias indirection) */
  resolvedModel: string;
  presetId: string;
  presetName: string;
  /** Raw completion session JSON for history transparency. */
  sessionJson?: string;
};

/**
 * A preset's pinned model, or the profile default when it inherits ("").
 * Exported so callers outside the request path (the connection prewarmer in
 * `~/main/llm/prewarm`) can resolve the same target a real `fixGrammar` call
 * would route to, without duplicating the inherit rule.
 */
export const effectiveModelRef = (preset: CorrectionPreset): string =>
  preset.model?.trim() || getDefaultModelId();

/**
 * The preset a `fixGrammar(text, presetId)` call will actually run.
 *
 * Exported so the Ask hotkey can state that preset's system prompt in the input
 * window's transparency row WITHOUT re-deriving it. The window promises to show
 * what will be sent, and the id-to-preset lookup (with its fall back to the
 * profile's selected preset, then to the first one) is precisely the step where
 * a second implementation would quietly show a different preset's prompt than
 * the request carries. Reading a preset captured at hotkey-registration time has
 * the same failure by another route: `fixGrammar` re-resolves at SUBMIT, so a
 * settings edit in between would leave the row quoting a prompt nobody sent.
 */
export const resolveCorrectionPreset = (presetId?: string): CorrectionPreset => {
  const correctionSettings = getProfileSetting("settingsCorrect");
  const selectedPreset = presetId
    ? correctionSettings.presets.find((preset) => preset.id === presetId)
    : correctionSettings.presets.find(
        (preset) => preset.id === correctionSettings.selectedPresetId,
      );

  return selectedPreset || correctionSettings.presets[0];
};

const buildCorrectionUserPrompt = (
  text: string,
  preset: CorrectionPreset,
): string => {
  if (preset.id !== DEFAULT_PROMPT_OPTIMIZATION_PRESET_ID) {
    if (preset.id !== DEFAULT_SUMMARIZE_PRESET_ID) {
      return `Input:\n${text}`;
    }

    return [
      "You are executing in a one-shot hotkey flow.",
      "Summarize the selected text immediately using the strategic compact guidance in the system prompt.",
      "Requirements:",
      "- Produce a strategically compact summary, not a rewrite.",
      "- Preserve the most important decisions, constraints, actions, and risks.",
      "- Remove filler, repetition, and incidental detail.",
      "- Do not add commentary, explanations, titles, markdown fences, or bullet labels unless the source structure makes them necessary.",
      "- Return only the summary text.",
      "Input:",
      text,
    ].join("\n");
  }

  return [
    "You are executing in a one-shot hotkey flow.",
    "Optimize the draft prompt below immediately.",
    "Requirements:",
    "- Treat the selected text as the rough prompt to improve.",
    "- If the draft already names a target AI tool, use it.",
    "- Preserve the draft's structural shape (sections, bullets, XML tags) unless restructuring is clearly needed for clarity.",
    "- When the draft targets an AI coding agent harness, preserve agent-native terms (skill, sub-agent, MCP, tool calls, etc.) — do not rewrite into a generic chat task.",
    "- Do not ask clarifying questions.",
    "- Do not output explanations, notes, meta commentary, or markdown fences.",
    "- Return only the final optimized prompt text, ready to paste.",
    "Draft prompt:",
    text,
  ].join("\n");
};

/**
 * Fixes grammar and style for the given text using OpenAI API.
 * @param text The text to fix.
 * @param presetId Preset to apply; defaults to the profile's selected preset.
 * @param context Best-effort source-app context; omit when the text did not
 *   come from another app.
 * @returns A promise that resolves with the fixed text and token information.
 */
export const fixGrammar = async (
  text: string,
  presetId?: string,
  context?: TransformContext,
): Promise<CorrectionResult> => {
  if (!text || !text.trim()) {
    // No desktop notification here: both call sites (the correction hotkey
    // in `keybindings/correction.ts` and the `fix-grammar` IPC handler in
    // `ipc/features/correction.ts`) already reject empty/whitespace-only
    // text before calling `fixGrammar`, each with its own user-facing
    // feedback (a localized "no text selected" notification, and an IPC
    // error result, respectively). This branch only guards `fixGrammar`
    // itself for any future/direct caller that skips that check, so a
    // second, redundant notification here would just be noise reiterating
    // an internal function name ("fixGrammar called with...") that means
    // nothing to a user. The log line is kept for that defensive case.
    console.log("fixGrammar called with empty or whitespace-only text.");

    const preset = resolveCorrectionPreset(presetId);

    // Reports `provider: undefined` for a bare or empty ref rather than
    // guessing: a wrong provider is silently written into history and priced.
    // `modelId` (raw), not `raw` (composite), to match `makeAIRequest`.
    const ref = parseModelRef(effectiveModelRef(preset));

    return {
      correctedText: text,
      promptTokens: 0,
      completionTokens: 0,
      model: ref.modelId,
      provider: ref.provider ?? undefined,
      resolvedModel: ref.modelId,
      presetId: preset.id,
      presetName: preset.name,
    };
  }

  const preset = resolveCorrectionPreset(presetId);
  // Empty preset model inherits the global default (dynamic latest GPT mini).
  const effectiveModel = effectiveModelRef(preset);

  try {
    const response = await makeAIRequest({
      // Source-app context goes on the system prompt, not the user prompt:
      // metadata beside the text to transform is easy to mistake for content.
      systemPrompt: withActiveAppContext(
        preset.systemPrompt,
        context,
        appContextPolicyForPreset(preset.id),
      ),
      userPrompt: buildCorrectionUserPrompt(text, preset),
      model: effectiveModel,
      reasoning: resolveReasoningEffort(preset.reasoning, getDefaultReasoningEffort()),
    });

    console.log(`Correction used preset: ${preset.name}`);

    const correctedText = response.content.join("\n\n");

    return {
      correctedText,
      promptTokens:
        response.promptTokens && response.promptTokens > 0
          ? response.promptTokens
          : estimateTextTokens(text),
      completionTokens:
        response.completionTokens && response.completionTokens > 0
          ? response.completionTokens
          : estimateTextTokens(correctedText),
      model: response.model,
      provider: response.provider,
      resolvedModel: response.resolvedModel ?? response.model,
      presetId: preset.id,
      presetName: preset.name,
      sessionJson: response.session
        ? serializeHistorySession(response.session)
        : undefined,
    };
  } catch (error) {
    console.error("Error in fixGrammar:", error);
    throw error;
  }
};
