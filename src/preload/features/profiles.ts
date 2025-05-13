// Profiles-related preload functionality
import { ipcRenderer } from "electron";
import type { Profile } from "~/stores/apiStore";

/**
 * Exposes profile-related functionality to the renderer process
 */
export const profilesFeature = {
  /**
   * Gets all saved profiles and the current profile ID
   */
  getProfiles: (): Promise<{
    profiles: Profile[];
    currentProfileId: string;
    error?: string;
  }> => {
    console.log("Preload: Invoking get-profiles");
    return ipcRenderer.invoke("get-profiles");
  },

  /**
   * Gets the current profile ID and profile data
   */
  getCurrentProfile: (): Promise<{
    currentProfileId: string;
    currentProfile: Profile | null;
    error?: string;
  }> => {
    console.log("Preload: Invoking get-current-profile");
    return ipcRenderer.invoke("get-current-profile");
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
    error?: string;
  }> => {
    const result = await ipcRenderer.invoke("create-profile", params);
    ipcRenderer.send("profile-updated");
    return result;
  },

  /**
   * Applies settings from a profile
   */
  applyProfile: async (params: {
    profileId: string;
  }): Promise<{
    success: boolean;
    error?: string;
  }> => {
    const result = await ipcRenderer.invoke("apply-profile", params);
    ipcRenderer.send("profile-updated");
    return result;
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
    error?: string;
  }> => {
    const result = await ipcRenderer.invoke("update-profile", params);
    ipcRenderer.send("profile-updated");
    return result;
  },

  /**
   * Deletes a profile
   */
  deleteProfile: async (params: {
    profileId: string;
  }): Promise<{
    success: boolean;
    error?: string;
  }> => {
    const result = await ipcRenderer.invoke("delete-profile", params);
    ipcRenderer.send("profile-updated");
    return result;
  },

  /**
   * Switches to the next profile in the list
   */
  switchToNextProfile: async (): Promise<{
    success: boolean;
    profile?: Profile;
    error?: string;
  }> => {
    const result = await ipcRenderer.invoke("switch-to-next-profile");
    ipcRenderer.send("profile-updated");
    return result;
  },

  /**
   * Imports a profile from JSON
   */
  importProfile: async (params: {
    profileJson: string;
  }): Promise<{
    success: boolean;
    profile?: Profile;
    error?: string;
  }> => {
    const result = await ipcRenderer.invoke("import-profile", params);
    ipcRenderer.send("profile-updated");
    return result;
  },

  /**
   * Exports a profile to JSON
   */
  exportProfile: async (params: {
    profileId: string;
  }): Promise<{
    success: boolean;
    profileJson?: string;
    error?: string;
  }> => {
    return ipcRenderer.invoke("export-profile", params);
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
