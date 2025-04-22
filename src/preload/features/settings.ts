// Settings-related preload functionality
import { ipcRenderer } from "electron";
import type { KeyBindings } from "../preload-api.types";

/**
 * Exposes settings-related functionality to the renderer process
 */
export const settingsFeature = {
  /**
   * Fetches the stored key bindings from the main process.
   * @returns A promise that resolves with the key bindings object.
   */
  getKeyBindings: (): Promise<KeyBindings> => {
    console.log("Preload: Invoking get-key-bindings");
    return ipcRenderer.invoke("get-key-bindings");
  },

  /**
   * Sends the key bindings object to the main process to be stored.
   * @param bindings The key bindings object (e.g., { fix: 'Ctrl+F', undo: 'Ctrl+Z', retry: 'Ctrl+R' }).
   * @returns A promise that resolves with an object indicating success or failure.
   */
  setKeyBindings: async (
    bindings: KeyBindings
  ): Promise<{ success: boolean; error?: string }> => {
    console.log("Preload: Invoking set-key-bindings with:", bindings);
    const result = await ipcRenderer.invoke("set-key-bindings", bindings);
    ipcRenderer.send("settings-updated");
    return result;
  },

  /**
   * Resets key bindings to default values in the main process.
   */
  resetKeyBindings: (): Promise<KeyBindings> =>
    ipcRenderer.invoke("reset-key-bindings"),

  /**
   * Temporarily pause global shortcuts during editing.
   */
  pauseHotkeys: (): Promise<void> => ipcRenderer.invoke("pause-hotkeys"),

  /**
   * Resume global shortcuts after editing.
   */
  resumeHotkeys: (): Promise<void> => ipcRenderer.invoke("resume-hotkeys"),

  /**
   * Retrieves custom prompt settings from the main process.
   */
  getPromptSettings: (): Promise<{
    customSystemPrompt: string;
    customUserPrompt: string;
    withGrammar: boolean;
    withShorten: boolean;
    tone: string;
    temperature: number;
  }> => ipcRenderer.invoke("get-prompt-settings"),

  /**
   * Stores custom prompt settings in the main process.
   */
  setPromptSettings: async (settings: {
    customSystemPrompt: string;
    customUserPrompt: string;
    withGrammar: boolean;
    withShorten: boolean;
    tone: string;
    temperature: number;
  }): Promise<{ success: boolean; error?: string }> => {
    const result = await ipcRenderer.invoke("set-prompt-settings", settings);
    ipcRenderer.send("settings-updated");
    return result;
  },

  /**
   * Registers a callback for the 'settings-updated' event from main process.
   */
  onSettingsUpdated: (callback: () => void): (() => void) => {
    const listener = () => callback();
    ipcRenderer.on("settings-updated", listener);
    return () => {
      ipcRenderer.removeListener("settings-updated", listener);
    };
  },
};
