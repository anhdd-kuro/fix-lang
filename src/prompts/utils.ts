/**
 * @file utils.ts
 * @description Utilities for working with prompts and applying global settings
 */
import { store } from "~/stores/apiStore";
import { StringPrettifier } from "~/utils";
import type { GlobalSettings } from "~/stores/apiStore";
import { makeTonePrompt } from "./index";

/**
 * Retrieves global prompt settings from the store
 * @returns GlobalSettings object with all current settings
 */
export const getGlobalPromptSettings = (): GlobalSettings => {
  return store.get("globalSettings") as GlobalSettings;
};

/**
 * Applies global settings to a system prompt
 * @param systemPrompt - Base system prompt to augment with global settings
 * @returns Final system prompt with applied global settings
 */
export const applyGlobalSettings = (systemPrompt: string): string => {
  const settings = getGlobalPromptSettings();
  const promptParts: string[] = [];

  // If custom system prompt exists, use it instead of the provided one
  if (settings.customSystemPrompt) {
    promptParts.push(settings.customSystemPrompt);
  } else {
    promptParts.push(systemPrompt);
  }

  // Add tone adjustment if specified
  if (settings.tone) {
    promptParts.push(makeTonePrompt(settings.tone));
  }

  // Combine all prompt parts and clean up the formatting
  return new StringPrettifier(promptParts.join("\n"))
    .removeExtraSpaces()
    .removeEmptyLines().value;
};
