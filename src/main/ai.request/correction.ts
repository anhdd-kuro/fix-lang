import { DEFAULT_OPENAI_MODEL } from "~/const";
import {
  DEFAULT_PROMPT_OPTIMIZATION_PRESET_ID,
  DEFAULT_SUMMARIZE_PRESET_ID,
} from "~/prompts";
import {
  getDefaultModelId,
  getProfileSetting,
  type CorrectionPreset,
  type ProviderId,
} from "~/stores/apiStore";
import { estimateTextTokens } from "~/stores/historyStore";
import { getActiveProvider, makeAIRequest } from "./shared";
import { withActiveAppContext } from "./transform-context";
import type { TransformContext } from "./transform-context";

type CorrectionResult = {
  correctedText: string;
  promptTokens: number;
  completionTokens: number;
  model: string;
  provider: ProviderId;
  /** Concrete model the provider served (resolves alias indirection) */
  resolvedModel: string;
  presetId: string;
  presetName: string;
};

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
 * @param presetId Preset to apply; defaults to the profile's selected preset.
 * @param context Best-effort ambient context (source app) appended to the
 *   preset's system prompt. Omit it — as the manual `fix-grammar` IPC path
 *   does — when the text did not come from another app.
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

    const preset = getCorrectionPreset(presetId);

    return {
      correctedText: text,
      promptTokens: 0,
      completionTokens: 0,
      model: DEFAULT_OPENAI_MODEL,
      provider: getActiveProvider(),
      resolvedModel: DEFAULT_OPENAI_MODEL,
      presetId: preset.id,
      presetName: preset.name,
    };
  }

  const preset = getCorrectionPreset(presetId);
  // Empty preset model inherits the global default (dynamic latest GPT mini).
  const effectiveModel = preset.model?.trim() || getDefaultModelId();

  try {
    const response = await makeAIRequest({
      // Source-app context rides on the system prompt, alongside the preset's
      // own instructions, rather than on the user prompt — the user prompt
      // carries the text to transform, and metadata there is easy for a model
      // to mistake for content.
      systemPrompt: withActiveAppContext(preset.systemPrompt, context),
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
