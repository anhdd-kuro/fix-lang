/**
 * @file profiles.ts
 * @description IPC handlers for profile management
 */
import { ipcMain, Notification } from "electron";
import { reloadHotkeys } from "~/main/keybindings";
import {
  clearLegacyApiKey,
  getLegacyApiKey,
} from "~/stores/apiKeyStore";
import {
  getProfiles,
  getCurrentProfileId,
  createProfile,
  applyProfile,
  updateProfile,
  deleteProfile,
  switchToNextProfile,
  getProfileById,
  initializeDefaultProfile,
  apiStore,
  withoutProfileSecrets,
  sanitizeImportedProfile,
} from "~/stores/apiStore";
import {
  clearProfileSecrets,
  hasProfileSecret,
  setProfileSecret,
} from "~/stores/profileSecretStore";
import {
  clearLegacyProvisioningKey,
  getLegacyProvisioningKey,
} from "~/stores/provisioningKeyStore";
import type { Profile } from "~/stores/apiStore";

/**
 * Moves legacy global credentials only after the active profile exists. The
 * destination is written first; a legacy encrypted file is removed only after
 * that write succeeds, so a failed migration cannot discard the only key.
 */
const migrateLegacySecretsToActiveProfile = async (): Promise<void> => {
  const profileId = getCurrentProfileId();
  const profile = profileId ? getProfileById(profileId) : null;
  if (!profile) return;

  const move = async (
    kind: "api" | "provisioning",
    legacy: string | null,
    clearLegacy: () => Promise<{ success: boolean }>,
  ): Promise<void> => {
    if (!legacy) return;
    // A prior run may have completed the destination write but crashed before
    // deleting the global file. The profile copy is already durable, so finish
    // that idempotent cleanup without touching its value.
    if (await hasProfileSecret(profile.id, "openrouter", kind)) {
      await clearLegacy();
      return;
    }
    const result = await setProfileSecret(profile.id, "openrouter", kind, legacy);
    if (result.success) {
      await clearLegacy();
    } else {
      console.warn(`Profile secret migration failed for ${kind}:`, result.error);
    }
  };

  await move("api", await getLegacyApiKey(), clearLegacyApiKey);
  await move(
    "provisioning",
    await getLegacyProvisioningKey(),
    clearLegacyProvisioningKey,
  );

  // Earlier releases also persisted a plaintext apiKey inside profile/root
  // settings. It is copied into safeStorage first, then scrubbed only after a
  // successful write. It is never exported or imported below.
  const legacyPlaintext = profile.settings.apiKey || (apiStore.get("apiKey") as string) || "";
  if (legacyPlaintext && !(await hasProfileSecret(profile.id, "openrouter", "api"))) {
    const result = await setProfileSecret(
      profile.id,
      "openrouter",
      "api",
      legacyPlaintext,
    );
    if (!result.success) return;
  }

  if (legacyPlaintext) {
    const profiles = getProfiles();
    const index = profiles.findIndex((candidate) => candidate.id === profile.id);
    if (index !== -1) {
      profiles[index] = withoutProfileSecrets(profiles[index]);
      apiStore.set("profiles", profiles);
    }
    (apiStore as unknown as { delete: (key: string) => void }).delete("apiKey");
  }
};

/**
 * Registers profile-related IPC handlers
 */
