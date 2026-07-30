/**
 * @file useOpenAIProjectId.ts
 * @description The OpenAI project the tray's Providers card reports spend for.
 *
 * Read from the active profile rather than a dedicated IPC: the id is an ordinary
 * profile setting, and `get-current-profile` is already the channel every other
 * profile-scoped renderer read goes through.
 *
 * `undefined` means "not read yet"; `null` means "read, and nothing configured".
 * Collapsing the two would flash "Set project ID in Settings" on every open for a
 * profile that has one.
 */
import { useEffect, useState } from "react";
import { sanitizeOpenAIProjectId } from "~/shared/openaiProject";

export const useOpenAIProjectId = (): string | null | undefined => {
  const [projectId, setProjectId] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    let mounted = true;

    const read = (): void => {
      void Promise.resolve(window.electronAPI.getCurrentProfile?.())
        .then((result) => {
          if (!mounted) return;
          setProjectId(
            sanitizeOpenAIProjectId(
              result?.currentProfile?.settings?.openaiProjectId,
            ) ?? null,
          );
        })
        .catch(() => {
          // Keep the last known value: a transient IPC failure must not make a
          // configured card claim the project is unset.
        });
    };

    read();
    const offProfile = window.electronAPI.onActiveProfileChanged?.(read);
    // Saving the field in Settings broadcasts this, and the tray can be open at
    // the time — without it the card keeps prompting for an id already stored.
    const offSettings = window.electronAPI.onSettingsUpdated?.(read);

    return () => {
      mounted = false;
      offProfile?.();
      offSettings?.();
    };
  }, []);

  return projectId;
};
