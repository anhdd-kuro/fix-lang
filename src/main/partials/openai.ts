import LanguageDetect from "languagedetect";
import { OpenAI } from "openai";
import { DEFAULT_IMPROVE_PROMPT, makeDefaultSystemPrompt } from "~/prompts";
import { StringPrettifier } from "~/utils";
import { store } from "./store";

const lngDetector = new LanguageDetect();

/**
 * Fetches available OpenAI models using the provided API key.
 * @param apiKey The OpenAI API key to use for this request.
 * @returns A promise that resolves with an array of model objects (id, object, created, owned_by, etc)
 */
export const fetchOpenAIModels = async (
  apiKey: string
): Promise<
  { id: string; object: string; created: number; owned_by: string }[]
> => {
  if (!apiKey) {
    throw new Error("OpenAI API key is missing.");
  }
  try {
    const openai = new OpenAI({ apiKey });
    // https://platform.openai.com/docs/api-reference/models/list
    const response = await openai.models.list();
    // Return only essential fields for dropdown
    return response.data.map(({ id, object, created, owned_by }) => ({
      id,
      object,
      created,
      owned_by,
    }));
  } catch (error) {
    console.error("Error fetching OpenAI models:", error);
    throw new Error(
      error instanceof Error ? error.message : "Failed to fetch OpenAI models."
    );
  }
};

/**
 * Fixes grammar and style for the given text using OpenAI API.
 * @param apiKey The OpenAI API key to use for this request.
 * @param text The text to fix.
 * @param systemPrompt Optional custom system prompt for the OpenAI API.
 * @returns A promise that resolves with the fixed text.
 */
export const fixGrammar = async (
  apiKey: string,
  text: string
): Promise<string> => {
  // Check if API key is provided
  if (!apiKey) {
    console.error("fixGrammar called without an API key.");
    throw new Error("OpenAI API key is missing.");
  }

  if (!text || !text.trim()) {
    console.log("fixGrammar called with empty or whitespace-only text.");
    return text; // Return original text if it's empty or whitespace
  }

  // Initialize OpenAI client *locally* with the provided key
  const openai = new OpenAI({ apiKey });

  // Detect language
  const languages = lngDetector.detect(text);
  console.log(`🚀 \n - languages:`, languages);
  const mostConfidentLanguages = languages.flatMap(([lang, confidence]) =>
    confidence >= 0.5 ? lang : []
  );
  const promptLang =
    mostConfidentLanguages.length > 0
      ? [...new Set(["english", ...mostConfidentLanguages])].join(", ")
      : "";

  const systemPrompt = new StringPrettifier(`
    ${makeDefaultSystemPrompt({ languages: promptLang, input: text })}
    ${DEFAULT_IMPROVE_PROMPT}
  `)
    .removeExtraSpaces()
    .removeEmptyLines().value;

  // Construct the user prompt - asking to fix the provided text
  const userPrompt = `Fix the following input:
  ${text}
  `.trim();

  try {
    console.log(
      `Sending request to OpenAI with system prompt: \n "${systemPrompt}" \n`,
      `User Prompt: \n "${userPrompt}" \n`
    );
    const selectedModel = store.get("selectedModel");
    if (!selectedModel) {
      throw new Error("You have to select a model first.");
    }
    const res = await openai.chat.completions.create({
      model: selectedModel,
      messages: [
        {
          role: "system",
          content: systemPrompt,
        }, // Use the provided or default system prompt
        { role: "user", content: userPrompt },
      ],
      temperature: 0.2, // Lower temperature for more deterministic corrections
      max_completion_tokens: 1000, // Adjust as needed based on expected text length
      n: 1, // We only need one correction
      stop: null, // Let the model decide when to stop
    });

    // Log the full response for debugging if necessary
    console.log("OpenAI Full Response:", JSON.stringify(res, null, 2));

    // Extract the corrected text
    const fixedText = res.choices[0]?.message?.content?.trim();

    if (!fixedText) {
      console.error("OpenAI response did not contain corrected text.", res);
      throw new Error("Failed to get corrected text from OpenAI response.");
    }

    console.log("Received corrected text from OpenAI.");
    return fixedText;
  } catch (error) {
    console.error("Error calling OpenAI API:", error);
    // Re-throw the error so the caller (hotkey handler) can potentially notify the user
    throw error;
  }
};