export const registerProfileHandlers = () => {
  // Initialize default profile if needed
  initializeDefaultProfile();
  void migrateLegacySecretsToActiveProfile();

  // Get all profiles
  ipcMain.handle("get-profiles", async () => {
    try {
      const profiles = getProfiles();
      return {
        profiles,
        currentProfileId: getCurrentProfileId(),
      };
    } catch (error) {
      console.error("Failed to get profiles:", error);
      return {
        profiles: [],
        currentProfileId: "",
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  });

  // Get current profile ID
  ipcMain.handle("get-current-profile", async () => {
    try {
      const currentProfileId = getCurrentProfileId();
      const currentProfile = currentProfileId
        ? getProfileById(currentProfileId)
        : null;
      return {
        currentProfileId,
        currentProfile,
      };
    } catch (error) {
      console.error("Failed to get current profile:", error);
      return {
        currentProfileId: "",
        currentProfile: null,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  });

  // Create profile from current settings
  ipcMain.handle(
    "create-profile",
    async (
      _event,
      { name, description }: { name: string; description?: string },
    ) => {
      try {
        const profile = createProfile(name, description);

        new Notification({
          title: "Profile Created",
          body: `Profile "${name}" has been created and activated.`,
        }).show();

        return {
          success: true,
          profile,
        };
      } catch (error) {
        console.error("Failed to create profile:", error);
        return {
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    },
  );

  // Apply profile
  ipcMain.handle(
    "apply-profile",
    async (_event, { profileId }: { profileId: string }) => {
      try {
        const result = applyProfile(profileId);

        if (result.success) {
          reloadHotkeys();
          const profile = getProfileById(profileId);

          new Notification({
            title: "Profile Applied",
            body: `Profile "${profile?.name}" has been activated.`,
          }).show();
        }

        return result;
      } catch (error) {
        console.error("Failed to apply profile:", error);
        return {
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    },
  );

  // Update profile
  ipcMain.handle(
    "update-profile",
    async (
      _event,
      {
        profileId,
        name,
        description,
      }: { profileId: string; name?: string; description?: string },
    ) => {
      try {
        const updatedProfile = updateProfile(profileId, name, description);

        if (updatedProfile) {
          new Notification({
            title: "Profile Updated",
            body: `Profile "${updatedProfile.name}" has been updated.`,
          }).show();

          return {
            success: true,
            profile: updatedProfile,
          };
        }

        return {
          success: false,
          error: "Profile not found",
        };
      } catch (error) {
        console.error("Failed to update profile:", error);
        return {
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    },
  );

  // Delete profile
  ipcMain.handle(
    "delete-profile",
    async (_event, { profileId }: { profileId: string }) => {
      try {
        const profile = getProfileById(profileId);
        const success = deleteProfile(profileId);
        const secretCleanup = success
          ? await clearProfileSecrets(profileId)
          : { success: true };

        if (success && profile) {
          new Notification({
            title: "Profile Deleted",
            body: `Profile "${profile.name}" has been deleted.`,
          }).show();
        }

        return {
          success,
          ...(secretCleanup.success
            ? {}
            : { warning: "Profile deleted, but some credentials could not be removed" }),
        };
      } catch (error) {
        console.error("Failed to delete profile:", error);
        return {
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    },
  );

  // Switch to next profile
  ipcMain.handle("switch-to-next-profile", async () => {
    try {
      const nextProfile = switchToNextProfile();

      if (nextProfile) {
        reloadHotkeys();
        new Notification({
          title: "Profile Switched",
          body: `Profile "${nextProfile.name}" has been activated.`,
        }).show();

        return {
          success: true,
          profile: nextProfile,
        };
      }

      return {
        success: false,
        error: "No profiles available",
      };
    } catch (error) {
      console.error("Failed to switch profile:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  });

  // Import profile from JSON
  ipcMain.handle(
    "import-profile",
    async (_event, { profileJson }: { profileJson: string }) => {
      try {
        // Parse the JSON profile
        const profileData = sanitizeImportedProfile(
          JSON.parse(profileJson) as Profile,
        );

        // Validate that it has the required structure
        if (!profileData.id || !profileData.name || !profileData.settings) {
          return {
            success: false,
            error: "Invalid profile format",
          };
        }

        // Add the profile to the store
        const profiles = getProfiles();

        // Check if profile with same ID already exists
        if (profiles.some((p) => p.id === profileData.id)) {
          // Generate a new ID for this profile
          profileData.id = crypto.randomUUID();
        }

        // Ensure timestamps exist
        if (!profileData.createdAt) {
          profileData.createdAt = new Date().toISOString();
        }
        if (!profileData.updatedAt) {
          profileData.updatedAt = new Date().toISOString();
        }

        // Add to profiles and save
        profiles.push(profileData);

        // Save updated profiles
        apiStore.set("profiles", profiles);

        new Notification({
          title: "Profile Imported",
          body: `Profile "${profileData.name}" has been imported.`,
        }).show();

        return {
          success: true,
          profile: profileData,
        };
      } catch (error) {
        console.error("Failed to import profile:", error);
        return {
          success: false,
          error:
            error instanceof Error ? error.message : "Failed to import profile",
        };
      }
    },
  );

  // Export profile to JSON
  ipcMain.handle(
    "export-profile",
    async (_event, { profileId }: { profileId: string }) => {
      try {
        const profile = getProfileById(profileId);

        if (!profile) {
          return {
            success: false,
            error: "Profile not found",
          };
        }

        return {
          success: true,
          profileJson: JSON.stringify(withoutProfileSecrets(profile), null, 2),
        };
      } catch (error) {
        console.error("Failed to export profile:", error);
        return {
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    },
  );

  // Notification for profile updates
  ipcMain.on("profile-updated", () => {
    new Notification({
      title: "Profiles Updated",
      body: "Your profile settings have been updated.",
    }).show();
  });
};
