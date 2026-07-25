// Profiles-related preload functionality
import { ipcRenderer } from "electron";
import { asLabel } from "./ipcLabel";
import type { Label } from "~/shared/i18n/message";
import type { Profile } from "~/stores/apiStore";

/**
 * Exposes profile-related functionality to the renderer process
 */
export const profilesFeature = {
  /**
   * Gets all saved profiles and the current profile ID
   */
  getProfiles: async (): Promise<{
    profiles: Profile[];
    currentProfileId: string;
    error?: Label;
  }> => {
    console.log("Preload: Invoking get-profiles");
    const result = await ipcRenderer.invoke("get-profiles");
    return { ...result, error: asLabel(result?.error) };
  },

  /**
   * Gets the current profile ID and profile data
   */
  getCurrentProfile: async (): Promise<{
    currentProfileId: string;
    currentProfile: Profile | null;
    error?: Label;
  }> => {
    console.log("Preload: Invoking get-current-profile");
    const result = await ipcRenderer.invoke("get-current-profile");
    return { ...result, error: asLabel(result?.error) };
  },

  /**
   * Creates a new profile from current settings
   */
  createProfile: async (params: {
    name: string;
    description?: string;
  }): Promise<{
    success: boolean;
    profile?: Profile;
    error?: Label;
  }> => {
    const result = await ipcRenderer.invoke("create-profile", params);
    ipcRenderer.send("profile-updated");
    return { ...result, error: asLabel(result?.error) };
  },

  /**
   * Applies settings from a profile
   */
  applyProfile: async (params: {
    profileId: string;
  }): Promise<{
    success: boolean;
    error?: Label;
  }> => {
    const result = await ipcRenderer.invoke("apply-profile", params);
    ipcRenderer.send("profile-updated");
    return { ...result, error: asLabel(result?.error) };
  },

  /**
   * Updates a profile with current settings
   */
  updateProfile: async (params: {
    profileId: string;
    name?: string;
    description?: string;
  }): Promise<{
    success: boolean;
    profile?: Profile;
    error?: Label;
  }> => {
    const result = await ipcRenderer.invoke("update-profile", params);
    ipcRenderer.send("profile-updated");
    return { ...result, error: asLabel(result?.error) };
  },

  /**
   * Deletes a profile
   */
  deleteProfile: async (params: {
    profileId: string;
  }): Promise<{
    success: boolean;
    error?: Label;
  }> => {
    const result = await ipcRenderer.invoke("delete-profile", params);
    ipcRenderer.send("profile-updated");
    return { ...result, error: asLabel(result?.error) };
  },

  /**
   * Switches to the next profile in the list
   */
  switchToNextProfile: async (): Promise<{
    success: boolean;
    profile?: Profile;
    error?: Label;
  }> => {
    const result = await ipcRenderer.invoke("switch-to-next-profile");
    ipcRenderer.send("profile-updated");
    return { ...result, error: asLabel(result?.error) };
  },

  /**
   * Imports a profile from JSON
   */
  importProfile: async (params: {
    profileJson: string;
  }): Promise<{
    success: boolean;
    profile?: Profile;
    error?: Label;
  }> => {
    const result = await ipcRenderer.invoke("import-profile", params);
    ipcRenderer.send("profile-updated");
    return { ...result, error: asLabel(result?.error) };
  },

  /**
   * Exports a profile to JSON
   */
  exportProfile: async (params: {
    profileId: string;
  }): Promise<{
    success: boolean;
    profileJson?: string;
    error?: Label;
  }> => {
    const result = await ipcRenderer.invoke("export-profile", params);
    return { ...result, error: asLabel(result?.error) };
  },

  /**
   * Registers a callback for the 'profile-updated' event from main process.
   */
  onProfileUpdated: (callback: () => void): (() => void) => {
    const listener = () => callback();
    ipcRenderer.on("profile-updated", listener);
    return () => {
      ipcRenderer.removeListener("profile-updated", listener);
    };
  },
};

export type ProfilesFeature = typeof profilesFeature;
