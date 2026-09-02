import React, { useEffect, useState } from "react";
import { messageLabel, textLabel, type Label } from "~/features/i18n/shared/message";
import { Button } from "./Button";
import { Dialog } from "./Dialog";
import { HotkeyInput } from "./HotkeyInput";
import { Input, Textarea } from "./Input";
import { useI18n } from "../i18n/useI18n";
import type { Profile } from "~/features/providers/store/apiStore";

type ProfileManagerProps = {
  className?: string;
};

const ProfileManager: React.FC<ProfileManagerProps> = ({ className = "" }) => {
  const { t, tl, formatDateTime } = useI18n();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [currentProfileId, setCurrentProfileId] = useState<string>("");
  const [isLoading, setIsLoading] = useState(true);
  const [newProfileName, setNewProfileName] = useState("");
  const [newProfileDescription, setNewProfileDescription] = useState("");
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isExportDialogOpen, setIsExportDialogOpen] = useState(false);
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false);
  const [importProfileJson, setImportProfileJson] = useState("");
  const [isDragOver, setIsDragOver] = useState(false);
  const [exportProfileJson, setExportProfileJson] = useState("");
  const [exportProfileName, setExportProfileName] = useState("");
  // Error state is a locale-free `Label` (a translation key + params, or
  // verbatim text) rather than an already-resolved string: `fetchProfiles`
  // is called from an effect with an empty dep array, and if it called `t()`
  // directly, the effect would need `t` in its deps (`t`'s identity changes
  // per locale) — an honest dep array would then re-fetch on every locale
  // switch just to keep the closure fresh. Deferring resolution to render
  // time via `tl()` keeps `fetchProfiles` free of any reactive closure.
  const [error, setError] = useState<Label | null>(null);

  const fetchProfiles = async () => {
    try {
      setIsLoading(true);
      setError(null);

      const result = await window.electronAPI.getProfiles();

      if (result.error) {
        // Already a `Label` built by main — raw passthrough for
        // provider/exception text, a catalog descriptor for app-authored copy.
        setError(result.error);
        return;
      }

      setProfiles(result.profiles || []);
      setCurrentProfileId(result.currentProfileId || "");
    } catch (err) {
      setError(
        err instanceof Error
          ? textLabel(err.message)
          : messageLabel("profiles.manager.error.fetchFailed"),
      );
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
      setError(messageLabel("profiles.manager.error.nameRequired"));
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
        setError(result.error ?? messageLabel("profiles.manager.error.createFailed"));
        return;
      }

      await fetchProfiles();
      setIsCreateDialogOpen(false);
      setNewProfileName("");
      setNewProfileDescription("");
    } catch (err) {
      setError(
        err instanceof Error
          ? textLabel(err.message)
          : messageLabel("profiles.manager.error.createFailed"),
      );
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
        setError(result.error ?? messageLabel("profiles.manager.error.applyFailed"));
        return;
      }

      setCurrentProfileId(profileId);
    } catch (err) {
      setError(
        err instanceof Error
          ? textLabel(err.message)
          : messageLabel("profiles.manager.error.applyFailed"),
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteProfile = async (profileId: string) => {
    if (profiles.length <= 1) {
      setError(messageLabel("profiles.manager.error.cannotDeleteLast"));
      return;
    }

    if (window.confirm(t("profiles.manager.confirmDelete"))) {
      try {
        setIsLoading(true);
        setError(null);

        const result = await window.electronAPI.deleteProfile({ profileId });

        if (!result.success) {
          setError(result.error ?? messageLabel("profiles.manager.error.deleteFailed"));
          return;
        }

        await fetchProfiles();
      } catch (err) {
        setError(
          err instanceof Error
            ? textLabel(err.message)
            : messageLabel("profiles.manager.error.deleteFailed"),
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
        setError(result.error ?? messageLabel("profiles.manager.error.exportFailed"));
        return;
      }

      const profile = profiles.find((p) => p.id === profileId);

      if (profile) {
        setExportProfileJson(result.profileJson || "");
        setExportProfileName(profile.name);
        setIsExportDialogOpen(true);
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? textLabel(err.message)
          : messageLabel("profiles.manager.error.exportFailed"),
      );
    } finally {
      setIsLoading(false);
    }
  };

  const importProfileFromJson = async (profileJson: string): Promise<void> => {
    try {
      setIsLoading(true);
      setError(null);

      const trimmed = profileJson.trim();
      if (!trimmed) {
        setError(messageLabel("profiles.manager.error.noData"));
        return;
      }

      try {
        JSON.parse(trimmed);
      } catch {
        setError(messageLabel("profiles.manager.error.invalidJson"));
        return;
      }

      const result = await window.electronAPI.importProfile({
        profileJson: trimmed,
      });

      if (!result.success) {
        setError(result.error ?? messageLabel("profiles.manager.error.importFailed"));
        return;
      }

      await fetchProfiles();
      setIsImportDialogOpen(false);
      setImportProfileJson("");
    } catch (err) {
      setError(
        err instanceof Error
          ? textLabel(err.message)
          : messageLabel("profiles.manager.error.importFailed"),
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleImportProfile = async (): Promise<void> => {
    await importProfileFromJson(importProfileJson);
  };

  const handleProfileDrop = async (
    event: React.DragEvent<HTMLDivElement>,
  ): Promise<void> => {
    event.preventDefault();
    setIsDragOver(false);
    const file = event.dataTransfer.files[0];
    if (!file) {
      return;
    }
    if (!file.name.toLowerCase().endsWith(".json") && file.type !== "application/json") {
      setError(messageLabel("profiles.manager.error.invalidJson"));
      return;
    }
    const profileJson = await file.text();
    setImportProfileJson(profileJson);
    await importProfileFromJson(profileJson);
  };

  const handleCopyToClipboard = (text: string) => {
    navigator.clipboard
      .writeText(text)
      .then(() => {
        alert(t("profiles.manager.copiedAlert"));
      })
      .catch((err) => {
        console.error("Failed to copy to clipboard:", err);
        setError(messageLabel("profiles.manager.error.copyFailed"));
      });
  };

  return (
    <div className={`flex flex-col ${className}`}>
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-medium text-foreground">{t("profiles.manager.title")}</h3>
        <div className="flex gap-2">
          <Button
            type="button"
            onClick={() => setIsCreateDialogOpen(true)}
            className="px-3 py-1.5 text-sm font-medium rounded"
            disabled={isLoading}
          >
            {t("profiles.manager.newProfile")}
          </Button>
          <Button
            type="button"
            onClick={() => setIsImportDialogOpen(true)}
            variant="secondary"
            className="px-3 py-1.5 text-sm font-medium rounded"
            disabled={isLoading}
          >
            {t("profiles.manager.import")}
          </Button>
        </div>
      </div>

      {error && (
        <div className="bg-destructive/50 border border-destructive text-destructive-foreground px-4 py-2 mb-4 rounded">
          {tl(error)}
        </div>
      )}

      {isLoading ? (
        <div className="flex justify-center items-center h-24">
          <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-primary"></div>
        </div>
      ) : (
        <div
          className={`space-y-2 max-h-72 overflow-y-auto pr-1 rounded border border-dashed p-2 transition-colors ${
            isDragOver
              ? "border-primary bg-primary/10"
              : "border-transparent"
          }`}
          onDragOver={(event) => {
            event.preventDefault();
            setIsDragOver(true);
          }}
          onDragLeave={() => setIsDragOver(false)}
          onDrop={(event) => {
            void handleProfileDrop(event);
          }}
        >
          {isDragOver ? (
            <p className="text-center text-sm text-primary py-2">
              {t("profiles.manager.dropHint")}
            </p>
          ) : null}
          {profiles.length === 0 ? (
            <div className="text-muted-foreground text-center py-8">
              {t("profiles.manager.empty")}
            </div>
          ) : (
            profiles.map((profile) => (
              <div
                key={profile.id}
                className={`border rounded p-3 ${
                  profile.id === currentProfileId
                    ? "border-primary bg-primary/20"
                    : "border-card-control-border bg-card"
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
                      {t("profiles.manager.updatedLabel", {
                        date: formatDateTime(profile.updatedAt),
                      })}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    {profile.id !== currentProfileId && (
                      <Button
                        type="button"
                        onClick={() => handleApplyProfile(profile.id)}
                        className="px-2.5 py-1 text-xs font-medium rounded"
                      >
                        {t("profiles.manager.apply")}
                      </Button>
                    )}
                    <Button
                      type="button"
                      onClick={() => handleExportProfile(profile.id)}
                      variant="secondary"
                      className="px-2.5 py-1 text-xs font-medium rounded"
                    >
                      {t("profiles.manager.export")}
                    </Button>
                    {profiles.length > 1 && (
                      <Button
                        type="button"
                        onClick={() => handleDeleteProfile(profile.id)}
                        variant="destructive"
                        className="px-2.5 py-1 text-xs font-medium rounded"
                      >
                        {t("common.delete")}
                      </Button>
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
        title={t("profiles.manager.createDialogTitle")}
      >
        <div className="space-y-4">
          <div>
            <label
              htmlFor="profileName"
              className="block text-sm font-medium text-card-foreground mb-1"
            >
              {t("profiles.manager.nameLabel")}
            </label>
            <Input
              id="profileName"
              type="text"
              value={newProfileName}
              onChange={(e) => setNewProfileName(e.target.value)}
              placeholder={t("profiles.manager.namePlaceholder")}
              className="w-full"
              required
            />
          </div>

          <div>
            <label
              htmlFor="profileDescription"
              className="block text-sm font-medium text-card-foreground mb-1"
            >
              {t("profiles.manager.descriptionLabel")}
            </label>
            <Textarea
              id="profileDescription"
              value={newProfileDescription}
              onChange={(e) => setNewProfileDescription(e.target.value)}
              placeholder={t("profiles.manager.descriptionPlaceholder")}
              className="w-full"
              rows={3}
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              onClick={() => setIsCreateDialogOpen(false)}
              variant="secondary"
              className="px-4 py-2 font-medium rounded"
            >
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              onClick={handleCreateProfile}
              className="px-4 py-2 font-medium rounded"
              disabled={!newProfileName.trim()}
            >
              {t("profiles.manager.create")}
            </Button>
          </div>
        </div>
      </Dialog>

      {/* Export Profile Dialog */}
      <Dialog
        isOpen={isExportDialogOpen}
        onClose={() => setIsExportDialogOpen(false)}
        title={t("profiles.manager.exportDialogTitle", { name: exportProfileName })}
      >
        <div className="space-y-4">
          <div>
            <label
              htmlFor="exportJson"
              className="block text-sm font-medium text-card-foreground mb-1"
            >
              {t("profiles.manager.jsonLabel")}
            </label>
            <Textarea
              id="exportJson"
              value={exportProfileJson}
              readOnly
              className="w-full"
              rows={10}
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              onClick={() => setIsExportDialogOpen(false)}
              variant="secondary"
              className="px-4 py-2 font-medium rounded"
            >
              {t("common.close")}
            </Button>
            <Button
              type="button"
              onClick={() => handleCopyToClipboard(exportProfileJson)}
              className="px-4 py-2 font-medium rounded"
            >
              {t("profiles.manager.copyToClipboard")}
            </Button>
          </div>
        </div>
      </Dialog>

      {/* Import Profile Dialog */}
      <Dialog
        isOpen={isImportDialogOpen}
        onClose={() => setIsImportDialogOpen(false)}
        title={t("profiles.manager.importDialogTitle")}
      >
        <div className="space-y-4">
          <div>
            <label
              htmlFor="importJson"
              className="block text-sm font-medium text-card-foreground mb-1"
            >
              {t("profiles.manager.pasteJsonLabel")}
            </label>
            <Textarea
              id="importJson"
              value={importProfileJson}
              onChange={(e) => setImportProfileJson(e.target.value)}
              placeholder={t("profiles.manager.pasteJsonPlaceholder")}
              className="w-full"
              rows={10}
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              onClick={() => setIsImportDialogOpen(false)}
              variant="secondary"
              className="px-4 py-2 font-medium rounded"
            >
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              onClick={handleImportProfile}
              className="px-4 py-2 font-medium rounded"
              disabled={!importProfileJson.trim()}
            >
              {t("profiles.manager.import")}
            </Button>
          </div>
        </div>
      </Dialog>

      {/* Profile Switch Shortcut — co-located per issue #45 */}
      <div className="mt-6 rounded-lg border border-card-control-border bg-card/60 p-4">
        <h4 className="text-sm font-semibold text-card-foreground mb-3">
          {t("profiles.manager.shortcutHeading")}
        </h4>
        <HotkeyInput
          hotkeyKey="profileSwitch"
          label={t("profiles.manager.shortcutLabel")}
        />
      </div>
    </div>
  );
};

export default ProfileManager;
