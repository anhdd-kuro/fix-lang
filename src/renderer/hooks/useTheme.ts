import { useCallback, useEffect, useState } from "react";
import { DEFAULT_THEME_ID, type ThemeId } from "~/stores/themeIds";
import { applyThemeToDocument } from "../themes";

type UseThemeResult = {
  themeId: ThemeId;
  setTheme: (themeId: ThemeId) => Promise<void>;
  isLoading: boolean;
};

/**
 * Loads, applies, and syncs the active UI theme preset.
 */
export const useTheme = (): UseThemeResult => {
  const [themeId, setThemeIdState] = useState<ThemeId>(DEFAULT_THEME_ID);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const loadTheme = async () => {
      try {
        const result = await window.electronAPI.getTheme();
        if (!cancelled) {
          setThemeIdState(result.themeId);
          applyThemeToDocument(result.themeId);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void loadTheme();

    const removeListener = window.electronAPI.onThemeChanged((nextThemeId) => {
      setThemeIdState(nextThemeId);
      applyThemeToDocument(nextThemeId);
    });

    return () => {
      cancelled = true;
      removeListener();
    };
  }, []);

  const setTheme = useCallback(async (nextThemeId: ThemeId) => {
    const result = await window.electronAPI.setTheme(nextThemeId);
    if (!result.success) {
      throw new Error(result.error ?? "Failed to set theme");
    }
    setThemeIdState(nextThemeId);
    applyThemeToDocument(nextThemeId);
  }, []);

  return { themeId, setTheme, isLoading };
};
