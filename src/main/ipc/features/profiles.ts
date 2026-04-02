/**
 * @file profiles.ts
 * @description IPC handlers for profile management
 */
import { ipcMain, Notification } from "electron";
import { reloadHotkeys } from "~/main/keybindings";
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
} from "~/stores/apiStore";
import type { Profile } from "~/stores/apiStore";

/**
 * Registers profile-related IPC handlers
 */
export const registerProfileHandlers = () => {
  // Initialize default profile if needed
  initializeDefaultProfile();

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

        if (success && profile) {
          new Notification({
            title: "Profile Deleted",
            body: `Profile "${profile.name}" has been deleted.`,
          }).show();
        }

        return {
          success,
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
        const profileData = JSON.parse(profileJson) as Profile;

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
        const apiStore = (await import("~/stores/apiStore")).apiStore;
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
          profileJson: JSON.stringify(profile, null, 2),
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
