// Settings-related preload functionality
import { ipcRenderer } from "electron";
import { messageLabel, type Label } from "~/shared/i18n/message";
import { supportsAdminKey, type ProviderId } from "~/shared/providers";
import { asLabel } from "./ipcLabel";
import type { CorrectionOutputMode } from "~/shared/outputMode";
import type { KeyBindings } from "~/stores/apiStore";

/**
 * Exposes settings-related functionality to the renderer process
 */
export const settingsFeature = {
  getCorrectionOutputMode: (): Promise<CorrectionOutputMode> =>
    ipcRenderer.invoke("get-correction-output-mode"),

  setCorrectionOutputMode: async (
    mode: CorrectionOutputMode,
  ): Promise<{
    success: boolean;
    mode?: CorrectionOutputMode;
    error?: Label;
  }> => {
    if (mode !== "paste" && mode !== "popup") {
      return {
        success: false,
        error: messageLabel("settings.general.outputMode.invalid"),
      };
    }
    const result = await ipcRenderer.invoke("set-correction-output-mode", mode);
    return { ...result, error: asLabel(result?.error) };
  },

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
  ): Promise<{ success: boolean; error?: Label }> => {
    console.log("Preload: Invoking set-key-bindings with:", bindings);
    const result = await ipcRenderer.invoke("set-key-bindings", bindings);
    ipcRenderer.send("settings-updated");
    return { ...result, error: asLabel(result?.error) };
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
   * Store a provider's admin key securely (safeStorage in main) — OpenRouter's
   * provisioning key or OpenAI's Admin API key. Validates the provider AND the
   * string here (preload boundary) before invoking; a bad payload never crosses
   * IPC. The plaintext key is sent to main only to be encrypted — it is never
   * returned to the renderer.
   *
   * `provider` is required, never defaulted: a missed argument must fail loudly
   * rather than write one provider's key into another's slot.
   */
  setProvisioningKey: async (
    provider: ProviderId,
    key: string
  ): Promise<{ success: boolean; error?: Label }> => {
    if (!supportsAdminKey(provider) || typeof key !== "string") {
      return {
        success: false,
        error: messageLabel("settings.general.provisioningKey.invalid"),
      };
    }
    const result = await ipcRenderer.invoke(
      "set-provisioning-key",
      provider,
      key
    );
    return { ...result, error: asLabel(result?.error) };
  },

  /**
   * Remove a provider's stored admin key.
   */
  clearProvisioningKey: async (
    provider: ProviderId
  ): Promise<{ success: boolean; error?: Label }> => {
    if (!supportsAdminKey(provider)) {
      return {
        success: false,
        error: messageLabel("settings.general.provisioningKey.invalid"),
      };
    }
    const result = await ipcRenderer.invoke("clear-provisioning-key", provider);
    return { ...result, error: asLabel(result?.error) };
  },

  /**
   * Whether that provider's admin key is currently stored. Drives the masked UI
   * state; the actual key value is never exposed to the renderer.
   */
  hasProvisioningKey: async (provider: ProviderId): Promise<boolean> =>
    supportsAdminKey(provider)
      ? ipcRenderer.invoke("has-provisioning-key", provider)
      : false,

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
