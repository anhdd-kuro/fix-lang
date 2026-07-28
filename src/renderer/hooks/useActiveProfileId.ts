/**
 * @file useActiveProfileId.ts
 * @description The active profile id, kept current across switches.
 *
 * Exists so any view holding profile-scoped data can use it as a React `key`
 * and be rebuilt when the account underneath it changes. A profile switch does
 * NOT emit `settings-updated`, so a component that only listens for that keeps
 * serving the previous profile's credentials-scoped state — its cached account
 * balance, its latched `hasKey` — with no error to reveal it.
 *
 * Returns "" until the first read resolves; that is a stable key, not a
 * profile, so it never collides with a real id.
 */
import { useEffect, useState } from "react";

export const useActiveProfileId = (): string => {
  const [profileId, setProfileId] = useState<string>("");

  useEffect(() => {
    let mounted = true;

    const read = (): void => {
      void Promise.resolve(window.electronAPI.getCurrentProfile?.())
        .then((result) => {
          if (mounted) setProfileId(result?.currentProfileId ?? "");
        })
        .catch(() => {
          // Keep the last known id: churning the key on a transient IPC failure
          // would throw away good data to no purpose.
        });
    };

    read();
    const unsubscribe = window.electronAPI.onActiveProfileChanged?.(read);

    return () => {
      mounted = false;
      unsubscribe?.();
    };
  }, []);

  return profileId;
};
