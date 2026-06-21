import { Notification } from "electron";
import { DEFAULT_OPENAI_MODEL } from "~/const";
import {
  DEFAULT_PROMPT_OPTIMIZATION_PRESET_ID,
  DEFAULT_SUMMARIZE_PRESET_ID,
} from "~/prompts";
import { getProfileSetting } from "~/stores/apiStore";
import { makeAIRequest } from "./shared";
import type { CorrectionPreset } from "~/stores/apiStore";

type CorrectionResult = {
  correctedText: string;
  promptTokens: number;
  completionTokens: number;
  model: string;
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
    `- The selected target model ID is: ${preset.model}.`,
    "- Use the model-specific guidance from the system prompt for that model when available.",
    "- If the model ID is provider-specific or not listed exactly, infer the closest supported model or tool family from the ID and optimize for that family.",
    "- If the draft already names a target AI tool, use it.",
    "- Otherwise, default to the selected target model above instead of assuming ChatGPT.",
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
    console.log("fixGrammar called with empty or whitespace-only text.");
    new Notification({
      title: "Empty Input",
      body: "fixGrammar called with empty or whitespace-only text.",
    }).show();

    const preset = getCorrectionPreset(presetId);

    return {
      correctedText: text,
      promptTokens: 0,
      completionTokens: 0,
      model: DEFAULT_OPENAI_MODEL,
      presetId: preset.id,
      presetName: preset.name,
    };
  }

  const preset = getCorrectionPreset(presetId);

  try {
    const response = await makeAIRequest({
      systemPrompt: preset.systemPrompt,
      userPrompt: buildCorrectionUserPrompt(text, preset),
      model: preset.model,
      temperature: preset.temperature,
      maxTokens: preset.maxTokens,
    });

    console.log(`Correction used preset: ${preset.name}`);

    return {
      correctedText: response.content.join("\n\n"),
      promptTokens: response.promptTokens ?? 0,
      completionTokens: response.completionTokens ?? 0,
      model: response.model,
      presetId: preset.id,
      presetName: preset.name,
    };
  } catch (error) {
    console.error("Error in fixGrammar:", error);
    throw error;
  }
};
