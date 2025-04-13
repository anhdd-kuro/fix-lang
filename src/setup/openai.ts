import { OpenAI } from "openai";

// Default system prompt if none is provided
const DEFAULT_SYSTEM_PROMPT =
  "You are a helpful English editor. Correct grammar and style mistakes in the text provided by the user. Respond only with the corrected text, without any introductory phrases or explanations.";

/**
 * Fixes grammar and style for the given text using OpenAI API.
 * @param apiKey The OpenAI API key to use for this request.
 * @param text The text to fix.
 * @param systemPrompt Optional custom system prompt for the OpenAI API.
 * @returns A promise that resolves with the fixed text.
 */
export const fixGrammar = async (
  apiKey: string,
  text: string,
  systemPrompt: string = DEFAULT_SYSTEM_PROMPT
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

  // Construct the user prompt - asking to fix the provided text
  const userPrompt = `Fix the following text:
  ${text}
  `.trim();

  try {
    console.log(
      `Sending request to OpenAI with system prompt: "${systemPrompt}"`,
      `User Prompt: "${userPrompt}"`
    );
    const res = await openai.chat.completions.create({
      model: "gpt-4o-mini", // Or your preferred model
      messages: [
        { role: "system", content: systemPrompt }, // Use the provided or default system prompt
        { role: "user", content: userPrompt },
      ],
      temperature: 0.2, // Lower temperature for more deterministic corrections
      max_tokens: 1000, // Adjust as needed based on expected text length
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
