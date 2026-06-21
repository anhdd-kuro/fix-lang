// Settings-related preload functionality
import { ipcRenderer } from "electron";
import type { KeyBindings } from "~/stores/apiStore";

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
   * Store the OpenRouter provisioning (admin) key securely (safeStorage in
   * main). Validates the argument is a string here (preload boundary) before
   * invoking; rejects non-strings without crossing IPC. The plaintext key is
   * sent to main only to be encrypted — it is never returned to the renderer.
   */
  setProvisioningKey: (
    key: string
  ): Promise<{ success: boolean; error?: string }> => {
    if (typeof key !== "string") {
      return Promise.resolve({ success: false, error: "Invalid key" });
    }
    return ipcRenderer.invoke("set-provisioning-key", key);
  },

  /**
   * Remove the stored OpenRouter provisioning key.
   */
  clearProvisioningKey: (): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke("clear-provisioning-key"),

  /**
   * Whether a provisioning key is currently stored. Drives the masked UI state;
   * the actual key value is never exposed to the renderer.
   */
  hasProvisioningKey: (): Promise<boolean> =>
    ipcRenderer.invoke("has-provisioning-key"),

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

export type SettingsFeature = typeof settingsFeature;
