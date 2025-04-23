// Correction-related preload functionality
import { ipcRenderer } from "electron";

/**
 * Exposes correction-related functionality to the renderer process
 */
export const correctionFeature = {
  /**
   * Retrieves correction settings from the main process.
   */
  getCorrectSettings: (): Promise<{
    paraphrase: boolean;
    withShorten: boolean;
    paraphrasePrompt: string;
    userInput: string;
  }> => {
    return ipcRenderer.invoke("get-correct-settings");
  },

  setCorrectSettings: (settings: {
    paraphrase: boolean;
    withShorten: boolean;
    paraphrasePrompt: string;
    userInput: string;
  }): Promise<{ success: boolean }> => {
    return ipcRenderer.invoke("set-correct-settings", settings);
  },
};

export type CorrectionFeature = typeof correctionFeature;
