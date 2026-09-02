/**
 * Appearance typography preload bridge.
 */
import { ipcRenderer } from "electron";
import type {
  AppearanceTypography,
  FontFamilyId,
  FontSizeId,
} from "~/features/appearance/shared/typography";

export const appearanceFeature = {
  getAppearanceTypography: (): Promise<AppearanceTypography> =>
    ipcRenderer.invoke("get-appearance-typography"),

  setAppearanceFontSize: (
    fontSize: FontSizeId,
  ): Promise<{ success: boolean; error?: string; typography?: AppearanceTypography }> =>
    ipcRenderer.invoke("set-appearance-font-size", fontSize),

  setAppearanceFontFamily: (
    fontFamily: FontFamilyId,
  ): Promise<{ success: boolean; error?: string; typography?: AppearanceTypography }> =>
    ipcRenderer.invoke("set-appearance-font-family", fontFamily),

  setAppearanceCustomFontSize: (
    customFontSize: string,
  ): Promise<{ success: boolean; error?: string; typography?: AppearanceTypography }> =>
    ipcRenderer.invoke("set-appearance-custom-font-size", customFontSize),

  setAppearanceCustomFontFamily: (
    customFontFamily: string,
  ): Promise<{ success: boolean; error?: string; typography?: AppearanceTypography }> =>
    ipcRenderer.invoke("set-appearance-custom-font-family", customFontFamily),

  onAppearanceTypographyChanged: (
    callback: (typography: AppearanceTypography) => void,
  ): (() => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      typography: AppearanceTypography,
    ) => {
      callback(typography);
    };
    ipcRenderer.on("appearance-typography-changed", listener);
    return () => {
      ipcRenderer.removeListener("appearance-typography-changed", listener);
    };
  },
};

export type AppearanceFeature = typeof appearanceFeature;
