import { OpenAI } from "openai";

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
