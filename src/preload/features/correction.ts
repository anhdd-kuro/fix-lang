// Correction-related preload functionality
import { ipcRenderer } from "electron";
import type { CorrectionSettings } from "~/stores/apiStore";

/**
 * Exposes correction-related functionality to the renderer process
 */
export const correctionFeature = {
  /**
   * Retrieves correction settings from the main process.
   */
  getCorrectSettings: (): Promise<CorrectionSettings> => {
    return ipcRenderer.invoke("get-correct-settings");
  },

  setCorrectSettings: (
    settings: CorrectionSettings,
  ): Promise<{ success: boolean }> => {
    return ipcRenderer.invoke("set-correct-settings", settings);
  },

  fixGrammar: (payload: { text: string; presetId?: string }) =>
    ipcRenderer.invoke("fix-grammar", payload),
};

export type CorrectionFeature = typeof correctionFeature;
