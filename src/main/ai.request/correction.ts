import {
  DEFAULT_PROMPT_OPTIMIZATION_PRESET_ID,
  DEFAULT_SUMMARIZE_PRESET_ID,
} from "~/prompts";
import { parseModelRef } from "~/shared/modelRef";
import {
  getDefaultModelId,
  getProfileSetting,
  type CorrectionPreset,
  type ProviderId,
} from "~/stores/apiStore";
import { estimateTextTokens } from "~/stores/historyStore";
import { makeAIRequest } from "./shared";

type CorrectionResult = {
  correctedText: string;
  promptTokens: number;
  completionTokens: number;
  model: string;
  /**
   * Provider that served (or would have served) the request.
   *
   * Optional: the empty-text early return never reaches a provider, and when
   * the effective model ref is bare or absent there is no provider to name.
   * Reporting `undefined` there is the point — the alternative is inventing
   * one, which is what the deleted `getActiveProvider()` did. Every consumer
   * (`historyTypes.HistoryEntry.provider`, the `fix-grammar` IPC result,
   * `computeCost`) already types this field optional.
   */
  provider?: ProviderId;
  /** Concrete model the provider served (resolves alias indirection) */
  resolvedModel: string;
  presetId: string;
  presetName: string;
};

/**
 * The model a preset will actually request: its own pinned value, or the
 * profile-wide default when it inherits (empty string sentinel).
 *
 * Shared by the request path and the empty-text early return so the two can
 * never disagree about which model the correction concerned.
 */
const effectiveModelRef = (preset: CorrectionPreset): string =>
  preset.model?.trim() || getDefaultModelId();

const getCorrectionPreset = (presetId?: string): CorrectionPreset => {
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
  model: string,
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
    `- The selected target model ID is: ${model}.`,
    "- If the model ID is provider-specific or not listed exactly, infer the closest supported model or tool family from the ID and optimize for that family.",
    "- If the draft already names a target AI tool, use it.",
    "- Otherwise, default to the selected target model above instead of assuming ChatGPT.",
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
 * @returns A promise that resolves with the fixed text and token information.
 */
export const fixGrammar = async (
  text: string,
  presetId?: string,
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

    const preset = getCorrectionPreset(presetId);

    // Report the model this correction *would* have used, decomposed from its
    // composite ref — never a hardcoded `DEFAULT_OPENAI_MODEL`, and never a
    // profile-wide "active provider" (there is no such thing any more).
    //
    // `parseModelRef` yields the inherit sentinel `{ provider: null,
    // modelId: "" }` for an empty ref, and `{ provider: null, modelId: <id> }`
    // for a bare, un-migrated id. Both cases report no provider rather than
    // guessing one: this branch has no model cache to resolve against, and a
    // wrong provider here is silently written into history and priced.
    //
    // `modelId` (raw), not `raw` (composite): `makeAIRequest` keeps `model`
    // and `resolvedModel` raw so history rows need no migration, and this
    // early return has to agree with it.
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

  const preset = getCorrectionPreset(presetId);
  // Empty preset model inherits the global default (dynamic latest GPT mini).
  const effectiveModel = effectiveModelRef(preset);

  try {
    const response = await makeAIRequest({
      systemPrompt: preset.systemPrompt,
      userPrompt: buildCorrectionUserPrompt(text, preset, effectiveModel),
      model: effectiveModel,
      temperature: preset.temperature,
      maxTokens: preset.maxTokens,
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
    };
  } catch (error) {
    console.error("Error in fixGrammar:", error);
    throw error;
  }
};
