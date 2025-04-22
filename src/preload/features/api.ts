// API-related preload functionality
import { ipcRenderer } from "electron";

/**
 * Exposes API-related functionality to the renderer process
 */
export const apiFeature = {
  /**
   * Fetches the list of available OpenAI models using the stored API key.
   * @returns A promise resolving to { success: boolean, models?: Model[], error?: string }
   */
  fetchOpenAIModels: async (refetch?: boolean) => {
    return await ipcRenderer.invoke("fetch-openai-models", refetch);
  },

  /**
   * Sets the selected OpenAI model for future requests
   */
  setSelectedModel: async (modelId: string) => {
    const result = await ipcRenderer.invoke("set-selected-model", modelId);
    ipcRenderer.send("settings-updated");
    return result;
  },

  /**
   * Gets the currently selected OpenAI model
   */
  getSelectedModel: async () => {
    return await ipcRenderer.invoke("get-selected-model");
  },

  /**
   * Fetches the stored OpenAI API key from the main process.
   * @returns A promise that resolves with the stored API key (string) or an empty string if none is set or on error.
   */
  getApiKey: (): Promise<string> => {
    console.log("Preload: Invoking get-api-key");
    return ipcRenderer.invoke("get-api-key");
  },

  /**
   * Sends the OpenAI API key to the main process to be stored securely.
   * @param apiKey The API key string to store.
   * @returns A promise that resolves with an object indicating success or failure (e.g., { success: true } or { success: false, error: 'message' }).
   */
  setApiKey: (
    apiKey: string
  ): Promise<{ success: boolean; error?: string }> => {
    console.log(
      `Preload: Invoking set-api-key with key length: ${apiKey?.length ?? 0}`
    );
    return ipcRenderer.invoke("set-api-key", apiKey);
  },
};
