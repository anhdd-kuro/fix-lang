import React, { useEffect, useState } from "react";
import { Dialog } from "./Dialog";
import { HotkeyInput } from "./HotkeyInput";
import type { Profile } from "~/stores/apiStore";

type ProfileManagerProps = {
  className?: string;
};

const ProfileManager: React.FC<ProfileManagerProps> = ({ className = "" }) => {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [currentProfileId, setCurrentProfileId] = useState<string>("");
  const [isLoading, setIsLoading] = useState(true);
  const [newProfileName, setNewProfileName] = useState("");
  const [newProfileDescription, setNewProfileDescription] = useState("");
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isExportDialogOpen, setIsExportDialogOpen] = useState(false);
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false);
  const [importProfileJson, setImportProfileJson] = useState("");
  const [exportProfileJson, setExportProfileJson] = useState("");
  const [exportProfileName, setExportProfileName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const fetchProfiles = async () => {
    try {
      setIsLoading(true);
      setError(null);

      const result = await window.electronAPI.getProfiles();

      if (result.error) {
        setError(result.error);
        return;
      }

      setProfiles(result.profiles || []);
      setCurrentProfileId(result.currentProfileId || "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch profiles");
    } finally {
      setIsLoading(false);
    }
  };

  // Fetch profiles on component mount
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchProfiles();

    // Set up listener for profile updates
    const cleanup = window.electronAPI.onProfileUpdated?.(() => {
      fetchProfiles();
    });

    return () => {
      cleanup?.();
    };
  }, []);

  const handleCreateProfile = async () => {
    if (!newProfileName.trim()) {
      setError("Profile name is required");
      return;
    }

    try {
      setIsLoading(true);
      setError(null);

      const result = await window.electronAPI.createProfile({
        name: newProfileName.trim(),
        description: newProfileDescription.trim() || undefined,
      });

      if (!result.success) {
        setError(result.error || "Failed to create profile");
        return;
      }

      await fetchProfiles();
      setIsCreateDialogOpen(false);
      setNewProfileName("");
      setNewProfileDescription("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create profile");
    } finally {
      setIsLoading(false);
    }
  };

  const handleApplyProfile = async (profileId: string) => {
    try {
      setIsLoading(true);
      setError(null);

      const result = await window.electronAPI.applyProfile({ profileId });

      if (!result.success) {
        setError(result.error || "Failed to apply profile");
        return;
      }

      setCurrentProfileId(profileId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to apply profile");
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteProfile = async (profileId: string) => {
    if (profiles.length <= 1) {
      setError("Cannot delete the last profile");
      return;
    }

    if (window.confirm("Are you sure you want to delete this profile?")) {
      try {
        setIsLoading(true);
        setError(null);

        const result = await window.electronAPI.deleteProfile({ profileId });

        if (!result.success) {
          setError(result.error || "Failed to delete profile");
          return;
        }

        await fetchProfiles();
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to delete profile"
        );
      } finally {
        setIsLoading(false);
      }
    }
  };

  const handleExportProfile = async (profileId: string) => {
    try {
      setIsLoading(true);
      setError(null);

      const result = await window.electronAPI.exportProfile({ profileId });

      if (!result.success) {
        setError(result.error || "Failed to export profile");
        return;
      }

      const profile = profiles.find((p) => p.id === profileId);

      if (profile) {
        setExportProfileJson(result.profileJson || "");
        setExportProfileName(profile.name);
        setIsExportDialogOpen(true);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to export profile");
    } finally {
      setIsLoading(false);
    }
  };

  const handleImportProfile = async () => {
    try {
      setIsLoading(true);
      setError(null);

      if (!importProfileJson) {
        setError("No profile data provided");
        return;
      }

      // Validate JSON format
      try {
        JSON.parse(importProfileJson);
      } catch (err) {
        setError("Invalid JSON format");
        setIsLoading(false);
        return;
      }

      const result = await window.electronAPI.importProfile({
        profileJson: importProfileJson,
      });

      if (!result.success) {
        setError(result.error || "Failed to import profile");
        return;
      }

      await fetchProfiles();
      setIsImportDialogOpen(false);
      setImportProfileJson("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to import profile");
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopyToClipboard = (text: string) => {
    navigator.clipboard
      .writeText(text)
      .then(() => {
        alert("Profile JSON copied to clipboard");
      })
      .catch((err) => {
        console.error("Failed to copy to clipboard:", err);
        setError("Failed to copy to clipboard");
      });
  };

  return (
    <div className={`flex flex-col ${className}`}>
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-medium text-foreground">Profiles</h3>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setIsCreateDialogOpen(true)}
            className="px-3 py-1.5 bg-primary text-primary-foreground text-sm font-medium rounded hover:bg-primary/90"
            disabled={isLoading}
          >
            New Profile
          </button>
          <button
            type="button"
            onClick={() => setIsImportDialogOpen(true)}
            className="px-3 py-1.5 bg-secondary text-secondary-foreground text-sm font-medium rounded hover:bg-secondary"
            disabled={isLoading}
          >
            Import
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-destructive/50 border border-destructive text-destructive-foreground px-4 py-2 mb-4 rounded">
          {error}
        </div>
      )}

      {isLoading ? (
        <div className="flex justify-center items-center h-24">
          <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-primary"></div>
        </div>
      ) : (
        <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
          {profiles.length === 0 ? (
            <div className="text-muted-foreground text-center py-8">
              No profiles found. Create a new profile to get started.
            </div>
          ) : (
            profiles.map((profile) => (
              <div
                key={profile.id}
                className={`border rounded p-3 ${
                  profile.id === currentProfileId
                    ? "border-primary bg-primary/20"
                    : "border-border bg-card"
                }`}
              >
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <h4 className="font-medium text-foreground">{profile.name}</h4>
                    {profile.description && (
                      <p className="text-sm text-muted-foreground mt-1">
                        {profile.description}
                      </p>
                    )}
                    <div className="text-xs text-muted-foreground mt-1">
                      Updated: {new Date(profile.updatedAt).toLocaleString()}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    {profile.id !== currentProfileId && (
                      <button
                        type="button"
                        onClick={() => handleApplyProfile(profile.id)}
                        className="px-2.5 py-1 bg-primary text-primary-foreground text-xs font-medium rounded hover:bg-primary/90"
                      >
                        Apply
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => handleExportProfile(profile.id)}
                      className="px-2.5 py-1 bg-secondary text-secondary-foreground text-xs font-medium rounded hover:bg-secondary"
                    >
                      Export
                    </button>
                    {profiles.length > 1 && (
                      <button
                        type="button"
                        onClick={() => handleDeleteProfile(profile.id)}
                        className="px-2.5 py-1 bg-destructive text-destructive-foreground text-xs font-medium rounded hover:bg-destructive/90"
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Create Profile Dialog */}
      <Dialog
        isOpen={isCreateDialogOpen}
        onClose={() => setIsCreateDialogOpen(false)}
        title="Create New Profile"
      >
        <div className="space-y-4">
          <div>
            <label
              htmlFor="profileName"
              className="block text-sm font-medium text-card-foreground mb-1"
            >
              Profile Name *
            </label>
            <input
              id="profileName"
              type="text"
              value={newProfileName}
              onChange={(e) => setNewProfileName(e.target.value)}
              placeholder="My Profile"
              className="w-full px-3 py-2 text-foreground bg-card rounded border border-border focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent"
              required
            />
          </div>

          <div>
            <label
              htmlFor="profileDescription"
              className="block text-sm font-medium text-card-foreground mb-1"
            >
              Description (Optional)
            </label>
            <textarea
              id="profileDescription"
              value={newProfileDescription}
              onChange={(e) => setNewProfileDescription(e.target.value)}
              placeholder="Profile description..."
              className="w-full px-3 py-2 text-foreground bg-card rounded border border-border focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent"
              rows={3}
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setIsCreateDialogOpen(false)}
              className="px-4 py-2 bg-secondary text-secondary-foreground font-medium rounded hover:bg-secondary"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleCreateProfile}
              className="px-4 py-2 bg-primary text-primary-foreground font-medium rounded hover:bg-primary/90"
              disabled={!newProfileName.trim()}
            >
              Create
            </button>
          </div>
        </div>
      </Dialog>

      {/* Export Profile Dialog */}
      <Dialog
        isOpen={isExportDialogOpen}
        onClose={() => setIsExportDialogOpen(false)}
        title={`Export Profile: ${exportProfileName}`}
      >
        <div className="space-y-4">
          <div>
            <label
              htmlFor="exportJson"
              className="block text-sm font-medium text-card-foreground mb-1"
            >
              Profile JSON
            </label>
            <textarea
              id="exportJson"
              value={exportProfileJson}
              readOnly
              className="w-full px-3 py-2 text-foreground bg-card rounded border border-border focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent"
              rows={10}
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setIsExportDialogOpen(false)}
              className="px-4 py-2 bg-secondary text-secondary-foreground font-medium rounded hover:bg-secondary"
            >
              Close
            </button>
            <button
              type="button"
              onClick={() => handleCopyToClipboard(exportProfileJson)}
              className="px-4 py-2 bg-primary text-primary-foreground font-medium rounded hover:bg-primary/90"
            >
              Copy to Clipboard
            </button>
          </div>
        </div>
      </Dialog>

      {/* Import Profile Dialog */}
      <Dialog
        isOpen={isImportDialogOpen}
        onClose={() => setIsImportDialogOpen(false)}
        title="Import Profile"
      >
        <div className="space-y-4">
          <div>
            <label
              htmlFor="importJson"
              className="block text-sm font-medium text-card-foreground mb-1"
            >
              Paste Profile JSON
            </label>
            <textarea
              id="importJson"
              value={importProfileJson}
              onChange={(e) => setImportProfileJson(e.target.value)}
              placeholder="Paste profile JSON here..."
              className="w-full px-3 py-2 text-foreground bg-card rounded border border-border focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent"
              rows={10}
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setIsImportDialogOpen(false)}
              className="px-4 py-2 bg-secondary text-secondary-foreground font-medium rounded hover:bg-secondary"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleImportProfile}
              className="px-4 py-2 bg-primary text-primary-foreground font-medium rounded hover:bg-primary/90"
              disabled={!importProfileJson.trim()}
            >
              Import
            </button>
          </div>
        </div>
      </Dialog>

      {/* Profile Switch Shortcut — co-located per issue #45 */}
      <div className="mt-6 rounded-lg border border-border bg-card/60 p-4">
        <h4 className="text-sm font-semibold text-card-foreground mb-3">
          Profile Switch Shortcut
        </h4>
        <HotkeyInput
          hotkeyKey="profileSwitch"
          label="Shortcut to cycle through profiles"
        />
      </div>
    </div>
  );
};

export default ProfileManager;
