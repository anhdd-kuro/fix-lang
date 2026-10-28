/**
 * @file aiSdkCallSettings.ts
 * @description The optional `generateText` settings every AI SDK provider path
 * forwards from `AIRequestOptions`. Each key is present only when the request
 * carries a value for it, so an absent setting leaves the provider default in
 * charge rather than sending an explicit `undefined`.
 */
import {
  reasoningForAiSdk,
  type ReasoningEffortStep,
} from "~/features/correction/shared/reasoningEffort";
import type { AIRequestOptions } from "~/main/ai.request/requestTypes";

export type AiSdkSystemOption = { system?: string };

export type AiSdkCallSettings = {
  reasoning?: ReasoningEffortStep | "none";
  stopSequences?: string[];
  abortSignal?: AbortSignal;
  maxOutputTokens?: number;
};

/** `system` only for a non-empty system prompt. */
export const aiSdkSystemOption = (systemPrompt: string): AiSdkSystemOption => {
  const option: AiSdkSystemOption = {};
  if (systemPrompt) option.system = systemPrompt;
  return option;
};

/**
 * Reasoning, stop sequences, abort signal and output cap, in that order.
 * A truthy `stop` (an empty array included) is forwarded as-is.
 */
export const aiSdkCallSettings = (
  options: Pick<
    AIRequestOptions,
    "reasoning" | "stop" | "abortSignal" | "maxOutputTokens"
  >,
): AiSdkCallSettings => {
  const settings: AiSdkCallSettings = {};
  const reasoning = reasoningForAiSdk(options.reasoning);
  if (reasoning !== undefined) settings.reasoning = reasoning;
  if (options.stop) settings.stopSequences = options.stop;
  if (options.abortSignal) settings.abortSignal = options.abortSignal;
  if (options.maxOutputTokens !== undefined) {
    settings.maxOutputTokens = options.maxOutputTokens;
  }
  return settings;
};
