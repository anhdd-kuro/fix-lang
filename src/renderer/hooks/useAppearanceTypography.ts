import { useCallback, useEffect, useState } from "react";
import {
  DEFAULT_APPEARANCE_TYPOGRAPHY,
  type AppearanceTypography,
  type FontFamilyId,
  type FontSizeId,
} from "~/features/appearance/shared/typography";
import { applyTypographyToDocument } from "../appearance/applyTypographyToDocument";

type UseAppearanceTypographyResult = {
  typography: AppearanceTypography;
  setFontSize: (fontSize: FontSizeId) => Promise<void>;
  setFontFamily: (fontFamily: FontFamilyId) => Promise<void>;
  setCustomFontSize: (customFontSize: string) => Promise<void>;
  setCustomFontFamily: (customFontFamily: string) => Promise<void>;
  isLoading: boolean;
};

/**
 * Loads, applies, and syncs global UI typography preferences.
 */
export const useAppearanceTypography = (): UseAppearanceTypographyResult => {
  const [typography, setTypography] = useState<AppearanceTypography>(
    DEFAULT_APPEARANCE_TYPOGRAPHY,
  );
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const api = window.electronAPI;

    const loadTypography = async () => {
      try {
        if (!api?.getAppearanceTypography) {
          if (!cancelled) {
            applyTypographyToDocument(DEFAULT_APPEARANCE_TYPOGRAPHY);
          }
          return;
        }

        const result = await api.getAppearanceTypography();
        if (!cancelled) {
          setTypography(result);
          applyTypographyToDocument(result);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void loadTypography();

    const removeListener =
      api?.onAppearanceTypographyChanged?.((nextTypography) => {
        setTypography(nextTypography);
        applyTypographyToDocument(nextTypography);
      }) ?? (() => undefined);

    return () => {
      cancelled = true;
      removeListener();
    };
  }, []);

  const setFontSize = useCallback(async (fontSize: FontSizeId) => {
    const result = await window.electronAPI.setAppearanceFontSize(fontSize);
    if (!result.success) {
      throw new Error(result.error ?? "Failed to set font size");
    }
    if (result.typography) {
      setTypography(result.typography);
      applyTypographyToDocument(result.typography);
    }
  }, []);

  const setFontFamily = useCallback(async (fontFamily: FontFamilyId) => {
    const result = await window.electronAPI.setAppearanceFontFamily(fontFamily);
    if (!result.success) {
      throw new Error(result.error ?? "Failed to set font family");
    }
    if (result.typography) {
      setTypography(result.typography);
      applyTypographyToDocument(result.typography);
    }
  }, []);

  const setCustomFontSize = useCallback(async (customFontSize: string) => {
    const result =
      await window.electronAPI.setAppearanceCustomFontSize(customFontSize);
    if (!result.success) {
      throw new Error(result.error ?? "Failed to set custom font size");
    }
    if (result.typography) {
      setTypography(result.typography);
      applyTypographyToDocument(result.typography);
    }
  }, []);

  const setCustomFontFamily = useCallback(async (customFontFamily: string) => {
    const result =
      await window.electronAPI.setAppearanceCustomFontFamily(customFontFamily);
    if (!result.success) {
      throw new Error(result.error ?? "Failed to set custom font family");
    }
    if (result.typography) {
      setTypography(result.typography);
      applyTypographyToDocument(result.typography);
    }
  }, []);

  return {
    typography,
    setFontSize,
    setFontFamily,
    setCustomFontSize,
    setCustomFontFamily,
    isLoading,
  };
};
