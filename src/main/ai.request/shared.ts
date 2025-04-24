/**
 * @file shared.ts
 * @description Shared utilities for making AI requests across different features
 *
 * NOTE: This file centralizes AI request functionality that was previously scattered
 * across individual feature implementations. It also incorporates utility functions
 * previously in prompts/utils.ts to provide a single source of truth for OpenAI interactions.
 */
import { OpenAI } from "openai";
import { makeTonePrompt } from "~/prompts/index";
import { store } from "~/stores/apiStore";
import { StringPrettifier } from "~/utils";
import type { ChatCompletionMessageParam } from "openai/resources";
import type { GlobalSettings } from "~/stores/apiStore";

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

/**
 * Makes an AI request using OpenAI API with centralized settings management
 * @param options Configuration options for the AI request
 * @returns Promise with the AI response and token information
 */
export const makeAIRequest = async <T = string>(
  options: AIRequestOptions
): Promise<AIRequestResponse<T>> => {
  // Get API key from store
  const apiKey = store.get("apiKey") as string;
  if (!apiKey) {
    throw new Error("OpenAI API key is missing.");
  }

  // Initialize OpenAI client locally with the provided key
  const openai = new OpenAI({ apiKey });

  // Apply global settings to the system prompt (if not using custom messages)
  const finalSystemPrompt = options.messages
    ? ""
    : applyGlobalSettings(options.systemPrompt);

  // Determine which model to use
  const model = options.model || (store.get("selectedModel") as string);
  if (!model) {
    throw new Error("You have to select a model first.");
  }

  // Determine temperature to use
  const globalSettings = store.get("globalSettings");
  const temperature = options.temperature || globalSettings?.temperature || 0.3;

  try {
    // Create messages array if not provided
    const messages = options.messages || [
      { role: "system", content: finalSystemPrompt },
      { role: "user", content: options.userPrompt },
    ];

    console.log(
      `Sending request to OpenAI with model: ${model}, temperature: ${temperature}`
    );

    // Make the API request
    const res = await openai.chat.completions.create({
      model,
      messages,
      temperature,
      max_tokens: options.maxTokens || 10000,
      n: options.n || 1,
      stop: options.stop,
    });

    // Extract response and token information
    const content =
      options.n && options.n > 1
        ? (res.choices
            .map((choice) => choice.message?.content?.trim())
            .filter(Boolean) as unknown as T)
        : (res.choices[0]?.message?.content?.trim() as unknown as T);

    if (!content) {
      throw new Error("Failed to get content from OpenAI response.");
    }

    const promptTokens = res.usage?.prompt_tokens ?? null;
    const completionTokens = res.usage?.completion_tokens ?? null;

    return { content, promptTokens, completionTokens };
  } catch (error) {
    console.error("Error calling OpenAI API:", error);
    throw error;
  }
};

/**
 * Options for common AI request operations
 */
export type AIRequestOptions = {
  /** System prompt to guide the AI's behavior */
  systemPrompt: string;
  /** User message to send to the AI */
  userPrompt: string;
  /** OpenAI model to use (if not specified, pulls from store) */
  model?: string;
  /** Temperature for sampling (if not specified, pulls from store) */
  temperature?: number;
  /** Maximum tokens to generate */
  maxTokens?: number;
  /** Number of responses to generate */
  n?: number;
  /** Custom messages if needed (overrides system/user prompt params) */
  messages?: ChatCompletionMessageParam[];
  /** Stop sequences */
  stop?: string[] | null;
};

/**
 * Response structure for AI request operations
 */
export type AIRequestResponse<T = string> = {
  /** Generated content */
  content: T;
  /** Number of tokens used in the prompt */
  promptTokens: number | null;
  /** Number of tokens used in the completion */
  completionTokens: number | null;
};
