/**
 * @file profiles.ts
 * @description IPC handlers for profile management
 */
import { ipcMain, Notification } from "electron";
import { reloadHotkeys } from "~/main/keybindings";
import { broadcastToAllWindows } from "~/main/webViewWindows/broadcast";
import { messageLabel, textLabel, type Label } from "~/shared/i18n/message";
import { ACTIVE_PROFILE_CHANGED } from "~/shared/ipcChannels";
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
  toExportableProfile,
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
import { wrapStoreResult } from "./ipcResultLabel";
import {
  buildProfileNotification,
  buildProfilesUpdatedNotification,
} from "./profileNotifications";
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
 * Wraps an exception caught by a profile handler. Mirrors `exceptionLabel`
 * (`./ipcResultLabel.ts`) for the `Error` case (opaque, `textLabel`), but this
 * file's non-`Error` fallback was always the hardcoded UI copy "Unknown
 * error" (not `String(error)`) — kept as a translatable `messageLabel`,
 * reusing the identical existing `models.select.error.unknown` catalog entry
 * rather than adding a duplicate key.
 */
const catchLabel = (error: unknown): Label =>
  error instanceof Error
    ? textLabel(error.message)
    : messageLabel("models.select.error.unknown");

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
        error: catchLabel(error),
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
        error: catchLabel(error),
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

        new Notification(buildProfileNotification("created", name)).show();

        return {
          success: true,
          profile,
        };
      } catch (error) {
        console.error("Failed to create profile:", error);
        return { success: false, error: catchLabel(error) };
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
          broadcastToAllWindows(ACTIVE_PROFILE_CHANGED);
          const profile = getProfileById(profileId);

          new Notification(
            buildProfileNotification("applied", profile?.name ?? ""),
          ).show();
        }

        // `applyProfile` (apiStore.ts) is outside this migration's scope —
        // its error text ("Profile not found", …) is boundary-wrapped as
        // opaque here rather than guessed at as translatable.
        return wrapStoreResult(result);
      } catch (error) {
        console.error("Failed to apply profile:", error);
        return { success: false, error: catchLabel(error) };
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
          new Notification(
            buildProfileNotification("updated", updatedProfile.name),
          ).show();

          return {
            success: true,
            profile: updatedProfile,
          };
        }

        return {
          success: false,
          error: messageLabel("common.error.profileNotFound"),
        };
      } catch (error) {
        console.error("Failed to update profile:", error);
        return { success: false, error: catchLabel(error) };
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
          new Notification(
            buildProfileNotification("deleted", profile.name),
          ).show();
        }

        if (!secretCleanup.success) {
          // Not surfaced to the renderer: no UI ever read this signal, and a
          // partially-failed cleanup shouldn't block the deletion itself.
          // Server-side visibility is enough here.
          console.error(
            "Failed to fully clean up credentials after profile deletion:",
            secretCleanup.error,
          );
        }

        return { success };
      } catch (error) {
        console.error("Failed to delete profile:", error);
        return { success: false, error: catchLabel(error) };
      }
    },
  );

  // Switch to next profile
  ipcMain.handle("switch-to-next-profile", async () => {
    try {
      const nextProfile = switchToNextProfile();

      if (nextProfile) {
        reloadHotkeys();
        broadcastToAllWindows(ACTIVE_PROFILE_CHANGED);
        new Notification(
          buildProfileNotification("switched", nextProfile.name),
        ).show();

        return {
          success: true,
          profile: nextProfile,
        };
      }

      return {
        success: false,
        error: messageLabel("common.error.noProfilesAvailable"),
      };
    } catch (error) {
      console.error("Failed to switch profile:", error);
      return { success: false, error: catchLabel(error) };
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
            error: messageLabel("common.error.invalidProfileFormat"),
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

        new Notification(
          buildProfileNotification("imported", profileData.name),
        ).show();

        return {
          success: true,
          profile: profileData,
        };
      } catch (error) {
        console.error("Failed to import profile:", error);
        return {
          success: false,
          // Reuses the existing `profiles.manager.error.importFailed` catalog
          // entry (identical wording) rather than adding a duplicate key —
          // `profiles.json` is outside this migration's catalog scope, but
          // referencing an existing key from it is just a lookup.
          error:
            error instanceof Error
              ? textLabel(error.message)
              : messageLabel("profiles.manager.error.importFailed"),
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
            error: messageLabel("common.error.profileNotFound"),
          };
        }

        return {
          success: true,
          // `toExportableProfile`, not `withoutProfileSecrets`: cached models,
          // enabledProviders and composite refs are meaningless on another
          // machine. `withoutProfileSecrets` must stay secrets-only — it is
          // written back to disk by the legacy migration above.
          profileJson: JSON.stringify(toExportableProfile(profile), null, 2),
        };
      } catch (error) {
        console.error("Failed to export profile:", error);
        return { success: false, error: catchLabel(error) };
      }
    },
  );

  // Notification for profile updates
  ipcMain.on("profile-updated", () => {
    new Notification(buildProfilesUpdatedNotification()).show();
  });
};
