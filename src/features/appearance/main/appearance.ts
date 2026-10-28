/**
 * @file appearance.ts
 * @description IPC handlers for typography persistence and cross-window sync.
 */
import { BrowserWindow, ipcMain } from "electron";
import {
  CustomFontFamilySchema,
  CustomFontSizeSchema,
  FontFamilyIdSchema,
  FontSizeIdSchema,
  type AppearanceTypography,
} from "~/features/appearance/shared/typography";
import { appearanceStore } from "~/features/appearance/store/appearanceStore";
import {
  syncErrorPopupTypography,
  syncOverlayTypography,
} from "~/main/webViewWindows";

/**
 * Broadcasts the active typography settings to every open BrowserWindow.
 */
export const broadcastAppearanceTypography = (
  typography: AppearanceTypography,
): void => {
  BrowserWindow.getAllWindows().forEach((window) => {
    if (!window.isDestroyed()) {
      window.webContents.send("appearance-typography-changed", typography);
    }
  });
  syncOverlayTypography(typography);
  syncErrorPopupTypography(typography);
};

/**
 * Sends the current typography settings to a single window after it finishes loading.
 */
export const syncAppearanceTypographyToWindow = (
  webContents: Electron.WebContents,
): void => {
  const typography = appearanceStore.getTypography();
  if (!webContents.isDestroyed()) {
    webContents.send("appearance-typography-changed", typography);
  }
};

/**
 * Registers appearance typography IPC handlers.
 */
export const registerAppearanceHandlers = (): void => {
  ipcMain.handle("get-appearance-typography", async () =>
    appearanceStore.getTypography(),
  );

  ipcMain.handle("set-appearance-font-size", async (_event, raw) => {
    const fontSize = FontSizeIdSchema.safeParse(raw);
    if (!fontSize.success) {
      return {
        success: false,
        error: "Invalid font size",
      };
    }

    const typography = appearanceStore.setFontSize(fontSize.data);
    broadcastAppearanceTypography(typography);
    return { success: true, typography };
  });

  ipcMain.handle("set-appearance-font-family", async (_event, raw) => {
    const fontFamily = FontFamilyIdSchema.safeParse(raw);
    if (!fontFamily.success) {
      return {
        success: false,
        error: "Invalid font family",
      };
    }

    const typography = appearanceStore.setFontFamily(fontFamily.data);
    broadcastAppearanceTypography(typography);
    return { success: true, typography };
  });

  ipcMain.handle("set-appearance-custom-font-size", async (_event, raw) => {
    const customFontSize = CustomFontSizeSchema.safeParse(raw);
    if (!customFontSize.success) {
      return {
        success: false,
        error: "Invalid custom font size",
      };
    }

    const typography = appearanceStore.setCustomFontSize(customFontSize.data);
    if (typography === null) {
      return {
        success: false,
        error: "Invalid custom font size",
      };
    }

    broadcastAppearanceTypography(typography);
    return { success: true, typography };
  });

  ipcMain.handle("set-appearance-custom-font-family", async (_event, raw) => {
    const customFontFamily = CustomFontFamilySchema.safeParse(raw);
    if (!customFontFamily.success) {
      return {
        success: false,
        error: "Invalid custom font family",
      };
    }

    const typography = appearanceStore.setCustomFontFamily(
      customFontFamily.data,
    );
    if (typography === null) {
      return {
        success: false,
        error: "Invalid custom font family",
      };
    }

    broadcastAppearanceTypography(typography);
    return { success: true, typography };
  });
};
